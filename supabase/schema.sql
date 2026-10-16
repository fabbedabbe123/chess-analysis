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
