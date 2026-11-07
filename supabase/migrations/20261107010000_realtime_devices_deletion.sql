-- Veriq: per-user investigation history (realtime), device sessions, and self-service account deletion.
-- Run after 20261107000000_profiles.sql, in the Supabase SQL editor or with `supabase db push`.

-- ---------------------------------------------------------------------------------------------
-- 1. Investigation history. The scanner inserts rows with the signed-in user's own access token,
--    so RLS (not a server secret) decides what can be written. Only summaries are stored here;
--    full reports stay on the Veriq scanner.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.investigations (
  report_id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('url', 'message')),
  subject text not null check (char_length(subject) <= 300),
  classification text not null check (classification in ('low_risk', 'suspicious', 'high_risk', 'confirmed_malicious', 'inconclusive')),
  label text not null check (char_length(label) <= 40),
  findings integer not null default 0 check (findings >= 0),
  registry_status text not null default 'unregistered' check (registry_status in ('unregistered', 'pending', 'confirmed', 'failed', 'unavailable')),
  transaction_hash text check (char_length(transaction_hash) <= 80),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists investigations_owner_created on public.investigations (owner_id, created_at desc);

alter table public.investigations enable row level security;
drop policy if exists "investigations: owner read" on public.investigations;
create policy "investigations: owner read" on public.investigations for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists "investigations: owner insert" on public.investigations;
create policy "investigations: owner insert" on public.investigations for insert to authenticated with check ((select auth.uid()) = owner_id);
drop policy if exists "investigations: owner update" on public.investigations;
create policy "investigations: owner update" on public.investigations for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists "investigations: owner delete" on public.investigations;
create policy "investigations: owner delete" on public.investigations for delete to authenticated using ((select auth.uid()) = owner_id);

-- ---------------------------------------------------------------------------------------------
-- 2. Devices. Each browser registers itself after sign-in and refreshes last_seen_at.
--    Revoking a device sets revoked_at; that device signs itself out when it sees the change
--    (instantly via realtime, or on its next load).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id text not null check (char_length(device_id) between 8 and 64),
  label text not null check (char_length(label) <= 80),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, device_id)
);

alter table public.user_devices enable row level security;
drop policy if exists "devices: owner read" on public.user_devices;
create policy "devices: owner read" on public.user_devices for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "devices: owner insert" on public.user_devices;
create policy "devices: owner insert" on public.user_devices for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "devices: owner update" on public.user_devices;
create policy "devices: owner update" on public.user_devices for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "devices: owner delete" on public.user_devices;
create policy "devices: owner delete" on public.user_devices for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------------------------
-- 3. Realtime: stream changes on these tables to their owners (RLS applies to realtime too).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'investigations') then
    alter publication supabase_realtime add table public.investigations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'user_devices') then
    alter publication supabase_realtime add table public.user_devices;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Self-service account deletion. Runs with definer rights but can only ever delete the caller.
--    Cascades remove profiles, investigations, devices and the user's identities and sessions.
-- ---------------------------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Report whether the caller has a password, without exposing the hash.
create or replace function public.my_auth_status()
returns table (has_password boolean)
language sql
security definer
set search_path = ''
stable
as $$
  select (u.encrypted_password is not null and u.encrypted_password <> '') as has_password
  from auth.users u where u.id = auth.uid();
$$;

revoke all on function public.my_auth_status() from public, anon;
grant execute on function public.my_auth_status() to authenticated;
