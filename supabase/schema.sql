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
