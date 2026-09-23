-- Plan v1 enforcement at existing atomic database boundaries.

create or replace function public.consume_usage(
  p_workspace_id uuid,
  p_usage_type text,
  p_amount bigint,
  p_idempotency_key text,
  p_source_metadata jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_trace_id text default null
)
returns public.usage_ledger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_existing public.usage_ledger;
  v_entry public.usage_ledger;
  v_capability text;
  v_value_type text;
  v_value jsonb;
  v_limit bigint;
  v_used bigint;
  v_period_start timestamptz := date_trunc('month', timezone('utc', now()));
begin
  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '22023', message = 'usage_amount_must_be_positive';
  end if;
  if p_usage_type not in ('qualified_signal', 'source_scan', 'action_generated', 'experiment_created', 'export') then
    raise exception using errcode = '22023', message = 'invalid_usage_type';
  end if;
  if not public.is_service_role() and not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_usage_type, 0));
  select * into v_existing
    from public.usage_ledger
   where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then return v_existing; end if;

  v_capability := case p_usage_type
    when 'qualified_signal' then 'signals_monthly'
    when 'action_generated' then 'actions_enabled'
    when 'experiment_created' then 'experiments_max'
    when 'export' then 'exports'
    else null
  end;
  if p_usage_type = 'source_scan'
     and coalesce(p_source_metadata ->> 'scanProfile', '') in ('manual_standard', 'manual_deep') then
    v_capability := 'manual_scans_monthly';
  end if;

  if v_capability is not null then
    select we.value_type, we.value_json
      into v_value_type, v_value
      from public.workspace_entitlements we
     where we.workspace_id = p_workspace_id
       and we.capability_key = v_capability
       and we.effective_to is null;
    if v_value is null then
      raise exception using errcode = '22023', message = 'entitlement_not_resolved';
    end if;
    if v_value_type = 'boolean' and coalesce((v_value #>> '{}')::boolean, false) = false then
      raise exception using errcode = 'P0001', message = 'usage_capability_disabled';
    end if;
    if v_value_type in ('integer', 'decimal') then
      v_limit := floor((v_value #>> '{}')::numeric)::bigint;
      select coalesce(sum(ul.amount), 0)
        into v_used
        from public.usage_ledger ul
       where ul.workspace_id = p_workspace_id
         and ul.usage_type = p_usage_type
         and ul.occurred_at >= v_period_start
         and (
           p_usage_type <> 'source_scan'
           or coalesce(ul.source_metadata ->> 'scanProfile', '') in ('manual_standard', 'manual_deep')
         );
      if v_used + p_amount > v_limit then
        raise exception using errcode = '22003', message = 'usage_limit_exceeded';
      end if;
    end if;
  end if;

  insert into public.usage_ledger (
    workspace_id, usage_type, amount, idempotency_key, actor_user_id, trace_id, source_metadata
  ) values (
    p_workspace_id, p_usage_type, p_amount, p_idempotency_key,
    coalesce(p_actor_user_id, auth.uid()), p_trace_id, p_source_metadata
  )
  returning * into v_entry;
  return v_entry;
exception
  when unique_violation then
    select * into v_existing
      from public.usage_ledger
     where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
    if v_existing.id is not null then return v_existing; end if;
    raise;
end;
$$;

create or replace function public.add_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role text default 'member',
  p_trace_id text default null
)
returns public.workspace_members
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_member public.workspace_members;
  v_actor uuid := auth.uid();
  v_existing_role text;
  v_seat_limit bigint;
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

  select (value_json #>> '{}')::bigint into v_seat_limit
    from public.workspace_entitlements
   where workspace_id = p_workspace_id
     and capability_key = 'team_members'
     and effective_to is null;
  if v_seat_limit is null then
    raise exception using errcode = 'P0001', message = 'team_members_capability_missing';
  end if;
  if not exists (
    select 1 from public.workspace_members
     where workspace_id = p_workspace_id and user_id = p_user_id and status = 'active'
  ) and (
    select count(*) from public.workspace_members
     where workspace_id = p_workspace_id and status = 'active'
  ) >= v_seat_limit then
    raise exception using errcode = '22003', message = 'seat_limit_exceeded';
  end if;

  select wm.role into v_existing_role
    from public.workspace_members wm
   where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id;
  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (p_workspace_id, p_user_id, p_role, 'active')
  on conflict (workspace_id, user_id) do update
    set role = excluded.role, status = 'active', updated_at = timezone('utc', now())
  returning * into v_member;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_kind, action, target_type, target_id, trace_id, metadata
  ) values (
    p_workspace_id, v_actor,
    case when public.is_service_role() then 'service' else 'user' end,
    case when v_existing_role is null then 'workspace.member_added' else 'workspace.member_reactivated' end,
    'workspace_member', v_member.id, p_trace_id,
    jsonb_build_object('user_id', p_user_id, 'role', p_role)
  );
  return v_member;
end;
$$;

