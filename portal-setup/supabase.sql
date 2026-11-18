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

-- ---------------------------------------------------------------- the studio's side
-- Someone who signs up and is not linked to a space yet sees "Your account
-- is ready" and waits. These four functions are what the team's client list
-- uses to let them in, so nobody has to open this dashboard to do it:
--   waiting_accounts   who has signed up and is connected to nothing
--   connect_account    link an email to an existing space
--   create_space       make a new space (the record is built in the browser
--                      from the studio's templates) and link an email to it
--   confirm_account    mark an account's email as confirmed, for someone who
--                      told us themselves that the email never arrived
--   remove_account     delete a sign-up we don't want (a test, a mistake).
--                      Only someone connected to no space: a client is never
--                      removed this way
-- Every one of them refuses anyone who is not the team. They are the only
-- way a browser can change who opens what: the tables stay closed to writes.

create or replace function public.waiting_accounts()
returns table (email text, name text, signed_up timestamptz, confirmed boolean)
language sql stable security definer set search_path = ''
as $$
  select lower(u.email)::text, coalesce(u.raw_user_meta_data->>'full_name', '')::text,
         u.created_at, u.email_confirmed_at is not null
  from auth.users u
  where public.is_team()
    and u.email is not null
    and not exists (select 1 from public.clients c where lower(u.email) = any (c.emails))
    and not exists (select 1 from public.team_members t where t.email = lower(u.email))
  order by u.created_at desc
$$;

create or replace function public.connect_account(space text, who text) returns text[]
language plpgsql security definer set search_path = ''
as $$
declare result text[];
begin
  if not public.is_team() then raise exception 'permission denied: the studio only' using errcode = '42501'; end if;
  if who is null or lower(trim(who)) !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'that is not an email address'; end if;
  update public.clients c
     set emails = case when lower(trim(who)) = any (c.emails) then c.emails else array_append(c.emails, lower(trim(who))) end
   where c.id = space
  returning c.emails into result;
  if result is null then raise exception 'there is no space called %', space; end if;
  return result;
end;
$$;

create or replace function public.create_space(space text, title text, rec jsonb, who text default null) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_team() then raise exception 'permission denied: the studio only' using errcode = '42501'; end if;
  if rec is null or jsonb_typeof(rec) <> 'object' or pg_column_size(rec) > 400000 then raise exception 'that record is not usable'; end if;
  if who is not null and lower(trim(who)) !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'that is not an email address'; end if;
  insert into public.clients (id, name, emails, record)
  values (space, title, case when who is null then '{}'::text[] else array[lower(trim(who))] end, rec);
  return space;
end;
$$;

create or replace function public.confirm_account(who text) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_team() then raise exception 'permission denied: the studio only' using errcode = '42501'; end if;
  update auth.users set email_confirmed_at = now()
   where lower(email) = lower(trim(who)) and email_confirmed_at is null;
  return found;
end;
$$;

create or replace function public.remove_account(who text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare target uuid;
begin
  if not public.is_team() then raise exception 'permission denied: the studio only' using errcode = '42501'; end if;
  select u.id into target from auth.users u
   where lower(u.email) = lower(trim(who))
     and not exists (select 1 from public.clients c where lower(u.email) = any (c.emails))
     and not exists (select 1 from public.team_members t where t.email = lower(u.email))
   limit 1;
  if target is null then raise exception 'only someone waiting to be connected can be removed'; end if;
  delete from auth.users where id = target;
  return true;
end;
$$;

revoke all on function public.waiting_accounts() from public, anon;
revoke all on function public.connect_account(text, text) from public, anon;
revoke all on function public.create_space(text, text, jsonb, text) from public, anon;
revoke all on function public.confirm_account(text) from public, anon;
revoke all on function public.remove_account(text) from public, anon;
grant execute on function public.waiting_accounts() to authenticated;
grant execute on function public.connect_account(text, text) to authenticated;
grant execute on function public.create_space(text, text, jsonb, text) to authenticated;
grant execute on function public.confirm_account(text) to authenticated;
grant execute on function public.remove_account(text) to authenticated;

-- ---------------------------------------------------------------- awake
-- A free Supabase project pauses after a week of too little database
-- activity, and a paused project means nobody can log in. The scheduled
-- job in .github/workflows/keep-supabase-awake.yml calls this four times
-- a day. It does a real read of the clients table (twice a week of
-- "select 1" was not enough: the project paused in October 2026 with the
-- job still running) and always returns 1, so it tells a stranger nothing.

create or replace function public.ping() returns integer
language sql stable security definer set search_path = ''
as $$ select 1 from (select count(*) from public.clients) c $$;
grant execute on function public.ping() to anon, authenticated;

-- ---------------------------------------------------------------- the team
-- Add each of us with the email we log in with. Lower case.

insert into public.team_members (email) values
  ('horizonsymmetrystudio@gmail.com')
on conflict do nothing;
