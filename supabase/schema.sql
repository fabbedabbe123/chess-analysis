-- Cloud sync for Chess Analysis. Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query -> Run).
-- One row per (user, name). `value` is the exact JSON text the app keeps in the browser. Row level security makes
-- every row readable and writable ONLY by its own user; the public (anon) key in the website can do nothing else.

create table if not exists public.user_data (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  name       text        not null check (name in ('settings', 'play-settings', 'strength-games', 'play-history', 'library', 'puzzles', 'accounts')),
  value      text        not null check (octet_length(value) <= 3000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);

alter table public.user_data enable row level security;

drop policy if exists "user_data_select_own" on public.user_data;
drop policy if exists "user_data_insert_own" on public.user_data;
drop policy if exists "user_data_update_own" on public.user_data;
drop policy if exists "user_data_delete_own" on public.user_data;

create policy "user_data_select_own" on public.user_data for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_data_insert_own" on public.user_data for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_data_update_own" on public.user_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_data_delete_own" on public.user_data for delete to authenticated using ((select auth.uid()) = user_id);

-- updated_at is set by the server, never by the client.
create or replace function public.touch_user_data() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch before insert or update on public.user_data for each row execute function public.touch_user_data();

-- Nothing is readable without signing in.
revoke all on public.user_data from anon;
grant select, insert, update, delete on public.user_data to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Profiles: one unique username per account (case-insensitive). Run this part once as well (it is safe to re-run).
-- Only the owner can read or change their own row for now; a narrow public read comes with friends / challenges.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  username   text        not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_not_reserved check (lower(username) not in ('admin', 'administrator', 'support', 'moderator', 'staff', 'root', 'system', 'stockfish', 'chess', 'lichess', 'chesscom', 'official', 'anonymous', 'null', 'undefined'))
);

create unique index if not exists profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;

create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "profiles_delete_own" on public.profiles for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.touch_profile() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before insert or update on public.profiles for each row execute function public.touch_profile();

-- "Is this name free?" without exposing anyone's row. Returns only true / false.
create or replace function public.username_available(name text) returns boolean
language sql security definer set search_path = public stable as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(name));
$$;

revoke all on public.profiles from anon;
grant select, insert, update, delete on public.profiles to authenticated;
revoke all on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Profile picture + friends. Run this part once as well (it is safe to re-run).
-- Friends never get direct table access to each other: everything goes through the functions below, which check
-- auth.uid() themselves. Friendships can only be changed through those functions.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.profiles add column if not exists avatar text;
alter table public.profiles drop constraint if exists profiles_avatar_format;
alter table public.profiles add constraint profiles_avatar_format
  check (avatar is null or (octet_length(avatar) <= 60000 and avatar ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'));

create table if not exists public.friendships (
  id         uuid        primary key default gen_random_uuid(),
  requester  uuid        not null references auth.users (id) on delete cascade,
  addressee  uuid        not null references auth.users (id) on delete cascade,
  status     text        not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  constraint friendships_not_self check (requester <> addressee)
);
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));

alter table public.friendships enable row level security;
drop policy if exists "friendships_select_own" on public.friendships;
create policy "friendships_select_own" on public.friendships for select to authenticated using ((select auth.uid()) in (requester, addressee));
revoke all on public.friendships from anon;
revoke all on public.friendships from authenticated;
grant select on public.friendships to authenticated;

-- Numbers a user chooses to show their friends (level estimate, puzzles solved, ...). Only the owner can touch the row;
-- friends read it through friends_overview().
create table if not exists public.profile_stats (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  stats      jsonb       not null check (jsonb_typeof(stats) = 'object' and octet_length(stats::text) <= 2000),
  updated_at timestamptz not null default now()
);
alter table public.profile_stats enable row level security;
drop policy if exists "profile_stats_own" on public.profile_stats;
create policy "profile_stats_own" on public.profile_stats for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.profile_stats from anon;
grant select, insert, update, delete on public.profile_stats to authenticated;

-- Online status: a heartbeat row per user, written only through set_presence() (the server stamps the time), read by
-- friends only through friends_overview(). The table itself is closed to everybody.
create table if not exists public.presence (
  user_id   uuid        primary key references auth.users (id) on delete cascade,
  last_seen timestamptz not null default now(),
  activity  text        check (activity is null or activity in ('analysing', 'puzzles', 'playing', 'games', 'learning', 'browsing'))
);
alter table public.presence enable row level security;
revoke all on public.presence from anon;
revoke all on public.presence from authenticated;

create or replace function public.set_presence(p_activity text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.profiles where user_id = auth.uid()) then raise exception 'Choose a username first.'; end if;
  insert into public.presence (user_id, last_seen, activity)
  values (auth.uid(), now(), case when p_activity in ('analysing', 'puzzles', 'playing', 'games', 'learning', 'browsing') then p_activity end)
  on conflict (user_id) do update set last_seen = now(), activity = excluded.activity;
end;
$$;

create or replace function public.clear_presence() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.presence where user_id = auth.uid();
end;
$$;

-- Exact (case-insensitive) username lookup. There is no way to list or browse users.
create or replace function public.search_user(p_name text) returns table (user_id uuid, username text, avatar text)
language sql security definer set search_path = public stable as $$
  select p.user_id, p.username, p.avatar from public.profiles p
  where auth.uid() is not null and lower(p.username) = lower(p_name) and p.user_id <> auth.uid();
$$;

create or replace function public.friend_request(p_target uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); f public.friendships;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_target = me then raise exception 'You cannot add yourself.'; end if;
  if not exists (select 1 from public.profiles where user_id = me) then raise exception 'Choose a username first.'; end if;
  if not exists (select 1 from public.profiles where user_id = p_target) then raise exception 'No such user.'; end if;
  select * into f from public.friendships where least(requester, addressee) = least(me, p_target) and greatest(requester, addressee) = greatest(me, p_target);
  if found then
    if f.status = 'accepted' then return 'friends'; end if;
    if f.requester = me then return 'pending'; end if;
    update public.friendships set status = 'accepted' where id = f.id; -- they had already asked me
    return 'accepted';
  end if;
  if (select count(*) from public.friendships where requester = me and status = 'pending') >= 50 then raise exception 'Too many pending requests.'; end if;
  if (select count(*) from public.friendships where status = 'accepted' and me in (requester, addressee)) >= 200 then raise exception 'Friend list is full.'; end if;
  insert into public.friendships (requester, addressee) values (me, p_target);
  return 'pending';
end;
$$;

create or replace function public.friend_respond(p_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.friendships where id = p_id and addressee = me and status = 'pending') then raise exception 'No such request.'; end if;
  if p_accept then
    update public.friendships set status = 'accepted' where id = p_id;
    return 'accepted';
  end if;
  delete from public.friendships where id = p_id;
  return 'declined';
end;
$$;

-- Remove a friend, decline an incoming request or cancel an outgoing one.
create or replace function public.friend_remove(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.friendships where id = p_id and auth.uid() in (requester, addressee);
end;
$$;

-- Everyone I have a friendship row with. Stats, member-since and online status are only included for accepted friends.
drop function if exists public.friends_overview();
create or replace function public.friends_overview() returns table (friendship_id uuid, user_id uuid, username text, avatar text, status text, incoming boolean, member_since timestamptz, stats jsonb, seen_ago integer, activity text)
language sql security definer set search_path = public stable as $$
  select f.id, p.user_id, p.username, p.avatar, f.status, (f.addressee = auth.uid()),
         case when f.status = 'accepted' then p.created_at end,
         case when f.status = 'accepted' then s.stats end,
         case when f.status = 'accepted' and pr.user_id is not null then extract(epoch from (now() - pr.last_seen))::integer end,
         case when f.status = 'accepted' then pr.activity end
  from public.friendships f
  join public.profiles p on p.user_id = case when f.requester = auth.uid() then f.addressee else f.requester end
  left join public.profile_stats s on s.user_id = p.user_id
  left join public.presence pr on pr.user_id = p.user_id
  where auth.uid() is not null and auth.uid() in (f.requester, f.addressee)
  order by f.status, lower(p.username);
$$;

revoke all on function public.search_user(text), public.friend_request(uuid), public.friend_respond(uuid, boolean), public.friend_remove(uuid), public.friends_overview(), public.set_presence(text), public.clear_presence() from public, anon;
grant execute on function public.search_user(text), public.friend_request(uuid), public.friend_respond(uuid, boolean), public.friend_remove(uuid), public.friends_overview(), public.set_presence(text), public.clear_presence() to authenticated;
