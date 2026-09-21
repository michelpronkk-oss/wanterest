-- Automatic Monitoring v1
-- Forward-only. Monitoring is policy-driven by Wanterest's internal catalog.

insert into public.plan_entitlements (plan_catalog_id, capability_key, value_type, value_json)
select pc.id, values.capability_key, values.value_type, values.value_json::jsonb
from public.plan_catalog pc
cross join (values
  ('monitoring_enabled', 'boolean', 'false'),
  ('intelligence_cycles_per_day', 'integer', '0'),
  ('intelligence_cycle_interval_minutes', 'integer', '0'),
  ('deep_refreshes_per_week', 'integer', '0'),
  ('manual_refresh_cooldown_minutes', 'integer', '1440'),
  ('intelligence_cycle_max_sources', 'integer', '0'),
  ('intelligence_cycle_query_budget', 'integer', '0'),
  ('intelligence_cycle_candidate_budget', 'integer', '0'),
  ('deep_refresh_max_sources', 'integer', '0'),
  ('deep_refresh_query_budget', 'integer', '0'),
  ('deep_refresh_candidate_budget', 'integer', '0'),
  ('x_max_requests_per_cycle', 'integer', '0'),
  ('x_max_billable_posts_per_cycle', 'integer', '0'),
  ('x_max_requests_per_deep_refresh', 'integer', '0'),
  ('x_max_billable_posts_per_deep_refresh', 'integer', '0'),
  ('x_daily_budget_usd', 'decimal', '0'),
  ('digest_enabled', 'boolean', 'false'),
  ('priority_alerts_enabled', 'boolean', 'false')
) as values(capability_key, value_type, value_json)
where pc.plan_code = 'free' and pc.version = 1
on conflict (plan_catalog_id, capability_key) do nothing;

do $$
declare
  v_plan_id uuid;
begin
  select id into v_plan_id from public.plan_catalog where plan_code = 'pro' and version = 1;
  insert into public.plan_entitlements (plan_catalog_id, capability_key, value_type, value_json)
  values
    (v_plan_id, 'monitoring_enabled', 'boolean', 'true'::jsonb),
    (v_plan_id, 'intelligence_cycles_per_day', 'integer', '4'::jsonb),
    (v_plan_id, 'intelligence_cycle_interval_minutes', 'integer', '360'::jsonb),
    (v_plan_id, 'deep_refreshes_per_week', 'integer', '1'::jsonb),
    (v_plan_id, 'manual_refresh_cooldown_minutes', 'integer', '180'::jsonb),
    (v_plan_id, 'intelligence_cycle_max_sources', 'integer', '3'::jsonb),
    (v_plan_id, 'intelligence_cycle_query_budget', 'integer', '8'::jsonb),
    (v_plan_id, 'intelligence_cycle_candidate_budget', 'integer', '18'::jsonb),
    (v_plan_id, 'deep_refresh_max_sources', 'integer', '4'::jsonb),
    (v_plan_id, 'deep_refresh_query_budget', 'integer', '12'::jsonb),
    (v_plan_id, 'deep_refresh_candidate_budget', 'integer', '30'::jsonb),
    (v_plan_id, 'x_max_requests_per_cycle', 'integer', '1'::jsonb),
    (v_plan_id, 'x_max_billable_posts_per_cycle', 'integer', '10'::jsonb),
    (v_plan_id, 'x_max_requests_per_deep_refresh', 'integer', '2'::jsonb),
    (v_plan_id, 'x_max_billable_posts_per_deep_refresh', 'integer', '20'::jsonb),
    (v_plan_id, 'x_daily_budget_usd', 'decimal', '0.5'::jsonb),
    (v_plan_id, 'digest_enabled', 'boolean', 'true'::jsonb),
    (v_plan_id, 'priority_alerts_enabled', 'boolean', 'false'::jsonb)
  on conflict (plan_catalog_id, capability_key) do nothing;

  select id into v_plan_id from public.plan_catalog where plan_code = 'growth' and version = 1;
  insert into public.plan_entitlements (plan_catalog_id, capability_key, value_type, value_json)
  values
    (v_plan_id, 'monitoring_enabled', 'boolean', 'true'::jsonb),
    (v_plan_id, 'intelligence_cycles_per_day', 'integer', '12'::jsonb),
    (v_plan_id, 'intelligence_cycle_interval_minutes', 'integer', '120'::jsonb),
    (v_plan_id, 'deep_refreshes_per_week', 'integer', '3'::jsonb),
    (v_plan_id, 'manual_refresh_cooldown_minutes', 'integer', '60'::jsonb),
    (v_plan_id, 'intelligence_cycle_max_sources', 'integer', '4'::jsonb),
    (v_plan_id, 'intelligence_cycle_query_budget', 'integer', '12'::jsonb),
    (v_plan_id, 'intelligence_cycle_candidate_budget', 'integer', '30'::jsonb),
    (v_plan_id, 'deep_refresh_max_sources', 'integer', '4'::jsonb),
    (v_plan_id, 'deep_refresh_query_budget', 'integer', '16'::jsonb),
    (v_plan_id, 'deep_refresh_candidate_budget', 'integer', '40'::jsonb),
    (v_plan_id, 'x_max_requests_per_cycle', 'integer', '2'::jsonb),
    (v_plan_id, 'x_max_billable_posts_per_cycle', 'integer', '20'::jsonb),
    (v_plan_id, 'x_max_requests_per_deep_refresh', 'integer', '4'::jsonb),
    (v_plan_id, 'x_max_billable_posts_per_deep_refresh', 'integer', '40'::jsonb),
    (v_plan_id, 'x_daily_budget_usd', 'decimal', '2'::jsonb),
    (v_plan_id, 'digest_enabled', 'boolean', 'true'::jsonb),
    (v_plan_id, 'priority_alerts_enabled', 'boolean', 'true'::jsonb)
  on conflict (plan_catalog_id, capability_key) do nothing;
end;
$$;

-- Add new catalog capabilities to existing current revisions without creating a
-- second entitlement revision. Future plan changes use the existing resolver.
do $$
declare
  v_workspace record;
  v_revision integer;
begin
  for v_workspace in
    select distinct on (we.workspace_id)
      we.workspace_id, we.plan_catalog_id, we.source_subscription_id
    from public.workspace_entitlements we
    where we.effective_to is null
    order by we.workspace_id, we.revision desc
  loop
    select coalesce(max(we.revision), 1)
      into v_revision
      from public.workspace_entitlements we
     where we.workspace_id = v_workspace.workspace_id
       and we.effective_to is null;

    insert into public.workspace_entitlements (
      workspace_id, plan_catalog_id, capability_key, value_type, value_json,
      revision, effective_from, source_subscription_id, metadata
    )
    select
      v_workspace.workspace_id, pe.plan_catalog_id, pe.capability_key,
      pe.value_type, pe.value_json, v_revision, timezone('utc', now()),
      v_workspace.source_subscription_id, pe.metadata
    from public.plan_entitlements pe
    where pe.plan_catalog_id = v_workspace.plan_catalog_id
      and pe.capability_key in (
        'monitoring_enabled', 'intelligence_cycles_per_day',
        'intelligence_cycle_interval_minutes', 'deep_refreshes_per_week',
        'manual_refresh_cooldown_minutes', 'intelligence_cycle_max_sources',
        'intelligence_cycle_query_budget', 'intelligence_cycle_candidate_budget',
        'deep_refresh_max_sources', 'deep_refresh_query_budget',
        'deep_refresh_candidate_budget', 'x_max_requests_per_cycle',
        'x_max_billable_posts_per_cycle', 'x_max_requests_per_deep_refresh',
        'x_max_billable_posts_per_deep_refresh', 'x_daily_budget_usd',
        'digest_enabled', 'priority_alerts_enabled'
      )
      and not exists (
        select 1 from public.workspace_entitlements current_we
        where current_we.workspace_id = v_workspace.workspace_id
          and current_we.capability_key = pe.capability_key
          and current_we.effective_to is null
      )
    on conflict (workspace_id, capability_key, revision) do nothing;
  end loop;
end;
$$;

create table if not exists public.monitoring_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  enabled boolean not null default true,
  policy_version text not null default 'automatic-monitoring-v1',
  policy_snapshot jsonb not null default '{}'::jsonb,
  last_cycle_at timestamptz,
  next_cycle_at timestamptz,
  last_deep_refresh_at timestamptz,
  next_deep_refresh_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  lease_token text,
  lease_kind text check (lease_kind is null or lease_kind in ('intelligence_cycle', 'deep_refresh')),
  lease_expires_at timestamptz,
  last_job_run_id uuid,
  last_dispatch_at timestamptz,
  x_cost_day date,
  x_cost_day_usd numeric(12, 6) not null default 0 check (x_cost_day_usd >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, product_id),
  unique (workspace_id, id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade
);

create index if not exists monitoring_schedules_due_idx
  on public.monitoring_schedules (enabled, next_cycle_at, next_deep_refresh_at)
  where enabled;
create index if not exists monitoring_schedules_lease_idx
  on public.monitoring_schedules (lease_expires_at)
  where enabled and lease_expires_at is not null;

create table if not exists public.monitoring_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  alert_type text not null check (alert_type in ('new_high_confidence_signal', 'significant_demand_drift', 'strong_intent', 'new_competitor')),
  target_id uuid,
  evidence_node_id uuid references public.evidence_nodes(id) on delete restrict,
  severity text not null default 'high' check (severity in ('normal', 'high', 'critical')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'suppressed')),
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 1 and 300),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, idempotency_key),
  unique (workspace_id, id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade
);

create index if not exists monitoring_alerts_inbox_idx
  on public.monitoring_alerts (workspace_id, status, created_at desc);

create table if not exists public.digest_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  digest_id uuid not null,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 1 and 300),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default timezone('utc', now()),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, idempotency_key),
  unique (workspace_id, id),
  foreign key (workspace_id, digest_id) references public.digests(workspace_id, id) on delete cascade
);

create index if not exists digest_deliveries_due_idx
  on public.digest_deliveries (status, next_attempt_at);

drop trigger if exists monitoring_schedules_updated_at on public.monitoring_schedules;
create trigger monitoring_schedules_updated_at before update on public.monitoring_schedules
for each row execute function public.updated_at_trigger();
drop trigger if exists monitoring_alerts_updated_at on public.monitoring_alerts;
create trigger monitoring_alerts_updated_at before update on public.monitoring_alerts
for each row execute function public.updated_at_trigger();
drop trigger if exists digest_deliveries_updated_at on public.digest_deliveries;
create trigger digest_deliveries_updated_at before update on public.digest_deliveries
for each row execute function public.updated_at_trigger();

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

-- Seat enforcement is deliberately inside the existing security-definer RPC so
-- concurrent add/reactivate calls cannot bypass team_members.
create or replace function public.add_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role text default 'member',
  p_trace_id text default null
)
returns public.workspace_members
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_member public.workspace_members;
  v_actor uuid := auth.uid();
  v_existing_role text;
  v_existing_status text;
  v_seat_limit integer;
  v_active_count integer;
begin
  if not public.has_workspace_role(p_workspace_id, array['owner', 'admin']) then
    raise exception using errcode = '42501', message = 'member_administration_denied';
  end if;
  if p_role not in ('owner', 'admin', 'member', 'viewer') then
    raise exception using errcode = '22023', message = 'invalid_member_role';
  end if;
  if p_role = 'owner' and not public.has_workspace_role(p_workspace_id, array['owner']) then
    raise exception using errcode = '42501', message = 'owner_role_required';
  end if;

  select wm.role, wm.status into v_existing_role, v_existing_status
    from public.workspace_members wm
   where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id
   for update;

  select case when we.value_type = 'integer' then (we.value_json #>> '{}')::integer else null end
    into v_seat_limit
    from public.workspace_entitlements we
   where we.workspace_id = p_workspace_id
     and we.capability_key = 'team_members'
     and we.effective_to is null;
  if v_seat_limit is null then
    raise exception using errcode = 'P0001', message = 'team_members_capability_missing';
  end if;

  if v_existing_status is distinct from 'active' then
    select count(*) into v_active_count
      from public.workspace_members wm
     where wm.workspace_id = p_workspace_id and wm.status = 'active';
    if v_active_count >= v_seat_limit then
      raise exception using errcode = '22003', message = 'workspace_member_seat_limit_exceeded';
    end if;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (p_workspace_id, p_user_id, p_role, 'active')
  on conflict (workspace_id, user_id) do update
    set role = excluded.role, status = 'active', updated_at = timezone('utc', now())
  returning * into v_member;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_kind, action, target_type, target_id, trace_id, metadata
  ) values (
    p_workspace_id, v_actor, case when public.is_service_role() then 'service' else 'user' end,
    case when v_existing_role is null then 'workspace.member_added' else 'workspace.member_reactivated' end,
    'workspace_member', v_member.id, p_trace_id,
    jsonb_build_object('user_id', p_user_id, 'role', p_role)
  );

  return v_member;
end;
$$;

grant execute on function public.add_workspace_member(uuid, uuid, text, text) to authenticated, service_role;

alter table public.monitoring_schedules enable row level security;
alter table public.monitoring_alerts enable row level security;
alter table public.digest_deliveries enable row level security;

drop policy if exists monitoring_schedules_select_member on public.monitoring_schedules;
create policy monitoring_schedules_select_member on public.monitoring_schedules
for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists monitoring_alerts_select_member on public.monitoring_alerts;
create policy monitoring_alerts_select_member on public.monitoring_alerts
for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists digest_deliveries_select_member on public.digest_deliveries;
create policy digest_deliveries_select_member on public.digest_deliveries
for select to authenticated using (public.is_workspace_member(workspace_id));

revoke insert, update, delete on public.monitoring_schedules from anon, authenticated;
revoke insert, update, delete on public.monitoring_alerts from anon, authenticated;
revoke insert, update, delete on public.digest_deliveries from anon, authenticated;
grant select on public.monitoring_schedules, public.monitoring_alerts, public.digest_deliveries to authenticated;
grant all on public.monitoring_schedules, public.monitoring_alerts, public.digest_deliveries to service_role;

comment on table public.monitoring_schedules is 'One durable, policy-driven schedule per workspace product; leases make due dispatch atomic.';
comment on table public.monitoring_alerts is 'Persistent priority-alert foundation with idempotent delivery state.';
comment on table public.digest_deliveries is 'Idempotent digest-recipient delivery state; provider delivery is intentionally separate.';
