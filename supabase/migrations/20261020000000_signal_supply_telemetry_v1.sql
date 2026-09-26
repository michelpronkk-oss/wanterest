-- Layer 12A.1: signal supply telemetry v1 (observational only).
-- Additive. Facts are written prospectively, best-effort, only while
-- SIGNAL_SUPPLY_TELEMETRY_ENABLED=true; nothing here changes discovery,
-- selection, qualification, materialization or clustering. No backfill.
-- See docs/architecture.md Section 24.

-- ------------------------------------------------ global refresh facts
-- One immutable row per market-partition refresh job. Public-market
-- operational data only: no workspace, product or tenant interpretation.
create table if not exists public.supply_refresh_facts (
  id uuid primary key default gen_random_uuid(),
  telemetry_version text not null check (telemetry_version = 'signal_supply_telemetry_v1'),
  job_run_id uuid not null unique references public.job_runs(id) on delete cascade,
  market_partition_id uuid not null references public.market_partitions(id) on delete restrict,
  partition_key text not null check (char_length(trim(partition_key)) between 1 and 300),
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  refresh_status text not null check (refresh_status in ('succeeded', 'failed', 'deferred')),
  execution_status text check (execution_status is null or char_length(execution_status) between 1 and 60),
  refresh_started_at timestamptz not null,
  refresh_finished_at timestamptz not null,
  raw_count integer not null check (raw_count >= 0),
  raw_new_count integer not null check (raw_new_count >= 0),
  normalized_count integer not null check (normalized_count >= 0),
  unique_conversation_count integer not null check (unique_conversation_count >= 0),
  new_canonical_count integer check (new_canonical_count is null or new_canonical_count >= 0),
  reused_canonical_count integer check (reused_canonical_count is null or reused_canonical_count >= 0),
  pages_completed integer check (pages_completed is null or pages_completed >= 0),
  provider_request_count integer check (provider_request_count is null or provider_request_count >= 0),
  provider_cost_value numeric check (provider_cost_value is null or provider_cost_value >= 0),
  provider_cost_unit text not null check (provider_cost_unit in ('usd', 'quota_units', 'requests', 'unknown')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  check (refresh_finished_at >= refresh_started_at),
  check (raw_new_count <= raw_count),
  check ((new_canonical_count is null) = (reused_canonical_count is null)),
  check (new_canonical_count is null or new_canonical_count + reused_canonical_count = unique_conversation_count),
  -- Unknown cost stays unknown: a value exists exactly when its unit is known. Units never mix.
  check ((provider_cost_value is null) = (provider_cost_unit = 'unknown'))
);
create index if not exists supply_refresh_facts_source_finished_idx on public.supply_refresh_facts (source_key, refresh_finished_at);
create index if not exists supply_refresh_facts_partition_finished_idx on public.supply_refresh_facts (market_partition_id, refresh_finished_at);
create index if not exists supply_refresh_facts_finished_idx on public.supply_refresh_facts (refresh_finished_at);

-- ------------------------------------------------ product supply facts (tenant-private)
-- One immutable row per incremental product-match job (= one refresh x one product).
create table if not exists public.product_supply_facts (
  id uuid primary key default gen_random_uuid(),
  telemetry_version text not null check (telemetry_version = 'signal_supply_telemetry_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  job_run_id uuid not null unique references public.job_runs(id) on delete cascade,
  refresh_job_run_id uuid not null references public.job_runs(id) on delete cascade,
  market_partition_id uuid references public.market_partitions(id) on delete restrict,
  partition_key text not null check (char_length(trim(partition_key)) between 1 and 300),
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  refresh_conversation_count integer not null check (refresh_conversation_count >= 0),
  already_matched_count integer not null check (already_matched_count >= 0),
  candidate_count integer not null check (candidate_count >= 0),
  overflow_count integer not null check (overflow_count >= 0),
  selected_count integer not null check (selected_count >= 0),
  evaluated_count integer not null check (evaluated_count >= 0),
  weak_count integer not null check (weak_count >= 0),
  rejected_count integer not null check (rejected_count >= 0),
  qualified_count integer not null check (qualified_count >= 0),
  materialized_count integer not null check (materialized_count >= 0),
  demand_rebuilt boolean not null,
  clusters_created_count integer check (clusters_created_count is null or clusters_created_count >= 0),
  cluster_memberships_created_count integer check (cluster_memberships_created_count is null or cluster_memberships_created_count >= 0),
  reasoning_call_count integer check (reasoning_call_count is null or reasoning_call_count >= 0),
  reasoning_cost_value numeric check (reasoning_cost_value is null or reasoning_cost_value >= 0),
  reasoning_cost_unit text not null check (reasoning_cost_unit in ('usd', 'unknown')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (refresh_job_run_id, product_id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  check (finished_at >= started_at),
  check (qualified_count + weak_count + rejected_count <= evaluated_count),
  check ((reasoning_cost_value is null) = (reasoning_cost_unit = 'unknown'))
);
create index if not exists product_supply_facts_scope_finished_idx on public.product_supply_facts (workspace_id, product_id, finished_at);
create index if not exists product_supply_facts_source_finished_idx on public.product_supply_facts (source_key, finished_at);

-- Tenant integrity: the product job must belong to exactly this workspace/product
-- (job_runs carries the scope); the refresh job must be the global refresh.
create or replace function public.enforce_product_supply_fact_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from public.job_runs j
     where j.id = new.job_run_id and j.workspace_id = new.workspace_id and j.product_id = new.product_id
       and j.job_type = 'match-product-incremental'
  ) then
    raise exception using errcode = '23514', message = 'product_supply_fact_scope_mismatch';
  end if;
  if not exists (
    select 1 from public.job_runs r
     where r.id = new.refresh_job_run_id and r.workspace_id is null and r.job_type = 'refresh-market-partition'
  ) then
    raise exception using errcode = '23514', message = 'product_supply_fact_refresh_mismatch';
  end if;
  return new;
end;
$$;
drop trigger if exists product_supply_facts_scope on public.product_supply_facts;
create trigger product_supply_facts_scope before insert on public.product_supply_facts
for each row execute function public.enforce_product_supply_fact_scope();

create or replace function public.enforce_supply_refresh_fact_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from public.job_runs j
     where j.id = new.job_run_id and j.workspace_id is null and j.product_id is null and j.job_type = 'refresh-market-partition'
  ) then
    raise exception using errcode = '23514', message = 'supply_refresh_fact_job_mismatch';
  end if;
  return new;
end;
$$;
drop trigger if exists supply_refresh_facts_scope on public.supply_refresh_facts;
create trigger supply_refresh_facts_scope before insert on public.supply_refresh_facts
for each row execute function public.enforce_supply_refresh_fact_scope();

-- Facts are finalized once and never edited (replays insert-or-ignore).
-- Deletes stay possible only through job_runs retention cascades.
create or replace function public.prevent_supply_fact_update()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '55000', message = 'supply_fact_immutable';
end;
$$;
drop trigger if exists supply_refresh_facts_immutable on public.supply_refresh_facts;
create trigger supply_refresh_facts_immutable before update on public.supply_refresh_facts
for each row execute function public.prevent_supply_fact_update();
drop trigger if exists product_supply_facts_immutable on public.product_supply_facts;
create trigger product_supply_facts_immutable before update on public.product_supply_facts
for each row execute function public.prevent_supply_fact_update();

-- ------------------------------------------------ first-qualified counting support
create index if not exists product_match_evaluations_first_qualified_idx
  on public.product_match_evaluations (workspace_id, product_id, conversation_id, created_at)
  where decision = 'qualified';
create index if not exists product_match_evaluations_qualified_created_idx
  on public.product_match_evaluations (created_at)
  where decision = 'qualified';

-- ------------------------------------------------ funnel (bounded, service role only)
-- Window is required and at most 31 days; costs are grouped by unit and never
-- summed across units; rates only where the denominator is known and > 0.
create or replace function public.signal_supply_funnel(
  p_since timestamptz,
  p_until timestamptz,
  p_workspace_id uuid default null,
  p_product_id uuid default null
)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_result jsonb;
begin
  if p_since is null or p_until is null or p_until <= p_since or p_until - p_since > interval '31 days' then
    raise exception using errcode = '22023', message = 'signal_supply_window_invalid';
  end if;
  if p_product_id is not null and p_workspace_id is null then
    raise exception using errcode = '22023', message = 'signal_supply_scope_invalid';
  end if;

  with rf as (
    select * from public.supply_refresh_facts
     where refresh_finished_at >= p_since and refresh_finished_at < p_until
  ),
  refresh_by_source as (
    select source_key,
           count(*) as refresh_jobs,
           count(*) filter (where refresh_status = 'succeeded') as succeeded_jobs,
           sum(raw_count) as raw, sum(raw_new_count) as raw_new, sum(normalized_count) as normalized,
           sum(unique_conversation_count) as unique_conversations,
           sum(new_canonical_count) as new_canonical, sum(reused_canonical_count) as reused_canonical,
           count(*) filter (where new_canonical_count is null) as canonical_split_unknown_jobs,
           sum(provider_request_count) as provider_requests,
           count(*) filter (where provider_request_count is null) as provider_requests_unknown_jobs,
           sum(latency_ms) as latency_ms_total
      from rf group by source_key
  ),
  refresh_costs as (
    select source_key, provider_cost_unit as unit, sum(provider_cost_value) as value, count(*) as jobs
      from rf group by source_key, provider_cost_unit
  ),
  refresh_by_partition as (
    select market_partition_id, source_key, count(*) as refresh_jobs, sum(raw_count) as raw, sum(raw_new_count) as raw_new,
           sum(new_canonical_count) as new_canonical, max(refresh_finished_at) as last_refresh_at
      from rf group by market_partition_id, source_key
     order by sum(raw_new_count) desc, market_partition_id limit 200
  ),
  pf as (
    select * from public.product_supply_facts
     where finished_at >= p_since and finished_at < p_until
       and (p_workspace_id is null or workspace_id = p_workspace_id)
       and (p_product_id is null or product_id = p_product_id)
  ),
  product_by_scope as (
    select workspace_id, product_id, source_key,
           count(*) as product_jobs,
           sum(refresh_conversation_count) as routed_conversations, sum(already_matched_count) as already_matched,
           sum(candidate_count) as candidates, sum(overflow_count) as overflow, sum(selected_count) as selected,
           sum(evaluated_count) as evaluated, sum(weak_count) as weak, sum(rejected_count) as rejected,
           sum(qualified_count) as qualified, sum(materialized_count) as materialized,
           count(*) filter (where demand_rebuilt) as demand_rebuilds,
           sum(clusters_created_count) as clusters_created, count(*) filter (where clusters_created_count is null) as clusters_unknown_jobs,
           sum(cluster_memberships_created_count) as cluster_memberships_created,
           sum(reasoning_call_count) as reasoning_calls, count(*) filter (where reasoning_call_count is null) as reasoning_unknown_jobs
      from pf group by workspace_id, product_id, source_key
     order by workspace_id, product_id, source_key limit 500
  ),
  product_costs as (
    select workspace_id, product_id, reasoning_cost_unit as unit, sum(reasoning_cost_value) as value, count(*) as jobs
      from pf group by workspace_id, product_id, reasoning_cost_unit
  ),
  -- Gross qualified evidence: distinct (workspace, product, canonical conversation)
  -- whose FIRST qualified evaluation falls inside the window; fixture sources excluded.
  first_qualified as (
    select e.workspace_id, e.product_id, e.conversation_id, si.source_key
      from public.product_match_evaluations e
      join public.conversations c on c.id = e.conversation_id
      join public.source_items si on si.id = c.primary_source_item_id
     where e.decision = 'qualified'
       and e.created_at >= p_since and e.created_at < p_until
       and (p_workspace_id is null or e.workspace_id = p_workspace_id)
       and (p_product_id is null or e.product_id = p_product_id)
       and si.source_key <> 'fixture'
       and not exists (
         select 1 from public.product_match_evaluations prior
          where prior.workspace_id = e.workspace_id and prior.product_id = e.product_id
            and prior.conversation_id = e.conversation_id and prior.decision = 'qualified'
            and (prior.created_at < e.created_at or (prior.created_at = e.created_at and prior.id < e.id))
       )
  ),
  qualified_by_scope as (
    select workspace_id, product_id, source_key, count(*) as gross_qualified_evidence
      from first_qualified group by workspace_id, product_id, source_key
     order by workspace_id, product_id, source_key limit 500
  )
  select jsonb_build_object(
    'telemetryVersion', 'signal_supply_telemetry_v1',
    'window', jsonb_build_object('since', p_since, 'until', p_until),
    'scope', jsonb_build_object('workspaceId', p_workspace_id, 'productId', p_product_id),
    'refresh', jsonb_build_object(
      'bySource', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object(
          'duplicate_rate', case when s.raw > 0 then round((s.raw - s.raw_new)::numeric / s.raw, 4) end,
          'costs', coalesce((select jsonb_agg(jsonb_build_object('unit', c.unit, 'value', c.value, 'jobs', c.jobs) order by c.unit) from refresh_costs c where c.source_key = s.source_key), '[]'::jsonb)
        ) order by s.source_key) from refresh_by_source s), '[]'::jsonb),
      'byPartition', coalesce((select jsonb_agg(to_jsonb(p)) from refresh_by_partition p), '[]'::jsonb)
    ),
    'products', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
          'selection_rate', case when p.candidates > 0 then round(p.selected::numeric / p.candidates, 4) end,
          'qualification_rate', case when p.evaluated > 0 then round(p.qualified::numeric / p.evaluated, 4) end,
          'reasoning_costs', coalesce((select jsonb_agg(jsonb_build_object('unit', c.unit, 'value', c.value, 'jobs', c.jobs) order by c.unit) from product_costs c where c.workspace_id = p.workspace_id and c.product_id = p.product_id), '[]'::jsonb)
        )) from product_by_scope p), '[]'::jsonb),
    'qualifiedEvidence', jsonb_build_object(
      'definition', 'first_qualified_distinct_workspace_product_conversation_non_fixture',
      'grossBySource', coalesce((select jsonb_agg(to_jsonb(q)) from qualified_by_scope q), '[]'::jsonb),
      'grossTotal', (select count(*) from first_qualified),
      'net', 'deferred'
    ),
    'deferred', jsonb_build_array('net_qualified', 'clusters_strengthened', 'cluster_strengthening_rate', 'surface', 'concept', 'scan_intake_provider_cost')
  ) into v_result;
  return v_result;
end;
$$;

-- ------------------------------------------------ RLS / grants
alter table public.supply_refresh_facts enable row level security;
alter table public.product_supply_facts enable row level security;
revoke all on public.supply_refresh_facts from public, anon, authenticated;
revoke all on public.product_supply_facts from public, anon, authenticated;
grant select on public.product_supply_facts to authenticated;
grant all on public.supply_refresh_facts to service_role;
grant all on public.product_supply_facts to service_role;
drop policy if exists product_supply_facts_member_select on public.product_supply_facts;
create policy product_supply_facts_member_select on public.product_supply_facts for select to authenticated
using (public.is_workspace_member(workspace_id));
-- supply_refresh_facts: RLS on with no policy = no browser access; service role only.

revoke all on function public.signal_supply_funnel(timestamptz, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke all on function public.enforce_product_supply_fact_scope() from public, anon, authenticated;
revoke all on function public.enforce_supply_refresh_fact_scope() from public, anon, authenticated;
revoke all on function public.prevent_supply_fact_update() from public, anon, authenticated;
grant execute on function public.signal_supply_funnel(timestamptz, timestamptz, uuid, uuid) to service_role;
