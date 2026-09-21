-- Durable scan dispatch recovery.
-- Forward-only: preserve the existing job state machine while recording the
-- dispatch claim/link lifecycle explicitly.

alter table public.job_runs
  add column if not exists dispatch_status text not null default 'unclaimed',
  add column if not exists dispatch_claimed_at timestamptz,
  add column if not exists dispatch_checked_at timestamptz;

alter table public.job_runs
  drop constraint if exists job_runs_dispatch_status_check;

alter table public.job_runs
  add constraint job_runs_dispatch_status_check check (dispatch_status in (
    'unclaimed', 'claimed', 'linked', 'not_applicable', 'failed', 'orphaned'
  ));

-- Backfill the durable state for rows created before dispatch recovery existed.
update public.job_runs
set dispatch_status = 'linked',
    dispatch_checked_at = coalesce(dispatch_checked_at, updated_at)
where trigger_run_id is not null
  and dispatch_status = 'unclaimed';

update public.job_runs
set dispatch_status = 'claimed',
    dispatch_claimed_at = coalesce(dispatch_claimed_at, started_at, updated_at)
where trigger_run_id is null
  and status in ('pending', 'running')
  and started_at is not null
  and dispatch_status = 'unclaimed';

update public.job_runs
set dispatch_status = 'failed',
    dispatch_checked_at = coalesce(dispatch_checked_at, updated_at)
where status in ('failed', 'failed_terminal', 'cancelled')
  and dispatch_status = 'unclaimed';

create index if not exists job_runs_dispatch_recovery_idx
  on public.job_runs (status, dispatch_status, updated_at)
  where status in ('pending', 'running');
