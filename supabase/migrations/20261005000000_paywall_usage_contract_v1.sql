-- Paywalls v1: manual scan usage is distinct from automatic monitoring scans.
-- Monitoring consumes source_scan; user-triggered refreshes consume manual_scan.

alter table public.usage_ledger
  drop constraint if exists usage_ledger_usage_type_check;

alter table public.usage_ledger
  add constraint usage_ledger_usage_type_check check (
    usage_type in (
      'qualified_signal',
      'source_scan',
      'manual_scan',
      'action_generated',
      'experiment_created',
      'export'
    )
  );

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
  if p_usage_type not in ('qualified_signal', 'source_scan', 'manual_scan', 'action_generated', 'experiment_created', 'export') then
    raise exception using errcode = '22023', message = 'invalid_usage_type';
  end if;
  if not public.is_service_role() and not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_usage_type, 0));

  select * into v_existing
    from public.usage_ledger
   where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return v_existing;
  end if;

  v_capability := case p_usage_type
    when 'qualified_signal' then 'signals_monthly'
    when 'manual_scan' then 'manual_scans_monthly'
    when 'action_generated' then 'actions_enabled'
    when 'experiment_created' then 'experiments_max'
    when 'export' then 'exports'
    else null
  end;

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
         and ul.occurred_at >= v_period_start;
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
    if v_existing.id is not null then
      return v_existing;
    end if;
    raise;
end;
$$;

revoke all on function public.consume_usage(uuid, text, bigint, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.consume_usage(uuid, text, bigint, text, jsonb, uuid, text) to service_role;
