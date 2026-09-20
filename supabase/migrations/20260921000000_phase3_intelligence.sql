-- Phase 3: product understanding, conversation analysis, matching, ranking, and signals.
-- This migration is forward-only. Historical snapshots/evaluations/rankings are append-only.

alter table public.evidence_nodes drop constraint if exists evidence_nodes_node_type_check;
alter table public.evidence_nodes add constraint evidence_nodes_node_type_check check (node_type in (
  'raw_source_item', 'source_item', 'conversation', 'product', 'product_snapshot',
  'demand_profile', 'conversation_analysis', 'match', 'match_evaluation', 'ranking', 'signal'
));

alter table public.job_runs drop constraint if exists job_runs_job_type_check;
alter table public.job_runs add constraint job_runs_job_type_check check (job_type in (
  'discover-source', 'normalize-source-items', 'dedupe-conversations',
  'analyze-conversations', 'match-product', 'rank-matches'
));
alter table public.evidence_nodes drop constraint if exists evidence_nodes_entity_table_check;
alter table public.evidence_nodes add constraint evidence_nodes_entity_table_check check (entity_table in (
  'raw_source_items', 'source_items', 'conversations', 'products', 'product_snapshots',
  'demand_profiles', 'conversation_analysis', 'product_matches', 'product_match_evaluations',
  'match_rankings', 'signals'
));

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 200),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  website_url text,
  status text not null default 'active' check (status in ('active', 'archived')),
  current_snapshot_id uuid,
  current_demand_profile_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, slug),
  unique (workspace_id, id)
);

create table if not exists public.product_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  snapshot_version integer not null check (snapshot_version > 0),
  source_url text,
  page_type text not null check (page_type in ('manual', 'homepage', 'pricing', 'features', 'use_cases')),
  raw_text text not null check (char_length(raw_text) <= 2_000_000),
  normalized_text text not null check (char_length(normalized_text) <= 2_000_000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  capture_status text not null default 'captured' check (capture_status in ('captured', 'failed', 'pending')),
  capture_engine_version_id uuid references public.engine_versions(id) on delete restrict,
  captured_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, snapshot_version),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade
);

create table if not exists public.demand_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  profile_version integer not null check (profile_version > 0),
  audience jsonb not null default '[]'::jsonb,
  jobs jsonb not null default '[]'::jsonb,
  problems jsonb not null default '[]'::jsonb,
  desired_outcomes jsonb not null default '[]'::jsonb,
  capabilities jsonb not null default '[]'::jsonb,
  alternatives jsonb not null default '[]'::jsonb,
  include_terms jsonb not null default '[]'::jsonb,
  exclude_terms jsonb not null default '[]'::jsonb,
  languages jsonb not null default '[]'::jsonb,
  geographies jsonb not null default '[]'::jsonb,
  confidence numeric not null check (confidence between 0 and 1),
  engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  model text,
  prompt_version text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, profile_version),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade
);

create table if not exists public.demand_profile_snapshot_inputs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  demand_profile_id uuid not null,
  product_snapshot_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (demand_profile_id, product_snapshot_id),
  foreign key (workspace_id, demand_profile_id) references public.demand_profiles(workspace_id, id) on delete cascade,
  foreign key (workspace_id, product_snapshot_id) references public.product_snapshots(workspace_id, id) on delete restrict
);

create table if not exists public.discovery_strategies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  query text,
  schedule text,
  window_start timestamptz,
  window_end timestamptz,
  filters jsonb not null default '{}'::jsonb,
  strategy_version integer not null default 1 check (strategy_version > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, source_key, strategy_version),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade
);

create table if not exists public.conversation_analysis (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  intent_type text not null check (intent_type in ('high_intent', 'problem_signal', 'switching_intent', 'alternative_search', 'informational', 'low_intent', 'unknown')),
  pain_themes jsonb not null default '[]'::jsonb,
  desired_outcomes jsonb not null default '[]'::jsonb,
  alternatives jsonb not null default '[]'::jsonb,
  buyer_language jsonb not null default '[]'::jsonb,
  audience_signals jsonb not null default '[]'::jsonb,
  specificity numeric not null check (specificity between 0 and 1),
  urgency numeric check (urgency is null or urgency between 0 and 1),
  confidence numeric not null check (confidence between 0 and 1),
  status text not null default 'completed' check (status in ('completed', 'skipped', 'failed')),
  skip_reason text,
  evidence_spans jsonb not null default '[]'::jsonb,
  provider text,
  model text,
  prompt_version text,
  usage_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (conversation_id, engine_version_id, input_fingerprint)
);

create table if not exists public.conversation_analysis_evidence (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.conversation_analysis(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  source_item_id uuid not null references public.source_items(id) on delete restrict,
  field text not null check (field in ('title', 'body', 'author', 'metadata')),
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset > start_offset),
  excerpt_hash text not null check (excerpt_hash ~ '^[0-9a-f]{64}$'),
  evidence_type text not null,
  confidence numeric not null check (confidence between 0 and 1),
  created_at timestamptz not null default timezone('utc', now()),
  unique (analysis_id, source_item_id, field, start_offset, end_offset, evidence_type),
  check (end_offset - start_offset <= 20_000)
);

create table if not exists public.product_matches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  lifecycle_status text not null default 'active' check (lifecycle_status in ('active', 'archived', 'rejected')),
  current_match_evaluation_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, conversation_id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade
);

create table if not exists public.product_match_evaluations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_match_id uuid not null,
  product_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  demand_profile_id uuid not null,
  conversation_analysis_id uuid not null references public.conversation_analysis(id) on delete restrict,
  match_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  match_confidence numeric not null check (match_confidence between 0 and 1),
  rationale text not null check (char_length(rationale) <= 5_000),
  evidence jsonb not null default '{}'::jsonb,
  decision text not null check (decision in ('qualified', 'weak', 'rejected')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (product_match_id, match_engine_version_id, input_fingerprint),
  foreign key (workspace_id, product_match_id) references public.product_matches(workspace_id, id) on delete cascade,
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, demand_profile_id) references public.demand_profiles(workspace_id, id) on delete restrict
);

create table if not exists public.match_rankings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_match_evaluation_id uuid not null,
  ranking_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  formula_version text not null,
  semantic_relevance numeric not null check (semantic_relevance between 0 and 1),
  pain_alignment numeric not null check (pain_alignment between 0 and 1),
  buyer_alignment numeric not null check (buyer_alignment between 0 and 1),
  intent_strength numeric not null check (intent_strength between 0 and 1),
  specificity numeric not null check (specificity between 0 and 1),
  freshness numeric not null check (freshness between 0 and 1),
  source_quality numeric not null check (source_quality between 0 and 1),
  opportunity_score numeric not null check (opportunity_score between 0 and 1),
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  calculated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (product_match_evaluation_id, ranking_engine_version_id, input_fingerprint),
  foreign key (workspace_id, product_match_evaluation_id) references public.product_match_evaluations(workspace_id, id) on delete cascade
);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  product_match_id uuid not null,
  product_match_evaluation_id uuid not null,
  match_ranking_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  lifecycle_status text not null default 'active' check (lifecycle_status in ('active', 'saved', 'dismissed', 'archived')),
  intent_type text not null,
  excerpt text not null check (char_length(excerpt) <= 2_000),
  why_it_matters text not null check (char_length(why_it_matters) <= 2_000),
  tags jsonb not null default '[]'::jsonb,
  buyer_language jsonb not null default '[]'::jsonb,
  pain_themes jsonb not null default '[]'::jsonb,
  source_key text not null,
  canonical_url text,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_match_id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, product_match_id) references public.product_matches(workspace_id, id) on delete cascade,
  foreign key (workspace_id, product_match_evaluation_id) references public.product_match_evaluations(workspace_id, id) on delete restrict,
  foreign key (workspace_id, match_ranking_id) references public.match_rankings(workspace_id, id) on delete restrict
);

create table if not exists public.match_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_match_id uuid not null,
  signal_id uuid,
  product_match_evaluation_id uuid,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  feedback_type text not null check (feedback_type in ('opened', 'saved', 'dismissed', 'relevant', 'not_relevant', 'contacted', 'converted')),
  reason text check (reason is null or char_length(reason) <= 1_000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (workspace_id, product_match_id) references public.product_matches(workspace_id, id) on delete cascade,
  foreign key (workspace_id, signal_id) references public.signals(workspace_id, id) on delete restrict,
  foreign key (workspace_id, product_match_evaluation_id) references public.product_match_evaluations(workspace_id, id) on delete restrict
);

alter table public.products
  add constraint products_current_snapshot_fkey
  foreign key (workspace_id, current_snapshot_id) references public.product_snapshots(workspace_id, id) on delete set null;
alter table public.products
  add constraint products_current_demand_profile_fkey
  foreign key (workspace_id, current_demand_profile_id) references public.demand_profiles(workspace_id, id) on delete set null;
alter table public.product_matches
  add constraint product_matches_current_evaluation_fkey
  foreign key (workspace_id, current_match_evaluation_id) references public.product_match_evaluations(workspace_id, id) on delete set null;

create index if not exists product_snapshots_product_created_idx on public.product_snapshots (workspace_id, product_id, created_at desc);
create index if not exists demand_profiles_product_created_idx on public.demand_profiles (workspace_id, product_id, created_at desc);
create index if not exists conversation_analysis_conversation_created_idx on public.conversation_analysis (conversation_id, created_at desc);
create index if not exists product_matches_product_status_idx on public.product_matches (workspace_id, product_id, lifecycle_status);
create index if not exists evaluations_match_created_idx on public.product_match_evaluations (workspace_id, product_match_id, created_at desc);
create index if not exists rankings_score_idx on public.match_rankings (workspace_id, opportunity_score desc);
create index if not exists signals_product_score_idx on public.signals (workspace_id, product_id, lifecycle_status);
create index if not exists feedback_match_created_idx on public.match_feedback (workspace_id, product_match_id, created_at desc);

create trigger products_updated_at before update on public.products for each row execute function public.updated_at_trigger();
create trigger discovery_strategies_updated_at before update on public.discovery_strategies for each row execute function public.updated_at_trigger();
create trigger product_matches_updated_at before update on public.product_matches for each row execute function public.updated_at_trigger();
create trigger signals_updated_at before update on public.signals for each row execute function public.updated_at_trigger();

create or replace function public.prevent_phase3_history_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '55000', message = 'phase3_history_is_immutable';
end;
$$;
create trigger product_snapshots_immutable before update or delete on public.product_snapshots for each row execute function public.prevent_phase3_history_mutation();
create trigger demand_profiles_immutable before update or delete on public.demand_profiles for each row execute function public.prevent_phase3_history_mutation();
create trigger conversation_analysis_immutable before update or delete on public.conversation_analysis for each row execute function public.prevent_phase3_history_mutation();
create trigger match_evaluations_immutable before update or delete on public.product_match_evaluations for each row execute function public.prevent_phase3_history_mutation();
create trigger match_rankings_immutable before update or delete on public.match_rankings for each row execute function public.prevent_phase3_history_mutation();
create trigger match_feedback_append_only before update or delete on public.match_feedback for each row execute function public.prevent_phase3_history_mutation();

-- All intelligence artifacts get evidence nodes and relational links. The trigger keeps
-- workspace ownership aligned with the derived node and prevents cross-tenant edges.
create or replace function public.validate_phase3_evidence_workspace()
returns trigger language plpgsql set search_path = public as $$
declare
  v_derived_workspace uuid;
  v_source_workspace uuid;
begin
  select workspace_id into v_derived_workspace from public.evidence_nodes where id = new.derived_evidence_node_id;
  select workspace_id into v_source_workspace from public.evidence_nodes where id = new.source_evidence_node_id;
  if v_derived_workspace is not null and v_source_workspace is not null and v_derived_workspace <> v_source_workspace then
    raise exception using errcode = '42501', message = 'evidence_workspace_mismatch';
  end if;
  return new;
end;
$$;
drop trigger if exists evidence_provenance_workspace_check on public.evidence_provenance;
create trigger evidence_provenance_workspace_check before insert or update on public.evidence_provenance
for each row execute function public.validate_phase3_evidence_workspace();

alter table public.products enable row level security;
alter table public.product_snapshots enable row level security;
alter table public.demand_profiles enable row level security;
alter table public.demand_profile_snapshot_inputs enable row level security;
alter table public.discovery_strategies enable row level security;
alter table public.conversation_analysis enable row level security;
alter table public.conversation_analysis_evidence enable row level security;
alter table public.product_matches enable row level security;
alter table public.product_match_evaluations enable row level security;
alter table public.match_rankings enable row level security;
alter table public.signals enable row level security;
alter table public.match_feedback enable row level security;

revoke all on public.conversation_analysis from anon, authenticated;
revoke all on public.conversation_analysis_evidence from anon, authenticated;
revoke all on public.evidence_nodes from anon, authenticated;
revoke all on public.evidence_provenance from anon, authenticated;
grant all on public.conversation_analysis to service_role;
grant all on public.conversation_analysis_evidence to service_role;
grant all on public.evidence_nodes to service_role;
grant all on public.evidence_provenance to service_role;

do $$
declare
  t text;
begin
  foreach t in array array['products','product_snapshots','demand_profiles','demand_profile_snapshot_inputs','discovery_strategies','product_matches','product_match_evaluations','match_rankings','signals','match_feedback'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
 grant update on public.products to authenticated;
grant insert on public.demand_profiles to authenticated;
grant insert, update on public.discovery_strategies to authenticated;
grant insert on public.match_feedback to authenticated;

create policy products_member_select on public.products for select to authenticated using (public.is_workspace_member(workspace_id));
create policy products_member_update on public.products for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

create policy product_snapshots_member_select on public.product_snapshots for select to authenticated using (public.is_workspace_member(workspace_id));
create policy product_snapshots_member_insert on public.product_snapshots for insert to authenticated with check (public.is_workspace_member(workspace_id));

create policy demand_profiles_member_select on public.demand_profiles for select to authenticated using (public.is_workspace_member(workspace_id));
create policy demand_profile_inputs_member_select on public.demand_profile_snapshot_inputs for select to authenticated using (public.is_workspace_member(workspace_id));
create policy discovery_strategies_member_select on public.discovery_strategies for select to authenticated using (public.is_workspace_member(workspace_id));
create policy discovery_strategies_member_insert on public.discovery_strategies for insert to authenticated with check (public.is_workspace_member(workspace_id));
create policy discovery_strategies_member_update on public.discovery_strategies for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

create policy product_matches_member_select on public.product_matches for select to authenticated using (public.is_workspace_member(workspace_id));
create policy evaluations_member_select on public.product_match_evaluations for select to authenticated using (public.is_workspace_member(workspace_id));
create policy rankings_member_select on public.match_rankings for select to authenticated using (public.is_workspace_member(workspace_id));
create policy signals_member_select on public.signals for select to authenticated using (public.is_workspace_member(workspace_id));
create policy feedback_member_select on public.match_feedback for select to authenticated using (public.is_workspace_member(workspace_id));
create policy feedback_member_insert on public.match_feedback for insert to authenticated with check (
  public.is_workspace_member(workspace_id) and actor_user_id = auth.uid()
);

-- Product creation is serialized with the entitlement check so products_max cannot be
-- bypassed by concurrent requests. The product evidence anchor is created atomically.
create or replace function public.create_product(
  p_workspace_id uuid,
  p_name text,
  p_slug text,
  p_website_url text default null
)
returns public.products
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_product public.products;
  v_limit bigint;
begin
  if not public.is_service_role() and not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':products', 0));
  select (value_json #>> '{}')::bigint into v_limit
    from public.workspace_entitlements
   where workspace_id = p_workspace_id and capability_key = 'products_max' and effective_to is null;
  if v_limit is null then raise exception using errcode = 'P0001', message = 'products_capability_missing'; end if;
  if (select count(*) from public.products where workspace_id = p_workspace_id and status = 'active') >= v_limit then
    raise exception using errcode = '22003', message = 'products_limit_exceeded';
  end if;
  insert into public.products (workspace_id, name, slug, website_url) values (p_workspace_id, trim(p_name), lower(trim(p_slug)), nullif(trim(p_website_url), '')) returning * into v_product;
  insert into public.evidence_nodes (node_type, workspace_id, entity_table, entity_id, content_hash)
  values ('product', p_workspace_id, 'products', v_product.id, encode(digest(v_product.id::text, 'sha256'), 'hex'));
  return v_product;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'product_slug_already_exists';
end;
$$;
grant execute on function public.create_product(uuid, text, text, text) to authenticated, service_role;

create or replace function public.archive_product(p_workspace_id uuid, p_product_id uuid)
returns public.products
language plpgsql security definer set search_path = public, auth
as $$
declare v_product public.products;
begin
  if not public.is_service_role() and not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  update public.products set status = 'archived' where workspace_id = p_workspace_id and id = p_product_id returning * into v_product;
  if v_product.id is null then raise exception using errcode = 'P0002', message = 'product_not_found'; end if;
  return v_product;
end;
$$;
grant execute on function public.archive_product(uuid, uuid) to authenticated, service_role;

create or replace function public.set_signal_lifecycle(
  p_workspace_id uuid,
  p_signal_id uuid,
  p_lifecycle_status text
)
returns public.signals
language plpgsql security definer set search_path = public, auth
as $$
declare v_signal public.signals;
begin
  if not public.is_service_role() and not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  if p_lifecycle_status not in ('active', 'saved', 'dismissed', 'archived') then
    raise exception using errcode = '22023', message = 'invalid_signal_lifecycle';
  end if;
  update public.signals set lifecycle_status = p_lifecycle_status
   where workspace_id = p_workspace_id and id = p_signal_id returning * into v_signal;
  if v_signal.id is null then raise exception using errcode = 'P0002', message = 'signal_not_found'; end if;
  return v_signal;
end;
$$;
grant execute on function public.set_signal_lifecycle(uuid, uuid, text) to authenticated, service_role;
