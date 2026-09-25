-- Wanterest 1B Stage 2G: demand clustering and strengthening (demand_clustering_v1).
-- Forward-only and additive. Product-private derived intelligence: every table is
-- workspace-owned, RLS-protected, service-role written, and immutable history.
-- Public conversations stay global and are referenced, never copied.

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
  'demand_cluster', 'demand_cluster_membership', 'demand_cluster_state'
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
  'demand_clusters', 'demand_cluster_memberships', 'demand_cluster_states'
));

-- Additive key so memberships can prove, in PostgreSQL, that an evaluation belongs
-- to the same product as its cluster (id is already the primary key).
alter table public.product_match_evaluations
  add constraint product_match_evaluations_workspace_product_id_key unique (workspace_id, product_id, id);

create table if not exists public.demand_clusters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  clustering_version text not null check (char_length(trim(clustering_version)) between 1 and 120),
  clustering_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  cluster_key text not null check (char_length(cluster_key) between 1 and 300),
  anchor_concept_key text not null check (anchor_concept_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and char_length(anchor_concept_key) <= 120),
  intent_family text not null check (intent_family in ('switch', 'evaluate', 'capability', 'pain', 'unspecified')),
  target_scope text not null check (target_scope in ('product', 'market', 'implementation')),
  label text not null check (char_length(trim(label)) between 1 and 200),
  identity jsonb not null check (jsonb_typeof(identity) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, id),
  unique (workspace_id, product_id, clustering_version, cluster_key),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade
);

create index if not exists demand_clusters_product_idx
  on public.demand_clusters (workspace_id, product_id, clustering_version);

create table if not exists public.demand_cluster_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  cluster_id uuid not null,
  match_evaluation_id uuid not null,
  product_match_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  clustering_version text not null check (char_length(trim(clustering_version)) between 1 and 120),
  clustering_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  evidence_at timestamptz not null,
  confidence numeric not null check (confidence between 0 and 1),
  assignment jsonb not null check (jsonb_typeof(assignment) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, clustering_version, match_evaluation_id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, product_id, cluster_id) references public.demand_clusters(workspace_id, product_id, id) on delete cascade,
  foreign key (workspace_id, product_id, match_evaluation_id) references public.product_match_evaluations(workspace_id, product_id, id) on delete restrict,
  foreign key (workspace_id, product_match_id) references public.product_matches(workspace_id, id) on delete cascade
);

create index if not exists demand_cluster_memberships_cluster_idx
  on public.demand_cluster_memberships (workspace_id, cluster_id);
create index if not exists demand_cluster_memberships_product_idx
  on public.demand_cluster_memberships (workspace_id, product_id, clustering_version);

create table if not exists public.demand_cluster_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  cluster_id uuid not null,
  previous_state_id uuid,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  strength_version text not null check (char_length(trim(strength_version)) between 1 and 120),
  clustering_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  sequence integer not null check (sequence >= 1),
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  strength_level text not null check (strength_level in ('inactive', 'single', 'repeated', 'corroborated')),
  strength_score numeric not null check (strength_score between 0 and 1),
  distinct_evidence_count integer not null check (distinct_evidence_count >= 0),
  distinct_source_count integer not null check (distinct_source_count >= 0),
  contributing_membership_count integer not null check (contributing_membership_count >= 0),
  excluded_membership_count integer not null check (excluded_membership_count >= 0),
  average_demand_quality numeric not null check (average_demand_quality between 0 and 1),
  average_confidence numeric not null check (average_confidence between 0 and 1),
  components jsonb not null check (jsonb_typeof(components) = 'object'),
  source_mix jsonb not null default '{}'::jsonb check (jsonb_typeof(source_mix) = 'object'),
  intent_mix jsonb not null default '{}'::jsonb check (jsonb_typeof(intent_mix) = 'object'),
  alternative_mix jsonb not null default '{}'::jsonb check (jsonb_typeof(alternative_mix) = 'object'),
  lifecycle_mix jsonb not null default '{}'::jsonb check (jsonb_typeof(lifecycle_mix) = 'object'),
  exclusions jsonb not null default '{}'::jsonb check (jsonb_typeof(exclusions) = 'object'),
  first_evidence_at timestamptz,
  last_evidence_at timestamptz,
  stale_before timestamptz not null,
  computed_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, cluster_id, strength_version, sequence),
  check (distinct_evidence_count <= contributing_membership_count),
  check ((sequence = 1) = (previous_state_id is null)),
  check (first_evidence_at is null or last_evidence_at is null or first_evidence_at <= last_evidence_at),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, product_id, cluster_id) references public.demand_clusters(workspace_id, product_id, id) on delete cascade,
  foreign key (workspace_id, previous_state_id) references public.demand_cluster_states(workspace_id, id) on delete restrict
);

create index if not exists demand_cluster_states_latest_idx
  on public.demand_cluster_states (workspace_id, cluster_id, strength_version, sequence desc);
create index if not exists demand_cluster_states_product_idx
  on public.demand_cluster_states (workspace_id, product_id, created_at desc);

create or replace function public.prevent_demand_cluster_history_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '55000', message = 'demand_cluster_history_is_immutable';
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['demand_clusters', 'demand_cluster_memberships', 'demand_cluster_states'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immutable', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.prevent_demand_cluster_history_mutation()', t || '_immutable', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', t || '_member_select', t);
  end loop;
end $$;
