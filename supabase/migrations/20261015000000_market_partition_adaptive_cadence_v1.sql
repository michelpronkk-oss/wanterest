-- Wanterest 1B Stage 2F: adaptive cadence state for global market-partition
-- refresh. Additive/backwards-compatible; no backfill. GLOBAL operational
-- state (no workspace/product columns), service-role only like the rest of
-- market_partition_refresh_state (RLS enabled, no client policies).

alter table public.market_partition_refresh_state
  add column if not exists consecutive_zero_new integer not null default 0,
  add column if not exists last_raw_items integer,
  add column if not exists last_raw_new_items integer,
  add column if not exists last_cadence_seconds integer,
  add column if not exists cadence_policy_version text;

alter table public.market_partition_refresh_state
  drop constraint if exists market_partition_refresh_state_cadence_check;
alter table public.market_partition_refresh_state
  add constraint market_partition_refresh_state_cadence_check check (
    consecutive_zero_new >= 0
    and (last_raw_items is null or last_raw_items >= 0)
    and (last_raw_new_items is null or last_raw_new_items >= 0)
    and (last_cadence_seconds is null or last_cadence_seconds > 0)
    and (cadence_policy_version is null or char_length(trim(cadence_policy_version)) between 1 and 60)
  );

-- Daily-budget lookups: refresh job runs created in the last 24h.
create index if not exists job_runs_refresh_market_partition_created_idx
  on public.job_runs (created_at desc)
  where job_type = 'refresh-market-partition';
