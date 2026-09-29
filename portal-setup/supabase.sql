-- ====================================================================
-- Horizon Symmetry client space: the database
--
-- Paste all of this into Supabase > SQL Editor > New query, and Run.
-- Safe to run again: it only creates what is missing and replaces its
-- own rules.
--
-- Two tables:
--   clients       one row per client. `record` is what their space
--                 shows (steps, files, payments), `state` is what they
--                 did in it (questionnaire answers, their pick).
--                 `emails` is who may open it.
--   team_members  the studio. Can open every client's space, can't
--                 answer for a client.
--
-- And one private file bucket, client-files, one folder per client.
--
-- The rules at the bottom are what keep one client out of another's
-- space. The browser only ever gets the rows these rules allow.
-- ====================================================================

create table if not exists public.clients (
  id          text primary key check (id ~ '^[a-z0-9-]+$'),
  name        text not null,
  emails      text[] not null default '{}' check (emails::text = lower(emails::text)),
  record      jsonb not null,
  state       jsonb not null default '{}'::jsonb check (pg_column_size(state) < 200000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.team_members (
  email text primary key check (email = lower(email))
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

-- Who is asking, but only once they have confirmed their email. Someone
-- who signs up with a client's address and never opens the link gets
-- nothing, whatever the email settings are.
create or replace function public.my_email() returns text
language sql stable security definer set search_path = ''
as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null
$$;

create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.team_members t where t.email = public.my_email())
$$;

revoke all on function public.my_email() from public, anon;
revoke all on function public.is_team() from public, anon;
grant execute on function public.my_email() to authenticated;
grant execute on function public.is_team() to authenticated;

-- ---------------------------------------------------------------- rules

alter table public.clients enable row level security;
alter table public.team_members enable row level security;

-- Nobody changes these tables from a browser except for one thing: a
-- client saving their own answers. Records and emails are edited here,
-- in the Supabase dashboard, by us.
revoke all on public.clients from anon, authenticated;
revoke all on public.team_members from anon, authenticated;
grant select on public.clients to authenticated;
grant update (state) on public.clients to authenticated;

drop policy if exists "client or team can read" on public.clients;
create policy "client or team can read" on public.clients
  for select to authenticated
  using (public.my_email() = any (emails) or public.is_team());

drop policy if exists "client saves own answers" on public.clients;
create policy "client saves own answers" on public.clients
  for update to authenticated
  using (public.my_email() = any (emails))
  with check (public.my_email() = any (emails));

-- team_members has no policies on purpose: it is only ever read through
-- is_team(), never directly.

-- ---------------------------------------------------------------- files
-- Each client's files sit in a private bucket, in a folder named after
-- their id (crude/logo-dark-square.png, crude/fonts/lora-var.woff2).
-- Nothing in it has a public address. The space asks for links that
-- work for 12 hours, and Supabase only hands out links for folders the
-- rule below lets that person read: their own client's, or all of them
-- for the team. Files are uploaded in the dashboard (Storage), which is
-- the only way in: there is no rule that lets a browser upload.

insert into storage.buckets (id, name, public)
values ('client-files', 'client-files', false)
on conflict (id) do update set public = false;

create or replace function public.can_open(client_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_team() or exists (
    select 1 from public.clients c
    where c.id = client_id and public.my_email() = any (c.emails)
  )
$$;

revoke all on function public.can_open(text) from public, anon;
grant execute on function public.can_open(text) to authenticated;

drop policy if exists "client or team can read files" on storage.objects;
create policy "client or team can read files" on storage.objects
  for select to authenticated
  using (bucket_id = 'client-files' and public.can_open((storage.foldername(name))[1]));

-- ---------------------------------------------------------------- awake
-- A free Supabase project pauses after a week with nothing happening,
-- and a paused project means nobody can log in. The scheduled job in
-- .github/workflows/keep-supabase-awake.yml calls this twice a week.
-- It reads nothing and returns 1.

create or replace function public.ping() returns integer
language sql stable set search_path = ''
as $$ select 1 $$;
grant execute on function public.ping() to anon, authenticated;

-- ---------------------------------------------------------------- the team
-- Add each of us with the email we log in with. Lower case.

insert into public.team_members (email) values
  ('horizonsymmetrystudio@gmail.com')
on conflict do nothing;
