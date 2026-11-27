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
-- for the team. Only the team uploads, from the client's Files view (the
-- rules under "shared with the client" below); a client never can.

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

-- ---------------------------------------------------------------- shared with the client
-- What the team puts in a client's Files view from the space itself,
-- with no dashboard: a file (into the bucket above, under the client's
-- folder) or a link, under a heading such as "First build", with an
-- optional note (a password, what to look at). The client comments on
-- each one and the team answers in the same thread.
--
--   client_items     team adds and removes, client and team read
--   client_comments  client and team write, each reads only their space's
--
-- Who wrote a comment, and whether it was the team, is set by the
-- database from the login, never taken from the browser.

create table if not exists public.client_items (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null references public.clients (id) on delete cascade,
  section     text not null check (length(trim(section)) between 1 and 80),
  kind        text not null check (kind in ('file', 'link')),
  title       text not null check (length(trim(title)) between 1 and 140),
  note        text not null default '' check (length(note) <= 2000),
  url         text check (url is null or url ~* '^https?://[^[:space:]]+$'),
  path        text check (path is null or (path !~ '\.\.' and path ~ '^[a-z0-9-]+/')),
  file_name   text check (file_name is null or length(file_name) <= 200),
  size        bigint check (size is null or size >= 0),
  added_by    text,
  created_at  timestamptz not null default now(),
  check ((kind = 'link' and url is not null and path is null)
      or (kind = 'file' and path is not null and url is null)),
  check (path is null or split_part(path, '/', 1) = client_id)
);

create table if not exists public.client_comments (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.client_items (id) on delete cascade,
  client_id   text not null references public.clients (id) on delete cascade,
  author      text,
  author_name text not null default '',
  from_team   boolean not null default false,
  body        text not null check (length(trim(body)) between 1 and 4000),
  created_at  timestamptz not null default now()
);

create index if not exists client_items_client on public.client_items (client_id, created_at);
create index if not exists client_comments_item on public.client_comments (item_id, created_at);
create index if not exists client_comments_client on public.client_comments (client_id, created_at);

-- Fills in who did it. Signed in, the login wins over anything sent;
-- only a paste in this editor (no login) keeps what it was given.
create or replace function public.stamp_item() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.my_email() is not null then
    new.added_by := public.my_email();
    new.created_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.stamp_comment() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare me text := public.my_email();
begin
  select i.client_id into new.client_id from public.client_items i where i.id = new.item_id;
  if me is not null then
    new.author := me;
    new.from_team := public.is_team();
    new.created_at := now();
    select case when public.is_team() then 'Horizon Symmetry'
                else coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), split_part(me, '@', 1)) end
      into new.author_name
      from auth.users u where u.id = auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_item() from public, anon, authenticated;
revoke all on function public.stamp_comment() from public, anon, authenticated;

drop trigger if exists client_items_stamp on public.client_items;
create trigger client_items_stamp before insert on public.client_items
  for each row execute function public.stamp_item();
drop trigger if exists client_comments_stamp on public.client_comments;
create trigger client_comments_stamp before insert on public.client_comments
  for each row execute function public.stamp_comment();

alter table public.client_items enable row level security;
alter table public.client_comments enable row level security;
revoke all on public.client_items from anon, authenticated;
revoke all on public.client_comments from anon, authenticated;
grant select, insert, delete on public.client_items to authenticated;
grant select, insert, delete on public.client_comments to authenticated;

drop policy if exists "client or team reads items" on public.client_items;
create policy "client or team reads items" on public.client_items
  for select to authenticated using (public.can_open(client_id));
drop policy if exists "team adds items" on public.client_items;
create policy "team adds items" on public.client_items
  for insert to authenticated with check (public.is_team());
drop policy if exists "team removes items" on public.client_items;
create policy "team removes items" on public.client_items
  for delete to authenticated using (public.is_team());

drop policy if exists "client or team reads comments" on public.client_comments;
create policy "client or team reads comments" on public.client_comments
  for select to authenticated using (public.can_open(client_id));
drop policy if exists "client or team comments" on public.client_comments;
create policy "client or team comments" on public.client_comments
  for insert to authenticated with check (public.can_open(client_id) and author = public.my_email());
drop policy if exists "author or team removes a comment" on public.client_comments;
create policy "author or team removes a comment" on public.client_comments
  for delete to authenticated using (author = public.my_email() or public.is_team());

-- The team uploads into a client's folder (one that exists) and removes
-- files from any of them. A client gets neither.
drop policy if exists "team uploads files" on storage.objects;
create policy "team uploads files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'client-files' and public.is_team()
    and (storage.foldername(name))[1] in (select c.id from public.clients c));
drop policy if exists "team removes files" on storage.objects;
create policy "team removes files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'client-files' and public.is_team());

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

-- Tell the API about any table this file just made, so the space can use
-- it straight away instead of after the next automatic refresh.
notify pgrst, 'reload schema';
