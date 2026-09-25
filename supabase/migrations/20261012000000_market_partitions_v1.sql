-- Wanterest 1B Stage 2B (observational): global, tenant-free market partition
-- identity, plus additive query_yield_artifacts columns attaching each
-- executed query's partition key (or ineligibility reason) and exact new-raw
-- item count. Additive/backwards-compatible; no backfill.

create table if not exists public.market_partitions (
  id uuid primary key default gen_random_uuid(),
  partition_key text not null unique check (char_length(trim(partition_key)) between 1 and 300),
  identity_version text not null check (char_length(trim(identity_version)) between 1 and 60),
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  retrieval_spec jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists market_partitions_source_created_idx
  on public.market_partitions (source_key, created_at desc);

create or replace function public.prevent_market_partition_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception using errcode = '55000', message = 'market_partitions_are_append_only';
end;
$$;

drop trigger if exists market_partitions_append_only on public.market_partitions;
create trigger market_partitions_append_only
  before update or delete on public.market_partitions
  for each row execute function public.prevent_market_partition_mutation();

alter table public.market_partitions enable row level security;
revoke all on public.market_partitions from anon, authenticated;
grant select, insert on public.market_partitions to service_role;
-- No policies for anon/authenticated: RLS with zero policies denies all
-- client access outright. retrieval_spec can contain literal public search
-- text derived from tenant queries, so it must never be client-readable -
-- clients must not be able to resolve a partition key into its spec.

alter table public.query_yield_artifacts
  add column if not exists market_partition_key text,
  add column if not exists market_partition_ineligible_reason text,
  add column if not exists raw_new_items integer;

alter table public.query_yield_artifacts
  drop constraint if exists query_yield_artifacts_raw_new_items_check;
alter table public.query_yield_artifacts
  add constraint query_yield_artifacts_raw_new_items_check
  check (raw_new_items is null or raw_new_items >= 0);

-- Deliberately no foreign key from query_yield_artifacts.market_partition_key
-- to market_partitions.partition_key: a failed global partition insert must
-- never cause the (already workspace-authorized) yield-artifact insert to fail.

create index if not exists query_yield_artifacts_market_partition_idx
  on public.query_yield_artifacts (market_partition_key, created_at desc);
