-- Layer 13A.2B: server-private Dodo discount binding history.
-- Wanterest entitlement timestamps remain authoritative. These rows record
-- provider enforcement objects and interval-specific replacements only.

create table if not exists public.workspace_cohort_benefit_provider_bindings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  entitlement_id uuid not null,
  provider text not null check (provider = 'dodo'),
  provider_discount_id text not null check (char_length(trim(provider_discount_id)) between 1 and 200),
  provider_discount_code text not null check (char_length(trim(provider_discount_code)) between 1 and 200),
  billing_interval text not null check (billing_interval in ('monthly', 'annual')),
  cycle_limit integer not null check (cycle_limit > 0),
  discount_percent smallint not null check (discount_percent between 1 and 100),
  status text not null default 'active' check (status in ('active', 'superseded', 'expired', 'revoked')),
  created_at timestamptz not null default timezone('utc', now()),
  superseded_at timestamptz,
  last_synced_at timestamptz not null default timezone('utc', now()),
  unique (provider, provider_discount_id),
  unique (workspace_id, id),
  foreign key (workspace_id, entitlement_id)
    references public.workspace_cohort_benefit_entitlements (workspace_id, id) on delete restrict
);

create unique index if not exists workspace_cohort_benefit_provider_active_idx
  on public.workspace_cohort_benefit_provider_bindings (entitlement_id, billing_interval)
  where status = 'active';

create index if not exists workspace_cohort_benefit_provider_entitlement_idx
  on public.workspace_cohort_benefit_provider_bindings (workspace_id, entitlement_id, created_at desc);

alter table public.workspace_cohort_benefit_provider_bindings enable row level security;
revoke all on public.workspace_cohort_benefit_provider_bindings from public, anon, authenticated;
grant all on public.workspace_cohort_benefit_provider_bindings to service_role;

create or replace function public.upsert_workspace_cohort_benefit_provider_binding(
  p_workspace_id uuid,
  p_entitlement_id uuid,
  p_provider text,
  p_provider_discount_id text,
  p_provider_discount_code text,
  p_billing_interval text,
  p_cycle_limit integer,
  p_discount_percent integer
)
returns table (
  binding_id uuid,
  provider_discount_id text,
  provider_discount_code text,
  billing_interval text,
  cycle_limit integer,
  status text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_entitlement public.workspace_cohort_benefit_entitlements;
  v_binding public.workspace_cohort_benefit_provider_bindings;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'workspace_cohort_benefit_service_role_required';
  end if;
  if p_provider <> 'dodo'
     or p_billing_interval not in ('monthly', 'annual')
     or p_provider_discount_id is null
     or p_provider_discount_code is null
     or p_cycle_limit is null or p_cycle_limit < 1
     or p_discount_percent is null or p_discount_percent not between 1 and 100 then
    raise exception using errcode = '22023', message = 'workspace_cohort_benefit_provider_binding_invalid';
  end if;

  select e.* into v_entitlement
    from public.workspace_cohort_benefit_entitlements as e
   where e.workspace_id = p_workspace_id and e.id = p_entitlement_id
   for update;
  if v_entitlement.id is null then
    raise exception using errcode = 'P0002', message = 'workspace_cohort_benefit_not_found';
  end if;
  if p_discount_percent <> v_entitlement.discount_percent then
    raise exception using errcode = '22023', message = 'workspace_cohort_benefit_provider_discount_mismatch';
  end if;
  if exists (
    select 1
      from public.workspace_cohort_benefit_provider_bindings as existing
     where existing.provider = p_provider
       and existing.provider_discount_id = trim(p_provider_discount_id)
       and (existing.workspace_id <> p_workspace_id or existing.entitlement_id <> p_entitlement_id)
  ) then
    raise exception using errcode = '23505', message = 'workspace_cohort_benefit_provider_binding_identity_conflict';
  end if;

  update public.workspace_cohort_benefit_provider_bindings
     set status = 'superseded', superseded_at = timezone('utc', now()), last_synced_at = timezone('utc', now())
   where entitlement_id = p_entitlement_id
     and billing_interval = p_billing_interval
     and status = 'active'
     and provider_discount_id <> trim(p_provider_discount_id);

  insert into public.workspace_cohort_benefit_provider_bindings (
    workspace_id, entitlement_id, provider, provider_discount_id, provider_discount_code,
    billing_interval, cycle_limit, discount_percent, status, superseded_at, last_synced_at
  ) values (
    p_workspace_id, p_entitlement_id, p_provider, trim(p_provider_discount_id), trim(p_provider_discount_code),
    p_billing_interval, p_cycle_limit, p_discount_percent, 'active', null, timezone('utc', now())
  )
  on conflict (provider, provider_discount_id) do update set
    workspace_id = excluded.workspace_id,
    entitlement_id = excluded.entitlement_id,
    provider_discount_code = excluded.provider_discount_code,
    billing_interval = excluded.billing_interval,
    cycle_limit = excluded.cycle_limit,
    discount_percent = excluded.discount_percent,
    status = 'active',
    superseded_at = null,
    last_synced_at = timezone('utc', now())
  returning * into v_binding;

  update public.workspace_cohort_benefit_entitlements
     set external_discount_reference = v_binding.provider_discount_id
   where workspace_id = p_workspace_id and id = p_entitlement_id;

  insert into public.workspace_cohort_benefit_events (
    workspace_id, entitlement_id, event_key, event_type, actor_kind, metadata
  ) values (
    p_workspace_id, p_entitlement_id,
    'provider-discount-applied:' || v_binding.id::text || ':' || v_binding.cycle_limit::text,
    'provider_discount_applied', 'service',
    jsonb_build_object(
      'provider', v_binding.provider,
      'provider_discount_id', v_binding.provider_discount_id,
      'billing_interval', v_binding.billing_interval,
      'cycle_limit', v_binding.cycle_limit,
      'discount_percent', v_binding.discount_percent
    )
  ) on conflict (event_key) do nothing;

  return query select v_binding.id, v_binding.provider_discount_id, v_binding.provider_discount_code,
    v_binding.billing_interval, v_binding.cycle_limit, v_binding.status;
end;
$$;

revoke all on function public.upsert_workspace_cohort_benefit_provider_binding(uuid, uuid, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.upsert_workspace_cohort_benefit_provider_binding(uuid, uuid, text, text, text, text, integer, integer) to service_role;

comment on table public.workspace_cohort_benefit_provider_bindings is 'Server-private Dodo discount bindings; Wanterest entitlement terms and calendar expiry remain authoritative.';
comment on column public.workspace_cohort_benefit_provider_bindings.cycle_limit is 'Finite provider billing cycles whose billing-cycle start is eligible under the current binding.';
