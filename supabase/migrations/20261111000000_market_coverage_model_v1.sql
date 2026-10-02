-- Market Partitions + Source Coverage Model V1.
-- Separate from public.market_partitions, whose identity is a literal provider
-- retrieval request. This migration adds taxonomy/configuration and links to
-- the single existing canonical public-evidence corpus; it performs no backfill.

create table public.market_coverage_scopes (
  id uuid primary key default gen_random_uuid(),
  vertical_key text not null check (vertical_key ~ '^[a-z][a-z0-9_-]{1,59}$'),
  market_key text not null check (market_key ~ '^[a-z0-9]+(?:-[a-z0-9]+){0,14}$'),
  identity_version text not null default 'market_coverage_scope_v1'
    check (identity_version = 'market_coverage_scope_v1'),
  created_at timestamptz not null default now(),
  unique (vertical_key, market_key)
);

create table public.market_coverage_partitions (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.market_coverage_scopes(id) on delete restrict,
  partition_key text not null unique check (partition_key ~ '^market_coverage_partition_v1:[0-9a-f]{64}$'),
  identity_version text not null default 'market_coverage_partition_v1'
    check (identity_version = 'market_coverage_partition_v1'),
  source_family text not null check (source_family in (
    'social', 'community_forum', 'developer', 'reviews', 'alternative_comparison',
    'video', 'first_party_company', 'launch_directory', 'broad_web', 'news_editorial',
    'commercial_enrichment', 'search_intent', 'marketplace', 'local_directory',
    'maps_reviews', 'owned_survey', 'owned_support', 'owned_crm', 'owned_form'
  )) check (source_family not in ('owned_survey', 'owned_support', 'owned_crm', 'owned_form')),
  geography_code text check (geography_code is null or geography_code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  language_code text check (language_code is null or language_code ~ '^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$'),
  surface_subtype text check (surface_subtype is null or surface_subtype ~ '^[a-z0-9]+(?:-[a-z0-9]+){0,14}$'),
  created_at timestamptz not null default now(),
  unique nulls not distinct (scope_id, source_family, geography_code, language_code, surface_subtype),
  unique (id, scope_id)
);

-- Mutable relevance, availability, freshness policy, and rights are kept out
-- of stable partition identity. Null rights booleans mean unknown, never allow.
create table public.market_coverage_requirements (
  id uuid primary key default gen_random_uuid(),
  coverage_partition_id uuid not null references public.market_coverage_partitions(id) on delete restrict,
  evidence_role text not null check (evidence_role in ('demand', 'supply', 'context')),
  relevance_state text not null default 'relevant' check (relevance_state in ('relevant', 'unknown')),
  availability_state text not null default 'unknown' check (availability_state in ('unknown', 'unavailable', 'inactive', 'active')),
  rights_state text not null default 'unknown' check (rights_state in ('unknown', 'permitted', 'restricted', 'unavailable')),
  rights_profile_key text check (rights_profile_key is null or char_length(trim(rights_profile_key)) between 1 and 120),
  acquisition_allowed boolean,
  durable_analysis_allowed boolean,
  public_projection_allowed boolean,
  raw_retention_class text check (raw_retention_class is null or char_length(trim(raw_retention_class)) between 1 and 80),
  minimum_independent_roots integer not null default 5 check (minimum_independent_roots between 1 and 1000000),
  freshness_days integer not null default 30 check (freshness_days between 1 and 3650),
  concentration_threshold numeric(4,3) not null default 0.750 check (concentration_threshold between 0.500 and 1.000),
  duplicate_threshold numeric(4,3) not null default 0.750 check (duplicate_threshold between 0.500 and 1.000),
  policy_version text not null default 'market_coverage_states_v1'
    check (policy_version = 'market_coverage_states_v1'),
  updated_at timestamptz not null default now(),
  unique (coverage_partition_id, evidence_role),
  unique (id, coverage_partition_id)
);

-- This is metadata-only evidence attribution. It contains no source text,
-- payload, query, cursor, author, workspace or product fields. Role may be
-- unknown; owned_private is intentionally rejected at this global boundary.
create table public.market_coverage_observations (
  id uuid primary key default gen_random_uuid(),
  coverage_partition_id uuid not null references public.market_coverage_partitions(id) on delete restrict,
  conversation_id uuid not null,
  source_item_id uuid not null,
  evidence_role text check (evidence_role is null or evidence_role in ('demand', 'supply', 'context')),
  observed_at timestamptz not null default now(),
  geography_code text check (geography_code is null or geography_code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  geography_confidence numeric(4,3) check (geography_confidence is null or geography_confidence between 0 and 1),
  language_code text check (language_code is null or language_code ~ '^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$'),
  surface_subtype text check (surface_subtype is null or surface_subtype ~ '^[a-z0-9]+(?:-[a-z0-9]+){0,14}$'),
  rights_profile_key text check (rights_profile_key is null or char_length(trim(rights_profile_key)) between 1 and 120),
  retention_class text check (retention_class is null or char_length(trim(retention_class)) between 1 and 80),
  public_projection_eligible boolean,
  foreign key (conversation_id, source_item_id)
    references public.conversation_source_items(conversation_id, source_item_id) on delete restrict
);

create index market_coverage_partitions_scope_idx
  on public.market_coverage_partitions (scope_id, source_family);
create index market_coverage_requirements_state_idx
  on public.market_coverage_requirements (availability_state, rights_state, updated_at desc);
create index market_coverage_observations_partition_observed_idx
  on public.market_coverage_observations (coverage_partition_id, observed_at desc);
create index market_coverage_observations_root_idx
  on public.market_coverage_observations (conversation_id, coverage_partition_id);
create index market_coverage_observations_source_item_idx
  on public.market_coverage_observations (source_item_id);

-- Future many-to-many product interest. No scheduler fanout or billing logic is
-- introduced; the composite FK rejects cross-workspace product references.
create table public.product_market_coverage_interests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  coverage_partition_id uuid not null references public.market_coverage_partitions(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'paused', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, product_id, coverage_partition_id),
  foreign key (workspace_id, product_id)
    references public.products(workspace_id, id) on delete cascade
);

create index product_market_coverage_interests_partition_idx
  on public.product_market_coverage_interests (coverage_partition_id, status);
create index product_market_coverage_interests_product_idx
  on public.product_market_coverage_interests (workspace_id, product_id, status);

create or replace function public.prevent_market_coverage_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'market_coverage_identity_is_append_only';
end;
$$;

create trigger market_coverage_scopes_append_only
  before update or delete on public.market_coverage_scopes
  for each row execute function public.prevent_market_coverage_mutation();
create trigger market_coverage_partitions_append_only
  before update or delete on public.market_coverage_partitions
  for each row execute function public.prevent_market_coverage_mutation();
create trigger market_coverage_observations_append_only
  before update or delete on public.market_coverage_observations
  for each row execute function public.prevent_market_coverage_mutation();
revoke all on function public.prevent_market_coverage_mutation() from public, anon, authenticated, service_role;

alter table public.market_coverage_scopes enable row level security;
alter table public.market_coverage_partitions enable row level security;
alter table public.market_coverage_requirements enable row level security;
alter table public.market_coverage_observations enable row level security;
alter table public.product_market_coverage_interests enable row level security;

revoke all on public.market_coverage_scopes, public.market_coverage_partitions,
  public.market_coverage_requirements, public.market_coverage_observations,
  public.product_market_coverage_interests from public, anon, authenticated;
-- Supabase may have permissive default privileges for service_role on new
-- public tables. Clear those first so the grants below are the exact ACL.
revoke all on public.market_coverage_scopes, public.market_coverage_partitions,
  public.market_coverage_requirements, public.market_coverage_observations,
  public.product_market_coverage_interests from service_role;
grant select, insert on public.market_coverage_scopes, public.market_coverage_partitions to service_role;
grant select, insert, update on public.market_coverage_requirements to service_role;
grant select, insert on public.market_coverage_observations to service_role;
grant select, insert, update, delete on public.product_market_coverage_interests to service_role;

-- Aggregate-only, read-only projection for the separately authorized Admin
-- server. It reports states and interpretable components, never a score.
create or replace function public.market_coverage_summary_v1()
returns table (
  vertical_key text,
  market_key text,
  partition_key text,
  source_family text,
  evidence_role text,
  geography_code text,
  language_code text,
  surface_subtype text,
  relevance_state text,
  availability_state text,
  rights_state text,
  coverage_state text,
  window_start timestamptz,
  window_end timestamptz,
  independent_roots bigint,
  provider_count bigint,
  provider_root_attributions bigint,
  duplicate_root_ratio numeric,
  max_provider_root_share numeric,
  duplicate_observations bigint,
  observed_source_items bigint,
  published_month_buckets bigint,
  roots_without_published_time bigint,
  distinct_geographies bigint,
  roots_without_geography bigint,
  interested_products bigint,
  latest_observed_at timestamptz
)
language sql
security invoker
set search_path = ''
stable
as $$
  with requirement_rollup as (
    select
      s.vertical_key,
      s.market_key,
      p.id as coverage_partition_id,
      p.partition_key,
      p.source_family,
      r.evidence_role,
      p.geography_code,
      p.language_code,
      p.surface_subtype,
      r.relevance_state,
      r.availability_state,
      r.rights_state,
      r.acquisition_allowed,
      r.durable_analysis_allowed,
      r.public_projection_allowed,
      r.minimum_independent_roots,
      r.freshness_days,
      r.concentration_threshold,
      r.duplicate_threshold,
      r.updated_at as requirement_updated_at,
      count(distinct o.conversation_id) filter (where si.id is not null and o.observed_at >= now() - interval '30 days') as independent_roots,
      count(distinct si.source_key) filter (where si.id is not null and o.observed_at >= now() - interval '30 days') as provider_count,
      count(distinct (si.source_key, o.conversation_id)) filter (where si.id is not null and o.observed_at >= now() - interval '30 days') as provider_root_attributions,
      count(distinct (si.source_key, o.source_item_id)) filter (where si.id is not null and o.observed_at >= now() - interval '30 days') as distinct_provider_items,
      count(*) filter (where si.id is not null and o.observed_at >= now() - interval '30 days') as observation_rows,
      count(distinct date_trunc('month', si.published_at)) filter (where si.id is not null and o.observed_at >= now() - interval '30 days' and si.published_at is not null) as published_month_buckets,
      count(distinct o.conversation_id) filter (where si.id is not null and o.observed_at >= now() - interval '30 days' and si.published_at is null) as roots_without_published_time,
      count(distinct o.geography_code) filter (where si.id is not null and o.observed_at >= now() - interval '30 days' and o.geography_code is not null) as distinct_geographies,
      count(distinct o.conversation_id) filter (where si.id is not null and o.observed_at >= now() - interval '30 days' and o.geography_code is null) as roots_without_geography,
      max(o.observed_at) filter (where si.id is not null) as latest_observed_at
    from public.market_coverage_requirements r
    join public.market_coverage_partitions p on p.id = r.coverage_partition_id
    join public.market_coverage_scopes s on s.id = p.scope_id
    left join public.market_coverage_observations o
      on o.coverage_partition_id = p.id
     and o.evidence_role = r.evidence_role
     and (p.geography_code is null or o.geography_code = p.geography_code)
     and (p.language_code is null or lower(o.language_code) = lower(p.language_code))
     and (p.surface_subtype is null or o.surface_subtype = p.surface_subtype)
    left join public.conversation_source_items csi
      on csi.conversation_id = o.conversation_id and csi.source_item_id = o.source_item_id
    left join public.source_items si on si.id = csi.source_item_id and si.status = 'active'
    group by s.vertical_key, s.market_key, p.id, p.partition_key, p.source_family,
      r.evidence_role, p.geography_code, p.language_code, p.surface_subtype,
      r.relevance_state, r.availability_state, r.rights_state, r.acquisition_allowed,
      r.durable_analysis_allowed, r.public_projection_allowed, r.minimum_independent_roots,
      r.freshness_days, r.concentration_threshold, r.duplicate_threshold, r.updated_at
  ), provider_roots as (
    select p.id as coverage_partition_id, r.evidence_role, si.source_key,
      count(distinct o.conversation_id) as roots
    from public.market_coverage_requirements r
    join public.market_coverage_partitions p on p.id = r.coverage_partition_id
    join public.market_coverage_observations o on o.coverage_partition_id = p.id and o.evidence_role = r.evidence_role
      and (p.geography_code is null or o.geography_code = p.geography_code)
      and (p.language_code is null or lower(o.language_code) = lower(p.language_code))
      and (p.surface_subtype is null or o.surface_subtype = p.surface_subtype)
    join public.conversation_source_items csi on csi.conversation_id = o.conversation_id and csi.source_item_id = o.source_item_id
    join public.source_items si on si.id = csi.source_item_id and si.status = 'active'
      where o.observed_at >= now() - interval '30 days'
    group by p.id, r.evidence_role, si.source_key
  ), concentration as (
    select coverage_partition_id, evidence_role,
      max(roots)::numeric / nullif(sum(roots), 0) as max_provider_root_share
    from provider_roots group by coverage_partition_id, evidence_role
  ), authorized as (
    select rr.*,
      (rr.relevance_state = 'relevant' and rr.availability_state = 'active'
        and rr.rights_state = 'permitted' and rr.acquisition_allowed is true
        and rr.durable_analysis_allowed is true) as metrics_allowed
    from requirement_rollup rr
  )
  select
    a.vertical_key,
    a.market_key,
    a.partition_key,
    a.source_family,
    a.evidence_role,
    a.geography_code,
    a.language_code,
    a.surface_subtype,
    a.relevance_state,
    a.availability_state,
    a.rights_state,
    case
      when a.relevance_state = 'unknown' or a.availability_state = 'unknown' or a.rights_state = 'unknown' then 'unknown'
      when a.relevance_state <> 'relevant' or a.availability_state = 'unavailable'
        or a.rights_state in ('restricted', 'unavailable') or a.acquisition_allowed is false
        or a.durable_analysis_allowed is false then 'unavailable'
      when a.acquisition_allowed is null or a.durable_analysis_allowed is null then 'unknown'
      when a.availability_state = 'inactive' then 'inactive'
      when a.latest_observed_at is not null and a.latest_observed_at < now() - make_interval(days => a.freshness_days) then 'stale'
      when a.metrics_allowed and a.independent_roots = 0 then 'undercovered'
      when a.metrics_allowed and a.independent_roots < a.minimum_independent_roots then 'observed'
      when a.metrics_allowed and (coalesce(c.max_provider_root_share, 0) >= a.concentration_threshold
        or (a.provider_root_attributions - a.independent_roots)::numeric / nullif(a.provider_root_attributions, 0) >= a.duplicate_threshold) then 'concentrated'
      when a.metrics_allowed then 'healthy'
      else 'unknown'
    end as coverage_state,
    now() - interval '30 days' as window_start,
    now() as window_end,
    case when a.metrics_allowed then a.independent_roots end,
    case when a.metrics_allowed then a.provider_count end,
    case when a.metrics_allowed then a.provider_root_attributions end,
    case when a.metrics_allowed then (a.provider_root_attributions - a.independent_roots)::numeric / nullif(a.provider_root_attributions, 0) end,
    case when a.metrics_allowed then c.max_provider_root_share end,
    case when a.metrics_allowed then greatest(a.observation_rows - a.distinct_provider_items, 0) end,
    case when a.metrics_allowed then a.distinct_provider_items end,
    case when a.metrics_allowed then a.published_month_buckets end,
    case when a.metrics_allowed then a.roots_without_published_time end,
    case when a.metrics_allowed then a.distinct_geographies end,
    case when a.metrics_allowed then a.roots_without_geography end,
    case when a.metrics_allowed then (
      select count(distinct i.product_id)
      from public.product_market_coverage_interests i
      where i.coverage_partition_id = a.coverage_partition_id and i.status = 'active'
    ) end,
    case when a.metrics_allowed then a.latest_observed_at end
  from authorized a
  left join concentration c on c.coverage_partition_id = a.coverage_partition_id and c.evidence_role = a.evidence_role
  order by a.vertical_key, a.market_key, a.source_family, a.evidence_role, a.geography_code nulls first,
    a.language_code nulls first, a.surface_subtype nulls first;
$$;

revoke all on function public.market_coverage_summary_v1() from public, anon, authenticated, service_role;
grant execute on function public.market_coverage_summary_v1() to service_role;
