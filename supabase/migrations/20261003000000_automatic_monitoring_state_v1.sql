-- Automatic Monitoring v1 state and retry observability.
-- Forward-only: preserve existing schedule rows and historical intelligence.

alter table public.monitoring_schedules
  add column if not exists current_status text not null default 'idle'
    check (current_status in ('idle', 'queued', 'running', 'completed', 'failed', 'paused')),
  add column if not exists last_started_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz,
  add column if not exists last_new_candidate_count integer not null default 0
    check (last_new_candidate_count >= 0),
  add column if not exists last_new_signal_count integer not null default 0
    check (last_new_signal_count >= 0),
  add column if not exists last_intelligence_update_at timestamptz;

create index if not exists monitoring_schedules_status_idx
  on public.monitoring_schedules (workspace_id, current_status, next_cycle_at);

comment on column public.monitoring_schedules.current_status is 'Current per-product monitoring lifecycle state; historical outcomes remain in the timestamp fields.';
comment on column public.monitoring_schedules.last_error_code is 'Sanitized server error code for the most recent failed monitoring dispatch or run.';

create or replace function public.claim_monitoring_schedule(
  p_schedule_id uuid,
  p_lease_token text,
  p_lease_kind text,
  p_now timestamptz default timezone('utc', now()),
  p_lease_seconds integer default 900
)
returns public.monitoring_schedules
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_schedule public.monitoring_schedules;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  if p_lease_kind not in ('intelligence_cycle', 'deep_refresh') then
    raise exception using errcode = '22023', message = 'invalid_monitoring_lease_kind';
  end if;
  if p_lease_token is null or char_length(trim(p_lease_token)) < 1 then
    raise exception using errcode = '22023', message = 'invalid_monitoring_lease_token';
  end if;

  update public.monitoring_schedules ms
     set lease_token = p_lease_token,
         lease_kind = p_lease_kind,
         lease_expires_at = p_now + make_interval(secs => greatest(p_lease_seconds, 60)),
         current_status = 'running',
         last_started_at = p_now,
         last_dispatch_at = p_now,
         updated_at = p_now
   where ms.id = p_schedule_id
     and ms.enabled
     and (ms.lease_expires_at is null or ms.lease_expires_at <= p_now)
     and ((p_lease_kind = 'intelligence_cycle' and ms.next_cycle_at is not null and ms.next_cycle_at <= p_now)
       or (p_lease_kind = 'deep_refresh' and ms.next_deep_refresh_at is not null and ms.next_deep_refresh_at <= p_now))
   returning ms.* into v_schedule;

  return v_schedule;
end;
$$;

grant execute on function public.claim_monitoring_schedule(uuid, text, text, timestamptz, integer) to service_role;
