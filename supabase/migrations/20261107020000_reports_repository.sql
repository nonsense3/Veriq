-- Veriq: move report storage and the public threat repository into Supabase.
-- Run after the two earlier migrations.
--
-- public.reports               private: full reports + commitment nonces. No RLS policies, so only the
--                              scanner's server-side secret key (service role) can read or write it.
-- public.repository_entries    public, read-only projection of reports users chose to share
--                              (sanitised indicators, chain receipt, review counts). Realtime.
-- public.repository_statements public, read-only validate/dispute statements with their on-chain hashes. Realtime.

create table if not exists public.reports (
  report_id uuid primary key,
  registry_key text not null unique,
  owner_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('url', 'message')),
  classification text not null check (classification in ('low_risk', 'suspicious', 'high_risk', 'confirmed_malicious', 'inconclusive')),
  published boolean not null default false,
  record jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists reports_published_created on public.reports (published, created_at desc);
create index if not exists reports_owner_created on public.reports (owner_id, created_at desc);
alter table public.reports enable row level security;
-- Intentionally no policies: anon/authenticated roles get nothing; the service role bypasses RLS.

create table if not exists public.repository_entries (
  public_id text primary key check (public_id ~ '^0x[0-9a-f]{64}$'),
  report_id uuid not null unique references public.reports (report_id) on delete cascade,
  kind text not null check (kind in ('url', 'message')),
  classification text not null check (classification in ('low_risk', 'suspicious', 'high_risk', 'confirmed_malicious', 'inconclusive')),
  summary text not null check (char_length(summary) <= 400),
  note text check (char_length(note) <= 280),
  indicators jsonb not null default '[]'::jsonb,
  chain_id integer,
  transaction_hash text,
  block_number bigint,
  confirms integer not null default 0,
  disputes integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists repository_entries_created on public.repository_entries (created_at desc);
alter table public.repository_entries enable row level security;
drop policy if exists "repository: public read" on public.repository_entries;
create policy "repository: public read" on public.repository_entries for select to anon, authenticated using (true);

create table if not exists public.repository_statements (
  statement_hash text primary key,
  public_id text not null references public.repository_entries (public_id) on delete cascade,
  kind text not null check (kind in ('validate', 'dispute')),
  note text not null check (char_length(note) between 3 and 280),
  transaction_hash text,
  status text not null check (status in ('unregistered', 'pending', 'confirmed', 'failed', 'unavailable')),
  created_at timestamptz not null default now()
);
create index if not exists repository_statements_entry on public.repository_statements (public_id, created_at);
alter table public.repository_statements enable row level security;
drop policy if exists "statements: public read" on public.repository_statements;
create policy "statements: public read" on public.repository_statements for select to anon, authenticated using (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'repository_entries') then
    alter publication supabase_realtime add table public.repository_entries;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'repository_statements') then
    alter publication supabase_realtime add table public.repository_statements;
  end if;
end $$;

-- Account deletion now also removes the caller's private reports; shared ones are detached
-- (owner set to null by the foreign key) because their fingerprints are already public on-chain.
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
  delete from public.reports where owner_id = uid and published = false;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
