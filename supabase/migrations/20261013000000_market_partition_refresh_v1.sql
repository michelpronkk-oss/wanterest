-- Wanterest 1B Stage 2C: autonomous public market-partition refresh state and
-- job type. Additive/backwards-compatible; no backfill. market_partitions
-- (Stage 2B) remains immutable identity; this migration adds only mutable
-- operational refresh state, keyed off that immutable identity.

create table if not exists public.market_partition_refresh_state (
  partition_id uuid primary key references public.market_partitions(id) on delete cascade,
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  enabled boolean not null default true,
  disabled_reason text,
  next_due_at timestamptz not null,
  lease_token text,
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_job_run_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists market_partition_refresh_state_due_idx
  on public.market_partition_refresh_state (enabled, next_due_at);
create index if not exists market_partition_refresh_state_lease_idx
  on public.market_partition_refresh_state (lease_expires_at)
  where lease_expires_at is not null;

drop trigger if exists market_partition_refresh_state_updated_at on public.market_partition_refresh_state;
create trigger market_partition_refresh_state_updated_at
  before update on public.market_partition_refresh_state
  for each row execute function public.updated_at_trigger();

alter table public.market_partition_refresh_state enable row level security;
revoke all on public.market_partition_refresh_state from anon, authenticated;
grant select, insert, update on public.market_partition_refresh_state to service_role;
-- No anon/authenticated policies: this is global operational scheduler state,
-- not workspace-owned, and must never be client-readable or client-writable.

-- Atomic compare-and-set claim, mirroring claim_monitoring_schedule: only
-- claims a row that is enabled, due, and not already under a live lease.
create or replace function public.claim_market_partition_refresh(
  p_partition_id uuid,
  p_lease_token text,
  p_now timestamptz default timezone('utc', now()),
  p_lease_seconds integer default 1800
)
returns public.market_partition_refresh_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.market_partition_refresh_state;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  if p_lease_token is null or char_length(trim(p_lease_token)) < 1 then
    raise exception using errcode = '22023', message = 'invalid_market_partition_refresh_lease_token';
  end if;

  update public.market_partition_refresh_state mprs
     set lease_token = p_lease_token,
         lease_expires_at = p_now + make_interval(secs => greatest(p_lease_seconds, 60)),
         last_attempt_at = p_now
   where mprs.partition_id = p_partition_id
     and mprs.enabled
     and mprs.next_due_at <= p_now
     and (mprs.lease_expires_at is null or mprs.lease_expires_at <= p_now)
   returning mprs.* into v_state;

  return v_state;
end;
$$;

grant execute on function public.claim_market_partition_refresh(uuid, text, timestamptz, integer) to service_role;

alter table public.job_runs drop constraint if exists job_runs_job_type_check;
alter table public.job_runs add constraint job_runs_job_type_check check (job_type in (
  'discover-source', 'normalize-source-items', 'dedupe-conversations',
  'analyze-conversations', 'match-product', 'rank-matches',
  'aggregate-demand', 'calculate-demand-gap', 'calculate-demand-drift',
  'backfill-demand-snapshots', 'generate-actions', 'build-digest',
  'process-billing-webhook', 'reconcile-billing-subscription',
  'aggregate-experiment-results', 'finalize-experiment', 'backfill-experiment-results',
  'refresh-market-partition'
));
