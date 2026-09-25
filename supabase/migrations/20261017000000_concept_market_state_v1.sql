-- Wanterest 1B Layer 9C: persisted, append-only concept market state, Gap state
-- and Drift state, plus the generic Action-basis mechanism extended to them.
-- Forward-only and additive. Layer 9A's Map and Layer 9B's Gap v2/Drift v2 keep
-- reading live via DemandCurrentnessService and do not read these tables
-- (Option A). See docs/architecture.md Section 18.

-- Additive key so a Gap state can prove, in PostgreSQL, that its positioning
-- snapshot belongs to the same product as the concept it is a basis for.
-- Mirrors the product_match_evaluations key Stage 2G already added.
alter table public.product_snapshots
  add constraint product_snapshots_workspace_product_id_key unique (workspace_id, product_id, id);

alter table public.evidence_nodes drop constraint if exists evidence_nodes_node_type_check;
alter table public.evidence_nodes add constraint evidence_nodes_node_type_check check (node_type in (
  'raw_source_item', 'source_item', 'conversation', 'product', 'product_snapshot',
  'demand_profile', 'conversation_analysis', 'match', 'match_evaluation', 'ranking',
  'signal', 'demand_observation', 'demand_theme', 'theme_membership',
  'demand_snapshot', 'demand_snapshot_theme', 'demand_snapshot_phrase',
  'demand_snapshot_alternative', 'demand_snapshot_intent', 'demand_gap',
  'demand_drift', 'demand_drift_phrase', 'demand_drift_alternative',
  'action', 'action_variant', 'digest', 'digest_item', 'experiment',
  'experiment_variant', 'experiment_result',
  'demand_cluster', 'demand_cluster_membership', 'demand_cluster_state',
  'concept_market_state', 'concept_gap_state', 'concept_drift_state'
));

alter table public.evidence_nodes drop constraint if exists evidence_nodes_entity_table_check;
alter table public.evidence_nodes add constraint evidence_nodes_entity_table_check check (entity_table in (
  'raw_source_items', 'source_items', 'conversations', 'products', 'product_snapshots',
  'demand_profiles', 'conversation_analysis', 'product_matches',
  'product_match_evaluations', 'match_rankings', 'signals', 'demand_observations',
  'demand_themes', 'theme_memberships', 'demand_snapshots', 'demand_snapshot_themes',
  'demand_snapshot_phrases', 'demand_snapshot_alternatives', 'demand_snapshot_intents',
  'demand_gaps', 'demand_drifts', 'demand_drift_phrases', 'demand_drift_alternatives',
  'actions', 'action_variants', 'digests', 'digest_items', 'experiments',
  'experiment_variants', 'experiment_results',
  'demand_clusters', 'demand_cluster_memberships', 'demand_cluster_states',
  'concept_market_states', 'concept_gap_states', 'concept_drift_states'
));

-- Two new Action trigger types. No new column on actions, no per-type FK: the
-- existing generic evidence-node mechanism (validate_action_trigger below)
-- already carries this for demand_gap/demand_drift/demand_snapshot/signal.
alter table public.actions drop constraint if exists actions_trigger_type_check;
alter table public.actions add constraint actions_trigger_type_check check (trigger_type in (
  'demand_gap', 'demand_drift', 'demand_snapshot', 'signal', 'concept_gap', 'concept_drift'
));

create table if not exists public.concept_market_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  clustering_version text not null check (char_length(trim(clustering_version)) between 1 and 120),
  anchor_concept_key text not null check (anchor_concept_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and char_length(anchor_concept_key) <= 120),
  concept_market_state_policy_version text not null check (char_length(trim(concept_market_state_policy_version)) between 1 and 120),
  market_state_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  previous_state_id uuid,
  sequence integer not null check (sequence >= 1),
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  strength_level text not null check (strength_level in ('inactive', 'single', 'repeated', 'corroborated')),
  distinct_evidence_count integer not null check (distinct_evidence_count >= 0),
  distinct_source_count integer not null check (distinct_source_count >= 0),
  contributing_membership_count integer not null check (contributing_membership_count >= 0),
  excluded_membership_count integer not null check (excluded_membership_count >= 0),
  source_mix jsonb not null default '{}'::jsonb check (jsonb_typeof(source_mix) = 'object'),
  intent_family_mix jsonb not null default '{}'::jsonb check (jsonb_typeof(intent_family_mix) = 'object'),
  target_scope_mix jsonb not null default '{}'::jsonb check (jsonb_typeof(target_scope_mix) = 'object'),
  exclusions jsonb not null default '{}'::jsonb check (jsonb_typeof(exclusions) = 'object'),
  first_evidence_at timestamptz,
  last_evidence_at timestamptz,
  computed_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, id),
  unique (workspace_id, product_id, clustering_version, anchor_concept_key, concept_market_state_policy_version, sequence),
  check (distinct_evidence_count <= contributing_membership_count),
  check ((sequence = 1) = (previous_state_id is null)),
  check (first_evidence_at is null or last_evidence_at is null or first_evidence_at <= last_evidence_at),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, previous_state_id) references public.concept_market_states(workspace_id, id) on delete restrict
);

create index if not exists concept_market_states_latest_idx
  on public.concept_market_states (workspace_id, product_id, clustering_version, anchor_concept_key, concept_market_state_policy_version, sequence desc);

create table if not exists public.concept_gap_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  clustering_version text not null check (char_length(trim(clustering_version)) between 1 and 120),
  anchor_concept_key text not null check (anchor_concept_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and char_length(anchor_concept_key) <= 120),
  gap_state_policy_version text not null check (char_length(trim(gap_state_policy_version)) between 1 and 120),
  gap_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  market_state_id uuid not null,
  product_snapshot_id uuid not null,
  previous_state_id uuid,
  sequence integer not null check (sequence >= 1),
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('no_current_demand', 'directional', 'scored')),
  share_of_current_demand numeric not null check (share_of_current_demand between 0 and 1),
  positioning_weight numeric not null check (positioning_weight between 0 and 1),
  high_intent_share numeric not null check (high_intent_share between 0 and 1),
  sample_quality text not null check (sample_quality in ('insufficient_data', 'low_confidence', 'normal', 'high_confidence')),
  gap_score numeric check (gap_score is null or gap_score between 0 and 1),
  computed_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, clustering_version, anchor_concept_key, gap_state_policy_version, sequence),
  check ((sequence = 1) = (previous_state_id is null)),
  check ((status = 'scored') = (gap_score is not null)),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, product_id, market_state_id) references public.concept_market_states(workspace_id, product_id, id) on delete restrict,
  foreign key (workspace_id, product_id, product_snapshot_id) references public.product_snapshots(workspace_id, product_id, id) on delete restrict,
  foreign key (workspace_id, previous_state_id) references public.concept_gap_states(workspace_id, id) on delete restrict
);

create index if not exists concept_gap_states_latest_idx
  on public.concept_gap_states (workspace_id, product_id, clustering_version, anchor_concept_key, gap_state_policy_version, sequence desc);

create table if not exists public.concept_drift_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  clustering_version text not null check (char_length(trim(clustering_version)) between 1 and 120),
  anchor_concept_key text not null check (anchor_concept_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and char_length(anchor_concept_key) <= 120),
  drift_state_policy_version text not null check (char_length(trim(drift_state_policy_version)) between 1 and 120),
  comparability_version text not null check (char_length(trim(comparability_version)) between 1 and 120),
  drift_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  window_type text not null check (window_type in ('7d', '30d', '90d')),
  -- Lineage only (which materialization run produced this row); never the
  -- semantic input to the frozen counts below. See docs/architecture.md Section 18.
  market_state_id uuid not null,
  previous_state_id uuid,
  sequence integer not null check (sequence >= 1),
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  comparable boolean not null,
  comparability_reason text check (comparability_reason is null or comparability_reason in ('insufficient_history', 'unknown_window')),
  monitoring_started_at_basis timestamptz,
  previous_period_start timestamptz,
  previous_period_end timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  current_frozen_evidence_count integer check (current_frozen_evidence_count is null or current_frozen_evidence_count >= 0),
  previous_frozen_evidence_count integer check (previous_frozen_evidence_count is null or previous_frozen_evidence_count >= 0),
  current_frozen_source_count integer check (current_frozen_source_count is null or current_frozen_source_count >= 0),
  previous_frozen_source_count integer check (previous_frozen_source_count is null or previous_frozen_source_count >= 0),
  direction text check (direction is null or direction in ('rising', 'cooling', 'stable', 'insufficient_data')),
  significance text check (significance is null or significance in ('insufficient', 'weak', 'notable', 'strong')),
  share_delta numeric,
  growth_rate numeric,
  computed_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, clustering_version, anchor_concept_key, drift_state_policy_version, window_type, sequence),
  check ((sequence = 1) = (previous_state_id is null)),
  check ((comparable and comparability_reason is null) or (not comparable and comparability_reason is not null)),
  check (not comparable or (previous_period_start is not null and previous_period_end is not null and current_period_start is not null and current_period_end is not null and direction is not null and significance is not null)),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, product_id, market_state_id) references public.concept_market_states(workspace_id, product_id, id) on delete restrict,
  foreign key (workspace_id, previous_state_id) references public.concept_drift_states(workspace_id, id) on delete restrict
);

create index if not exists concept_drift_states_latest_idx
  on public.concept_drift_states (workspace_id, product_id, clustering_version, anchor_concept_key, drift_state_policy_version, window_type, sequence desc);

create or replace function public.prevent_concept_state_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '55000', message = 'concept_market_state_history_is_immutable';
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['concept_market_states', 'concept_gap_states', 'concept_drift_states'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immutable', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.prevent_concept_state_mutation()', t || '_immutable', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', t || '_member_select', t);
  end loop;
end $$;

create or replace function public.validate_action_trigger()
returns trigger language plpgsql set search_path = public as $$
declare
  v_entity_table text;
  v_node public.evidence_nodes;
begin
  v_entity_table := case new.trigger_type
    when 'demand_gap' then 'demand_gaps'
    when 'demand_drift' then 'demand_drifts'
    when 'demand_snapshot' then 'demand_snapshots'
    when 'signal' then 'signals'
    when 'concept_gap' then 'concept_gap_states'
    when 'concept_drift' then 'concept_drift_states'
  end;
  select * into v_node from public.evidence_nodes where id = new.trigger_evidence_node_id;
  if v_node.id is null or v_node.entity_table <> v_entity_table or v_node.entity_id <> new.trigger_id
     or v_node.workspace_id is distinct from new.workspace_id then
    raise exception using errcode = '23514', message = 'action_trigger_evidence_mismatch';
  end if;
  return new;
end;
$$;
