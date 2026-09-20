-- Phase 6: Dodo billing, normalized subscriptions, entitlement revisions, and reconciliation.
-- Forward-only. Earlier phase migrations remain unchanged.

alter table public.job_runs drop constraint if exists job_runs_job_type_check;
alter table public.job_runs add constraint job_runs_job_type_check check (job_type in (
  'discover-source', 'normalize-source-items', 'dedupe-conversations',
  'analyze-conversations', 'match-product', 'rank-matches',
  'aggregate-demand', 'calculate-demand-gap', 'calculate-demand-drift',
  'backfill-demand-snapshots', 'generate-actions', 'build-digest',
  'process-billing-webhook', 'reconcile-billing-subscription'
));

-- Wanterest owns this catalog. Dodo products are mapped to these plans in the provider
-- adapter and never become capability identifiers.
insert into public.plan_catalog (plan_code, version, status, metadata)
values
  ('pro', 1, 'active', jsonb_build_object('provider', 'internal', 'currency', 'USD', 'monthly_price', 49, 'annual_price', 468)),
  ('growth', 1, 'active', jsonb_build_object('provider', 'internal', 'currency', 'USD', 'monthly_price', 99, 'annual_price', 948))
on conflict (plan_code, version) do nothing;

do $$
declare
  v_plan_id uuid;
begin
  select id into v_plan_id from public.plan_catalog where plan_code = 'pro' and version = 1;
  insert into public.plan_entitlements (plan_catalog_id, capability_key, value_type, value_json)
  values
    (v_plan_id, 'products_max', 'integer', '3'::jsonb),
    (v_plan_id, 'signals_monthly', 'integer', '500'::jsonb),
    (v_plan_id, 'scan_frequency', 'enum', '"daily"'::jsonb),
    (v_plan_id, 'demand_map', 'enum', '"full"'::jsonb),
    (v_plan_id, 'demand_gap', 'enum', '"full"'::jsonb),
    (v_plan_id, 'demand_drift_days', 'integer', '30'::jsonb),
    (v_plan_id, 'actions_enabled', 'boolean', 'true'::jsonb),
    (v_plan_id, 'experiments_max', 'integer', '2'::jsonb),
    (v_plan_id, 'exports', 'boolean', 'false'::jsonb),
    (v_plan_id, 'team_members', 'integer', '1'::jsonb)
  on conflict (plan_catalog_id, capability_key) do nothing;

  select id into v_plan_id from public.plan_catalog where plan_code = 'growth' and version = 1;
  insert into public.plan_entitlements (plan_catalog_id, capability_key, value_type, value_json)
  values
    (v_plan_id, 'products_max', 'integer', '10'::jsonb),
    (v_plan_id, 'signals_monthly', 'integer', '2000'::jsonb),
    (v_plan_id, 'scan_frequency', 'enum', '"frequent"'::jsonb),
    (v_plan_id, 'demand_map', 'enum', '"advanced"'::jsonb),
    (v_plan_id, 'demand_gap', 'enum', '"advanced"'::jsonb),
    (v_plan_id, 'demand_drift_days', 'integer', '90'::jsonb),
    (v_plan_id, 'actions_enabled', 'boolean', 'true'::jsonb),
    (v_plan_id, 'experiments_max', 'integer', '10'::jsonb),
    (v_plan_id, 'exports', 'boolean', 'true'::jsonb),
    (v_plan_id, 'team_members', 'integer', '3'::jsonb)
  on conflict (plan_catalog_id, capability_key) do nothing;
end;
$$;

create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider = 'dodo'),
  provider_customer_id text not null check (char_length(trim(provider_customer_id)) between 1 and 300),
  email text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, provider),
  unique (provider, provider_customer_id),
  unique (workspace_id, id)
);

create index if not exists billing_customers_workspace_idx
  on public.billing_customers (workspace_id, status);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  billing_customer_id uuid not null,
  provider text not null check (provider = 'dodo'),
  provider_subscription_id text not null check (char_length(trim(provider_subscription_id)) between 1 and 300),
  internal_plan text not null check (internal_plan in ('free', 'pro', 'growth')),
  billing_interval text not null check (billing_interval in ('monthly', 'annual')),
  status text not null check (status in ('free', 'trialing', 'active', 'past_due', 'canceling', 'canceled', 'expired', 'incomplete')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  payment_failure_state text,
  provider_product_id text not null check (char_length(trim(provider_product_id)) between 1 and 300),
  provider_price_reference text,
  provider_updated_at timestamptz,
  last_provider_event_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (provider, provider_subscription_id),
  unique (workspace_id, id),
  foreign key (workspace_id, billing_customer_id)
    references public.billing_customers (workspace_id, id) on delete restrict,
  check (current_period_end is null or current_period_start is null or current_period_end > current_period_start),
  check (status <> 'canceling' or cancel_at_period_end = true),
  check (status in ('canceled', 'expired') or ended_at is null)
);

create index if not exists subscriptions_workspace_status_idx
  on public.subscriptions (workspace_id, status, updated_at desc);

create index if not exists subscriptions_reconciliation_idx
  on public.subscriptions (status, provider_updated_at);

alter table public.workspace_entitlements
  add column if not exists source_subscription_id uuid;

alter table public.workspace_entitlements
  drop constraint if exists workspace_entitlements_source_subscription_fkey;
alter table public.workspace_entitlements
  add constraint workspace_entitlements_source_subscription_fkey
  foreign key (workspace_id, source_subscription_id)
  references public.subscriptions (workspace_id, id) on delete set null;

create table if not exists public.billing_checkout_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  checkout_reference text not null check (char_length(trim(checkout_reference)) between 1 and 240),
  internal_plan text not null check (internal_plan in ('pro', 'growth')),
  billing_interval text not null check (billing_interval in ('monthly', 'annual')),
  provider text not null default 'dodo' check (provider = 'dodo'),
  provider_checkout_id text,
  checkout_url text,
  status text not null default 'created' check (status in ('created', 'completed', 'expired', 'failed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, checkout_reference),
  unique (workspace_id, id)
);

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'dodo'),
  provider_event_id text not null check (char_length(trim(provider_event_id)) between 1 and 300),
  event_type text not null check (char_length(trim(event_type)) between 1 and 160),
  received_at timestamptz not null default timezone('utc', now()),
  provider_occurred_at timestamptz,
  signature_verified boolean not null default false,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  processing_status text not null default 'received' check (processing_status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  processed_at timestamptz,
  error_code text,
  sanitized_error text,
  trace_id text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (provider, provider_event_id)
);

create index if not exists billing_webhook_events_processing_idx
  on public.billing_webhook_events (processing_status, received_at);

create index if not exists billing_webhook_events_subscription_idx
  on public.billing_webhook_events (provider, event_type, provider_occurred_at);

create or replace function public.resolve_billing_entitlements(
  p_workspace_id uuid,
  p_plan_code text,
  p_source_subscription_id uuid default null,
  p_actor_user_id uuid default null,
  p_trace_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_plan_id uuid;
  v_revision integer;
  v_now timestamptz := timezone('utc', now());
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;

  select pc.id into v_plan_id
    from public.plan_catalog pc
   where pc.plan_code = p_plan_code
     and pc.status = 'active'
     and pc.effective_to is null
   order by pc.version desc
   limit 1;

  if v_plan_id is null then
    raise exception using errcode = '22023', message = 'plan_catalog_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':entitlements', 0));

  if exists (
    select 1 from public.workspace_entitlements we
     where we.workspace_id = p_workspace_id
       and we.effective_to is null
       and we.plan_catalog_id = v_plan_id
       and we.source_subscription_id is not distinct from p_source_subscription_id
  ) then
    return;
  end if;

  select coalesce(max(we.revision), 0) + 1 into v_revision
    from public.workspace_entitlements we
   where we.workspace_id = p_workspace_id;

  update public.workspace_entitlements
     set effective_to = v_now
   where workspace_id = p_workspace_id
     and effective_to is null;

  insert into public.workspace_entitlements (
    workspace_id, plan_catalog_id, capability_key, value_type, value_json,
    revision, effective_from, source_subscription_id, metadata
  )
  select
    p_workspace_id, pe.plan_catalog_id, pe.capability_key, pe.value_type, pe.value_json,
    v_revision, v_now, p_source_subscription_id,
    jsonb_build_object('source', 'billing', 'source_subscription_id', p_source_subscription_id) || pe.metadata
    from public.plan_entitlements pe
   where pe.plan_catalog_id = v_plan_id;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_kind, action, target_type, trace_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'service', 'billing.entitlement_revision_changed',
    'workspace_entitlements', p_trace_id,
    jsonb_build_object('plan_code', p_plan_code, 'plan_catalog_id', v_plan_id,
      'revision', v_revision, 'source_subscription_id', p_source_subscription_id)
  );
end;
$$;

create or replace function public.apply_normalized_subscription(
  p_workspace_id uuid,
  p_provider_customer_id text,
  p_customer_email text,
  p_provider_subscription_id text,
  p_internal_plan text,
  p_billing_interval text,
  p_status text,
  p_current_period_start timestamptz default null,
  p_current_period_end timestamptz default null,
  p_cancel_at_period_end boolean default false,
  p_canceled_at timestamptz default null,
  p_ended_at timestamptz default null,
  p_payment_failure_state text default null,
  p_provider_product_id text default null,
  p_provider_price_reference text default null,
  p_provider_updated_at timestamptz default null,
  p_provider_event_id text default null,
  p_actor_user_id uuid default null,
  p_trace_id text default null
)
returns public.subscriptions
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_customer public.billing_customers;
  v_subscription public.subscriptions;
  v_existing public.subscriptions;
  v_effective_plan text;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;
  if p_internal_plan not in ('pro', 'growth') then
    raise exception using errcode = '22023', message = 'paid_plan_required';
  end if;

  insert into public.billing_customers (
    workspace_id, provider, provider_customer_id, email, status
  ) values (
    p_workspace_id, 'dodo', p_provider_customer_id, p_customer_email, 'active'
  )
  on conflict (workspace_id, provider) do update set
    provider_customer_id = excluded.provider_customer_id,
    email = coalesce(excluded.email, public.billing_customers.email),
    status = 'active',
    updated_at = timezone('utc', now())
  returning * into v_customer;

  select * into v_existing
    from public.subscriptions
   where provider = 'dodo'
     and provider_subscription_id = p_provider_subscription_id
   for update;

  if v_existing.id is not null and v_existing.workspace_id <> p_workspace_id then
    raise exception using errcode = '23514', message = 'workspace_billing_mismatch';
  end if;

  if v_existing.id is not null
     and v_existing.provider_updated_at is not null
     and p_provider_updated_at is not null
     and p_provider_updated_at < v_existing.provider_updated_at then
    return v_existing;
  end if;

  if v_existing.id is null then
    insert into public.subscriptions (
      workspace_id, billing_customer_id, provider, provider_subscription_id,
      internal_plan, billing_interval, status, current_period_start,
      current_period_end, cancel_at_period_end, canceled_at, ended_at,
      payment_failure_state, provider_product_id, provider_price_reference,
      provider_updated_at, last_provider_event_id
    ) values (
      p_workspace_id, v_customer.id, 'dodo', p_provider_subscription_id,
      p_internal_plan, p_billing_interval, p_status, p_current_period_start,
      p_current_period_end, p_cancel_at_period_end, p_canceled_at, p_ended_at,
      p_payment_failure_state, coalesce(p_provider_product_id, 'unknown'), p_provider_price_reference,
      p_provider_updated_at, p_provider_event_id
    ) returning * into v_subscription;
  else
    update public.subscriptions set
      workspace_id = p_workspace_id,
      billing_customer_id = v_customer.id,
      internal_plan = p_internal_plan,
      billing_interval = p_billing_interval,
      status = p_status,
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      cancel_at_period_end = p_cancel_at_period_end,
      canceled_at = p_canceled_at,
      ended_at = p_ended_at,
      payment_failure_state = p_payment_failure_state,
      provider_product_id = coalesce(p_provider_product_id, provider_product_id),
      provider_price_reference = coalesce(p_provider_price_reference, provider_price_reference),
      provider_updated_at = p_provider_updated_at,
      last_provider_event_id = p_provider_event_id,
      updated_at = timezone('utc', now())
    where id = v_existing.id
    returning * into v_subscription;
  end if;

  -- past_due preserves the current paid revision during the documented grace period.
  if p_status = 'past_due' then
    return v_subscription;
  end if;

  v_effective_plan := case
    when p_status in ('active', 'trialing', 'canceling') then p_internal_plan
    else 'free'
  end;

  perform public.resolve_billing_entitlements(
    p_workspace_id, v_effective_plan, v_subscription.id, p_actor_user_id, p_trace_id
  );

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_kind, action, target_type, target_id, trace_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'service', 'billing.subscription_normalized',
    'subscriptions', v_subscription.id, p_trace_id,
    jsonb_build_object('status', p_status, 'internal_plan', p_internal_plan,
      'effective_plan', v_effective_plan, 'provider_event_id', p_provider_event_id)
  );

  return v_subscription;
end;
$$;

alter table public.billing_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_checkout_requests enable row level security;
alter table public.billing_webhook_events enable row level security;

revoke all on public.billing_customers from anon, authenticated;
revoke all on public.subscriptions from anon, authenticated;
revoke all on public.billing_checkout_requests from anon, authenticated;
revoke all on public.billing_webhook_events from anon, authenticated;
grant select on public.billing_customers to authenticated;
grant select on public.subscriptions to authenticated;
grant all on public.billing_customers to service_role;
grant all on public.subscriptions to service_role;
grant all on public.billing_checkout_requests to service_role;
grant all on public.billing_webhook_events to service_role;

drop policy if exists billing_customers_member_select on public.billing_customers;
create policy billing_customers_member_select on public.billing_customers
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists subscriptions_member_select on public.subscriptions;
create policy subscriptions_member_select on public.subscriptions
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop trigger if exists billing_customers_updated_at on public.billing_customers;
create trigger billing_customers_updated_at before update on public.billing_customers
for each row execute function public.updated_at_trigger();

drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at before update on public.subscriptions
for each row execute function public.updated_at_trigger();

drop trigger if exists billing_checkout_requests_updated_at on public.billing_checkout_requests;
create trigger billing_checkout_requests_updated_at before update on public.billing_checkout_requests
for each row execute function public.updated_at_trigger();

grant execute on function public.resolve_billing_entitlements(uuid, text, uuid, uuid, text) to service_role;
grant execute on function public.apply_normalized_subscription(uuid, text, text, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, text, text, text, timestamptz, text, uuid, text) to service_role;

comment on table public.billing_customers is 'Normalized workspace billing identity; provider IDs are reconciliation metadata.';
comment on table public.subscriptions is 'Wanterest-owned normalized subscription state; access comes from internal entitlements.';
comment on table public.billing_webhook_events is 'Verified Dodo webhook inbox and durable idempotency boundary; never client writable.';
comment on table public.billing_checkout_requests is 'Server-side checkout idempotency boundary; browser never chooses provider products or prices.';
