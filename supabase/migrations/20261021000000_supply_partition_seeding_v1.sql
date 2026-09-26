-- Layer 12A.2: planner-seeded shared market partitions (partition expansion v1).
-- Additive. Nothing is written unless SUPPLY_PARTITION_SEEDING_ENABLED=true.
-- market_partition_identity_v1 is unchanged: seeding only inserts (never
-- updates) global market_partitions rows through the same identity, and adds
-- explicit, expiring, workspace/product-scoped interest rows that carry the
-- canonical discovery provenance template incremental matching requires.
-- No backfill: historical interest stays in query_yield_artifacts.
-- See docs/architecture.md Section 25.

-- ------------------------------------------------ retirement (seed explosion stop)
alter table public.market_partition_refresh_state
  add column if not exists retired_at timestamptz,
  add column if not exists retired_reason text;
alter table public.market_partition_refresh_state drop constraint if exists market_partition_refresh_state_retirement_check;
alter table public.market_partition_refresh_state add constraint market_partition_refresh_state_retirement_check check (
  (retired_at is null) = (retired_reason is null)
  and (retired_reason is null or retired_reason in ('seed_zero_yield'))
  and (retired_at is null or (enabled = false and disabled_reason = 'retired'))
);

-- ------------------------------------------------ explicit partition interests
create table if not exists public.market_partition_interests (
  id uuid primary key default gen_random_uuid(),
  interest_version text not null check (interest_version = 'market_partition_interest_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  market_partition_id uuid not null references public.market_partitions(id) on delete restrict,
  partition_key text not null check (char_length(trim(partition_key)) between 1 and 300),
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  origin text not null check (origin in ('scan', 'planner_seed')),
  -- The scan job whose plan produced (seed) or executed (scan) this query.
  origin_job_run_id uuid not null references public.job_runs(id) on delete restrict,
  query_plan_id text not null check (char_length(trim(query_plan_id)) between 1 and 180),
  -- Canonical DiscoveryProvenanceTemplate (discoveryProvenanceTemplate()), required and self-consistent.
  provenance jsonb not null,
  seed_version text check (seed_version is null or char_length(seed_version) between 1 and 60),
  -- Descriptive only (planner family/surface/concepts/language); never part of partition identity.
  seed_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(seed_metadata) = 'object'),
  renewal_count integer not null default 0 check (renewal_count >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  renewed_at timestamptz not null,
  expires_at timestamptz not null,
  deactivated_at timestamptz,
  deactivated_reason text check (deactivated_reason is null or deactivated_reason in ('product_inactive')),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  -- One interest identity per product per partition; renewal updates it in place.
  unique (workspace_id, product_id, market_partition_id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  check (jsonb_typeof(provenance) = 'object'),
  check (provenance->>'queryPlanId' = query_plan_id),
  check (provenance->>'source' = source_key),
  check (char_length(coalesce(provenance->>'queryFamily', '')) between 1 and 50),
  check (char_length(coalesce(provenance->>'demandSurface', '')) between 1 and 50),
  check (jsonb_typeof(provenance->'concepts') = 'array'),
  check (jsonb_typeof(provenance->'competitorSpecific') = 'boolean'),
  check ((origin = 'planner_seed') = (seed_version is not null)),
  check (renewed_at >= created_at - interval '1 minute'),
  check (expires_at > renewed_at),
  check (expires_at <= renewed_at + interval '31 days'),
  check ((deactivated_at is null) = (deactivated_reason is null))
);
create index if not exists market_partition_interests_partition_active_idx
  on public.market_partition_interests (partition_key, expires_at) where deactivated_at is null;
create index if not exists market_partition_interests_seed_source_idx
  on public.market_partition_interests (source_key, expires_at) where origin = 'planner_seed' and deactivated_at is null;
create index if not exists market_partition_interests_product_idx
  on public.market_partition_interests (workspace_id, product_id, source_key);
create index if not exists market_partition_interests_origin_job_idx
  on public.market_partition_interests (origin_job_run_id);

drop trigger if exists market_partition_interests_updated_at on public.market_partition_interests;
create trigger market_partition_interests_updated_at
  before update on public.market_partition_interests
  for each row execute function public.updated_at_trigger();

-- Scope integrity: the interest must name the partition's real key/source, the
-- origin job must belong to exactly this workspace/product, and an interest can
-- only be created or renewed for an active product.
create or replace function public.enforce_market_partition_interest_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.product_id <> old.product_id
      or new.market_partition_id <> old.market_partition_id or new.partition_key <> old.partition_key
      or new.source_key <> old.source_key or new.created_at <> old.created_at) then
    raise exception using errcode = '55000', message = 'market_partition_interest_identity_immutable';
  end if;
  if not exists (
    select 1 from public.market_partitions mp
     where mp.id = new.market_partition_id and mp.partition_key = new.partition_key and mp.source_key = new.source_key
  ) then
    raise exception using errcode = '23514', message = 'market_partition_interest_partition_mismatch';
  end if;
  if tg_op = 'INSERT' or new.origin_job_run_id <> old.origin_job_run_id then
    if not exists (
      select 1 from public.job_runs j
       where j.id = new.origin_job_run_id and j.workspace_id = new.workspace_id and j.product_id = new.product_id
    ) then
      raise exception using errcode = '23514', message = 'market_partition_interest_job_scope_mismatch';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.renewed_at <> old.renewed_at) and new.deactivated_at is null and not exists (
    select 1 from public.products p where p.workspace_id = new.workspace_id and p.id = new.product_id and p.status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'market_partition_interest_product_inactive';
  end if;
  return new;
end;
$$;
drop trigger if exists market_partition_interests_scope on public.market_partition_interests;
create trigger market_partition_interests_scope before insert or update on public.market_partition_interests
for each row execute function public.enforce_market_partition_interest_scope();

alter table public.market_partition_interests enable row level security;
revoke all on public.market_partition_interests from public, anon, authenticated;
grant select on public.market_partition_interests to authenticated;
grant select, insert, update, delete on public.market_partition_interests to service_role;
drop policy if exists market_partition_interests_member_select on public.market_partition_interests;
create policy market_partition_interests_member_select on public.market_partition_interests for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- ------------------------------------------------ atomic seed / renew
-- One transaction per interest: ensures the immutable global partition row
-- (insert-or-ignore, never update), enforces the global per-source seeded
-- partition cap and the per-product per-source seed cap under a per-source
-- advisory lock (so concurrent scans cannot overshoot), refuses retired
-- partitions and inactive products, then creates or renews the one interest
-- row for (workspace, product, partition). A scan-origin interest outranks a
-- seed: a seed renewal never downgrades or overwrites a scan's provenance.
create or replace function public.upsert_market_partition_interest(
  p_workspace_id uuid,
  p_product_id uuid,
  p_origin text,
  p_origin_job_run_id uuid,
  p_partition_id uuid,
  p_partition_key text,
  p_identity_version text,
  p_source_key text,
  p_retrieval_spec jsonb,
  p_query_plan_id text,
  p_provenance jsonb,
  p_seed_version text,
  p_seed_metadata jsonb,
  p_now timestamptz,
  p_ttl_seconds integer,
  p_max_seeded_partitions_per_source integer,
  p_max_seeds_per_product_source integer
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_partition_id uuid;
  v_existing public.market_partition_interests;
  v_state public.market_partition_refresh_state;
  v_expires timestamptz := p_now + make_interval(secs => least(greatest(p_ttl_seconds, 3600), 31 * 86400));
begin
  if p_origin not in ('scan', 'planner_seed') then
    raise exception using errcode = '22023', message = 'market_partition_interest_origin_invalid';
  end if;
  if not exists (select 1 from public.products p where p.workspace_id = p_workspace_id and p.id = p_product_id and p.status = 'active') then
    return 'product_inactive';
  end if;
  perform pg_advisory_xact_lock(hashtext('market-partition-seeding:' || p_source_key));

  select id into v_partition_id from public.market_partitions where partition_key = p_partition_key;
  select * into v_existing from public.market_partition_interests
   where workspace_id = p_workspace_id and product_id = p_product_id and market_partition_id = coalesce(v_partition_id, p_partition_id)
   for update;

  if v_partition_id is not null then
    select * into v_state from public.market_partition_refresh_state where partition_id = v_partition_id;
    if v_state.retired_at is not null and p_origin = 'planner_seed' then
      return 'retired';
    end if;
  end if;

  if p_origin = 'planner_seed' and (v_existing.id is null or v_existing.deactivated_at is not null or v_existing.expires_at <= p_now) then
    if (select count(*) from public.market_partition_interests i
         where i.workspace_id = p_workspace_id and i.product_id = p_product_id and i.source_key = p_source_key
           and i.origin = 'planner_seed' and i.deactivated_at is null and i.expires_at > p_now
           and i.market_partition_id <> coalesce(v_partition_id, p_partition_id)) >= p_max_seeds_per_product_source then
      return 'product_cap_reached';
    end if;
    if not exists (select 1 from public.market_partition_interests i
                    where i.market_partition_id = coalesce(v_partition_id, p_partition_id) and i.origin = 'planner_seed'
                      and i.deactivated_at is null and i.expires_at > p_now)
       and (select count(distinct i.market_partition_id) from public.market_partition_interests i
             where i.source_key = p_source_key and i.origin = 'planner_seed' and i.deactivated_at is null and i.expires_at > p_now) >= p_max_seeded_partitions_per_source then
      return 'source_cap_reached';
    end if;
  end if;

  if v_partition_id is null and p_origin = 'scan' then
    -- Scan interest only ever attaches to a partition the scan's ingestion already created.
    return 'partition_missing';
  end if;
  if v_partition_id is null then
    if p_retrieval_spec is null or jsonb_typeof(p_retrieval_spec) <> 'object' or p_identity_version <> 'market_partition_identity_v1' then
      raise exception using errcode = '22023', message = 'market_partition_seed_spec_invalid';
    end if;
    insert into public.market_partitions (id, partition_key, identity_version, source_key, retrieval_spec)
    values (p_partition_id, p_partition_key, p_identity_version, p_source_key, p_retrieval_spec)
    on conflict (partition_key) do nothing;
    select id into v_partition_id from public.market_partitions where partition_key = p_partition_key;
  end if;

  if v_state.retired_at is not null and p_origin = 'scan' then
    -- A product scan actually executed this spec again: explicit reactivation.
    update public.market_partition_refresh_state
       set enabled = true, disabled_reason = null, retired_at = null, retired_reason = null, consecutive_zero_new = 0
     where partition_id = v_partition_id and retired_at is not null;
  end if;

  if v_existing.id is null then
    insert into public.market_partition_interests (interest_version, workspace_id, product_id, market_partition_id, partition_key, source_key, origin,
      origin_job_run_id, query_plan_id, provenance, seed_version, seed_metadata, created_at, renewed_at, expires_at)
    values ('market_partition_interest_v1', p_workspace_id, p_product_id, v_partition_id, p_partition_key, p_source_key, p_origin,
      p_origin_job_run_id, p_query_plan_id, p_provenance, case when p_origin = 'planner_seed' then p_seed_version end,
      coalesce(p_seed_metadata, '{}'::jsonb), p_now, p_now, v_expires)
    on conflict (workspace_id, product_id, market_partition_id) do nothing;
    if found then return 'created'; end if;
    -- A concurrent writer for the same identity won; renew its row instead.
    select * into v_existing from public.market_partition_interests
     where workspace_id = p_workspace_id and product_id = p_product_id and market_partition_id = v_partition_id for update;
  end if;

  if v_existing.origin = 'scan' and p_origin = 'planner_seed' then
    update public.market_partition_interests
       set renewed_at = greatest(renewed_at, p_now), expires_at = greatest(expires_at, v_expires), renewal_count = renewal_count + 1,
           deactivated_at = null, deactivated_reason = null
     where id = v_existing.id;
  else
    update public.market_partition_interests
       set origin = p_origin, origin_job_run_id = p_origin_job_run_id, query_plan_id = p_query_plan_id, provenance = p_provenance,
           seed_version = case when p_origin = 'planner_seed' then p_seed_version end, seed_metadata = coalesce(p_seed_metadata, '{}'::jsonb),
           renewed_at = greatest(renewed_at, p_now), expires_at = greatest(expires_at, v_expires), renewal_count = renewal_count + 1,
           deactivated_at = null, deactivated_reason = null
     where id = v_existing.id;
  end if;
  return 'renewed';
end;
$$;
revoke all on function public.upsert_market_partition_interest(uuid, uuid, text, uuid, uuid, text, text, text, jsonb, text, jsonb, text, jsonb, timestamptz, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.upsert_market_partition_interest(uuid, uuid, text, uuid, uuid, text, text, text, jsonb, text, jsonb, text, jsonb, timestamptz, integer, integer, integer) to service_role;

-- ------------------------------------------------ canonical interest read path
-- The one read path incremental matching and the refresh scheduler use for
-- explicit interests: unexpired, not deactivated, and only for products that
-- are active right now (an archived product stops receiving routed evidence
-- and stops keeping partitions due immediately, not only after expiry).
create or replace function public.active_market_partition_interests(p_partition_keys text[], p_now timestamptz, p_limit integer default 1000)
returns table (
  id uuid, workspace_id uuid, product_id uuid, market_partition_id uuid, partition_key text, source_key text, origin text,
  origin_job_run_id uuid, query_plan_id text, provenance jsonb, renewed_at timestamptz, expires_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select i.id, i.workspace_id, i.product_id, i.market_partition_id, i.partition_key, i.source_key, i.origin,
         i.origin_job_run_id, i.query_plan_id, i.provenance, i.renewed_at, i.expires_at
    from public.market_partition_interests i
    join public.products p on p.workspace_id = i.workspace_id and p.id = i.product_id and p.status = 'active'
   where i.partition_key = any(p_partition_keys)
     and i.deactivated_at is null
     and i.expires_at > p_now
   order by i.renewed_at desc, i.id
   limit least(greatest(coalesce(p_limit, 1000), 1), 5000)
$$;
revoke all on function public.active_market_partition_interests(text[], timestamptz, integer) from public, anon, authenticated;
grant execute on function public.active_market_partition_interests(text[], timestamptz, integer) to service_role;

-- ------------------------------------------------ inactive-product deactivation
-- Deterministic lifecycle: archiving a product deactivates its interests in
-- the same transaction. Reactivation (and renewal) happens only by a later
-- scan/seed through upsert_market_partition_interest.
create or replace function public.deactivate_market_partition_interests_for_product()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> 'active' and old.status = 'active' then
    update public.market_partition_interests
       set deactivated_at = timezone('utc', now()), deactivated_reason = 'product_inactive'
     where workspace_id = new.workspace_id and product_id = new.id and deactivated_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists products_deactivate_market_partition_interests on public.products;
create trigger products_deactivate_market_partition_interests after update of status on public.products
for each row execute function public.deactivate_market_partition_interests_for_product();

-- ------------------------------------------------ conservative retirement
-- Retires (disables) seed-only partitions that repeatedly produced nothing.
-- Fails closed on missing telemetry: a partition retires only when its last
-- p_min_refreshes refreshes ALL have 12A.1 supply_refresh_facts rows with
-- zero new raw items, every product fact for those refreshes shows zero
-- qualified evidence, no product scan used it recently (no scan-origin
-- interest, no query_yield_artifacts in the window), and its scheduler state
-- agrees (consecutive_zero_new). Without 12A.1 facts nothing ever retires.
create or replace function public.retire_exhausted_seed_partitions(
  p_now timestamptz,
  p_min_refreshes integer,
  p_window_days integer,
  p_limit integer
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer := 0;
  v_row record;
  v_min integer := greatest(coalesce(p_min_refreshes, 6), 3);
  v_since timestamptz := p_now - make_interval(days => least(greatest(coalesce(p_window_days, 30), 7), 90));
begin
  for v_row in
    select s.partition_id, mp.partition_key
      from public.market_partition_refresh_state s
      join public.market_partitions mp on mp.id = s.partition_id
     where s.enabled and s.retired_at is null
       and coalesce(s.consecutive_zero_new, 0) >= v_min
       and (s.lease_expires_at is null or s.lease_expires_at <= p_now)
       and exists (select 1 from public.market_partition_interests i where i.market_partition_id = s.partition_id and i.origin = 'planner_seed')
       and not exists (select 1 from public.market_partition_interests i where i.market_partition_id = s.partition_id and i.origin = 'scan'
                        and i.deactivated_at is null and i.expires_at > p_now)
       and not exists (select 1 from public.query_yield_artifacts q where q.market_partition_key = mp.partition_key and q.created_at >= v_since)
     order by s.partition_id
     limit least(greatest(coalesce(p_limit, 20), 1), 200)
  loop
    if (
      with recent as (
        select f.job_run_id, f.raw_new_count, f.refresh_status
          from public.supply_refresh_facts f
         where f.market_partition_id = v_row.partition_id and f.refresh_finished_at >= v_since
         order by f.refresh_finished_at desc
         limit v_min
      )
      select count(*) = v_min
         and bool_and(r.refresh_status = 'succeeded' and r.raw_new_count = 0)
         and coalesce((select sum(p.qualified_count) from public.product_supply_facts p where p.refresh_job_run_id in (select job_run_id from recent)), 0) = 0
        from recent r
    ) then
      update public.market_partition_refresh_state
         set enabled = false, disabled_reason = 'retired', retired_at = p_now, retired_reason = 'seed_zero_yield'
       where partition_id = v_row.partition_id and enabled and retired_at is null;
      if found then v_count := v_count + 1; end if;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.retire_exhausted_seed_partitions(timestamptz, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.retire_exhausted_seed_partitions(timestamptz, integer, integer, integer) to service_role;
