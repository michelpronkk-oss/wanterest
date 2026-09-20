-- Phase 4: demand observations, themes, materialized demand, gap, and drift.
-- This migration is forward-only. Every derived demand result is immutable and
-- keyed by the engine/input fingerprint so replay never overwrites history.

alter table public.job_runs drop constraint if exists job_runs_job_type_check;
alter table public.job_runs add constraint job_runs_job_type_check check (job_type in (
  'discover-source', 'normalize-source-items', 'dedupe-conversations',
  'analyze-conversations', 'match-product', 'rank-matches',
  'aggregate-demand', 'calculate-demand-gap', 'calculate-demand-drift',
  'backfill-demand-snapshots'
));

alter table public.evidence_nodes drop constraint if exists evidence_nodes_node_type_check;
alter table public.evidence_nodes add constraint evidence_nodes_node_type_check check (node_type in (
  'raw_source_item', 'source_item', 'conversation', 'product', 'product_snapshot',
  'demand_profile', 'conversation_analysis', 'match', 'match_evaluation', 'ranking',
  'signal', 'demand_observation', 'demand_theme', 'theme_membership',
  'demand_snapshot', 'demand_snapshot_theme', 'demand_snapshot_phrase',
  'demand_snapshot_alternative', 'demand_snapshot_intent', 'demand_gap',
  'demand_drift', 'demand_drift_phrase', 'demand_drift_alternative'
));

alter table public.evidence_nodes drop constraint if exists evidence_nodes_entity_table_check;
alter table public.evidence_nodes add constraint evidence_nodes_entity_table_check check (entity_table in (
  'raw_source_items', 'source_items', 'conversations', 'products', 'product_snapshots',
  'demand_profiles', 'conversation_analysis', 'product_matches', 'product_match_evaluations',
  'match_rankings', 'signals', 'demand_observations', 'demand_themes', 'theme_memberships',
  'demand_snapshots', 'demand_snapshot_themes', 'demand_snapshot_phrases',
  'demand_snapshot_alternatives', 'demand_snapshot_intents', 'demand_gaps', 'demand_drifts',
  'demand_drift_phrases', 'demand_drift_alternatives'
));

create table if not exists public.demand_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  product_match_id uuid not null,
  match_evaluation_id uuid not null,
  conversation_analysis_id uuid not null references public.conversation_analysis(id) on delete restrict,
  signal_id uuid,
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  observation_type text not null check (observation_type in (
    'pain', 'desired_outcome', 'buyer_language', 'alternative',
    'capability_request', 'switching_reason', 'problem', 'intent'
  )),
  facet_key text not null check (char_length(trim(facet_key)) between 1 and 120),
  facet_value text not null check (char_length(trim(facet_value)) between 1 and 2_000),
  normalized_value text not null check (char_length(trim(normalized_value)) between 1 and 300),
  intent_type text not null,
  weight numeric not null default 1 check (weight between 0 and 1),
  opportunity_score numeric not null default 0 check (opportunity_score between 0 and 1),
  confidence numeric not null check (confidence between 0 and 1),
  observed_at timestamptz not null,
  published_at timestamptz,
  analysis_engine_version_id uuid references public.engine_versions(id) on delete restrict,
  match_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  observation_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, match_evaluation_id, observation_engine_version_id, observation_type, normalized_value, facet_value),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, product_match_id) references public.product_matches(workspace_id, id) on delete cascade,
  foreign key (workspace_id, match_evaluation_id) references public.product_match_evaluations(workspace_id, id) on delete restrict,
  foreign key (workspace_id, signal_id) references public.signals(workspace_id, id) on delete restrict
);

create index if not exists demand_observations_product_time_idx
  on public.demand_observations (workspace_id, product_id, observed_at desc);
create index if not exists demand_observations_facet_idx
  on public.demand_observations (workspace_id, product_id, observation_type, normalized_value);

create table if not exists public.demand_themes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  demand_profile_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  theme_key text not null check (theme_key ~ '^[a-z][a-z0-9_]{1,119}$'),
  label text not null check (char_length(trim(label)) between 1 and 200),
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'unclassified', 'archived')),
  confidence numeric not null check (confidence between 0 and 1),
  theme_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, demand_profile_id, theme_engine_version_id, theme_key),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, demand_profile_id) references public.demand_profiles(workspace_id, id) on delete restrict
);

create table if not exists public.theme_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  theme_id uuid not null,
  observation_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  membership_weight numeric not null check (membership_weight between 0 and 1),
  confidence numeric not null check (confidence between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  theme_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (theme_id, observation_id, theme_engine_version_id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, theme_id) references public.demand_themes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, observation_id) references public.demand_observations(workspace_id, id) on delete cascade
);

create index if not exists theme_memberships_observation_idx
  on public.theme_memberships (workspace_id, observation_id);
create index if not exists demand_themes_product_idx
  on public.demand_themes (workspace_id, product_id, created_at desc);

create table if not exists public.demand_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  demand_profile_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  window_type text not null check (window_type in ('7d', '30d', '90d')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  sample_size integer not null check (sample_size >= 0),
  qualified_signal_count integer not null check (qualified_signal_count >= 0),
  conversation_count integer not null check (conversation_count >= 0),
  theme_distribution jsonb not null default '{}'::jsonb,
  pain_distribution jsonb not null default '{}'::jsonb,
  desired_outcomes jsonb not null default '{}'::jsonb,
  buyer_language jsonb not null default '{}'::jsonb,
  alternatives jsonb not null default '{}'::jsonb,
  intent_mix jsonb not null default '{}'::jsonb,
  source_mix jsonb not null default '{}'::jsonb,
  confidence numeric not null check (confidence between 0 and 1),
  measurement_quality text not null check (measurement_quality in ('insufficient_data', 'low_confidence', 'normal', 'high_confidence')),
  warnings jsonb not null default '[]'::jsonb,
  map_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, demand_profile_id, window_type, period_start, period_end, map_engine_version_id, input_fingerprint),
  check (period_end > period_start),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, demand_profile_id) references public.demand_profiles(workspace_id, id) on delete restrict
);

create index if not exists demand_snapshots_product_period_idx
  on public.demand_snapshots (workspace_id, product_id, window_type, period_end desc);

create table if not exists public.demand_snapshot_themes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  demand_snapshot_id uuid not null,
  theme_id uuid,
  theme_key text not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  mention_count integer not null check (mention_count >= 0),
  weighted_mentions numeric not null check (weighted_mentions >= 0),
  share_of_demand numeric not null check (share_of_demand between 0 and 1),
  high_intent_count integer not null check (high_intent_count >= 0),
  high_intent_share numeric not null check (high_intent_share between 0 and 1),
  average_opportunity_score numeric not null check (average_opportunity_score between 0 and 1),
  unique_conversations integer not null check (unique_conversations >= 0),
  confidence numeric not null check (confidence between 0 and 1),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (demand_snapshot_id, theme_key),
  foreign key (workspace_id, demand_snapshot_id) references public.demand_snapshots(workspace_id, id) on delete cascade,
  foreign key (workspace_id, theme_id) references public.demand_themes(workspace_id, id) on delete set null
);

create table if not exists public.demand_snapshot_phrases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  demand_snapshot_id uuid not null,
  phrase_type text not null check (phrase_type in ('buyer_language', 'desired_outcome', 'pain')),
  phrase text not null check (char_length(trim(phrase)) between 1 and 2_000),
  normalized_value text not null check (char_length(trim(normalized_value)) between 1 and 300),
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  mention_count integer not null check (mention_count >= 0),
  share_of_demand numeric not null check (share_of_demand between 0 and 1),
  confidence numeric not null check (confidence between 0 and 1),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (demand_snapshot_id, phrase_type, normalized_value, phrase),
  foreign key (workspace_id, demand_snapshot_id) references public.demand_snapshots(workspace_id, id) on delete cascade
);

create table if not exists public.demand_snapshot_alternatives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  demand_snapshot_id uuid not null,
  alternative text not null check (char_length(trim(alternative)) between 1 and 2_000),
  normalized_value text not null check (char_length(trim(normalized_value)) between 1 and 300),
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  mention_count integer not null check (mention_count >= 0),
  share_of_demand numeric not null check (share_of_demand between 0 and 1),
  confidence numeric not null check (confidence between 0 and 1),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (demand_snapshot_id, normalized_value, alternative),
  foreign key (workspace_id, demand_snapshot_id) references public.demand_snapshots(workspace_id, id) on delete cascade
);

create table if not exists public.demand_snapshot_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  demand_snapshot_id uuid not null,
  intent_type text not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  mention_count integer not null check (mention_count >= 0),
  share_of_demand numeric not null check (share_of_demand between 0 and 1),
  confidence numeric not null check (confidence between 0 and 1),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (demand_snapshot_id, intent_type),
  foreign key (workspace_id, demand_snapshot_id) references public.demand_snapshots(workspace_id, id) on delete cascade
);

create table if not exists public.demand_gaps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  demand_snapshot_id uuid not null,
  product_snapshot_id uuid not null,
  demand_profile_id uuid not null,
  theme_id uuid,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  concept_key text not null check (char_length(trim(concept_key)) between 1 and 300),
  market_weight numeric not null check (market_weight between 0 and 1),
  positioning_weight numeric not null check (positioning_weight between 0 and 1),
  gap_score numeric not null check (gap_score between 0 and 1),
  market_mentions integer not null check (market_mentions >= 0),
  market_share numeric not null check (market_share between 0 and 1),
  high_intent_share numeric not null check (high_intent_share between 0 and 1),
  interpretation text not null check (char_length(interpretation) <= 2_000),
  confidence numeric not null check (confidence between 0 and 1),
  measurement_metadata jsonb not null default '{}'::jsonb,
  gap_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, demand_snapshot_id, product_snapshot_id, concept_key, gap_engine_version_id, input_fingerprint),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, demand_snapshot_id) references public.demand_snapshots(workspace_id, id) on delete restrict,
  foreign key (workspace_id, product_snapshot_id) references public.product_snapshots(workspace_id, id) on delete restrict,
  foreign key (workspace_id, demand_profile_id) references public.demand_profiles(workspace_id, id) on delete restrict,
  foreign key (workspace_id, theme_id) references public.demand_themes(workspace_id, id) on delete set null
);

create table if not exists public.demand_drifts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  current_snapshot_id uuid not null,
  previous_snapshot_id uuid not null,
  theme_id uuid,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  concept_key text not null check (char_length(trim(concept_key)) between 1 and 300),
  current_mentions integer not null check (current_mentions >= 0),
  previous_mentions integer not null check (previous_mentions >= 0),
  current_share numeric not null check (current_share between 0 and 1),
  previous_share numeric not null check (previous_share between 0 and 1),
  share_delta numeric not null,
  current_high_intent_share numeric not null check (current_high_intent_share between 0 and 1),
  previous_high_intent_share numeric not null check (previous_high_intent_share between 0 and 1),
  high_intent_delta numeric not null,
  growth_rate numeric,
  drift_direction text not null check (drift_direction in ('rising', 'cooling', 'stable', 'insufficient_data')),
  significance text not null check (significance in ('insufficient', 'weak', 'notable', 'strong')),
  confidence numeric not null check (confidence between 0 and 1),
  measurement_metadata jsonb not null default '{}'::jsonb,
  drift_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, current_snapshot_id, previous_snapshot_id, concept_key, drift_engine_version_id, input_fingerprint),
  check (current_snapshot_id <> previous_snapshot_id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, current_snapshot_id) references public.demand_snapshots(workspace_id, id) on delete restrict,
  foreign key (workspace_id, previous_snapshot_id) references public.demand_snapshots(workspace_id, id) on delete restrict,
  foreign key (workspace_id, theme_id) references public.demand_themes(workspace_id, id) on delete set null
);

create table if not exists public.demand_drift_phrases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  current_snapshot_id uuid not null,
  previous_snapshot_id uuid not null,
  phrase text not null,
  normalized_value text not null,
  current_mentions integer not null check (current_mentions >= 0),
  previous_mentions integer not null check (previous_mentions >= 0),
  growth_rate numeric,
  drift_direction text not null check (drift_direction in ('rising', 'cooling', 'stable', 'insufficient_data')),
  confidence numeric not null check (confidence between 0 and 1),
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  drift_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, current_snapshot_id, previous_snapshot_id, normalized_value, phrase, drift_engine_version_id),
  foreign key (workspace_id, current_snapshot_id) references public.demand_snapshots(workspace_id, id) on delete cascade,
  foreign key (workspace_id, previous_snapshot_id) references public.demand_snapshots(workspace_id, id) on delete cascade
);

create table if not exists public.demand_drift_alternatives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  current_snapshot_id uuid not null,
  previous_snapshot_id uuid not null,
  alternative text not null,
  normalized_value text not null,
  current_mentions integer not null check (current_mentions >= 0),
  previous_mentions integer not null check (previous_mentions >= 0),
  growth_rate numeric,
  drift_direction text not null check (drift_direction in ('rising', 'cooling', 'stable', 'insufficient_data')),
  confidence numeric not null check (confidence between 0 and 1),
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  drift_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, current_snapshot_id, previous_snapshot_id, normalized_value, alternative, drift_engine_version_id),
  foreign key (workspace_id, current_snapshot_id) references public.demand_snapshots(workspace_id, id) on delete cascade,
  foreign key (workspace_id, previous_snapshot_id) references public.demand_snapshots(workspace_id, id) on delete cascade
);

create index if not exists demand_gaps_product_score_idx on public.demand_gaps (workspace_id, product_id, gap_score desc);
create index if not exists demand_drifts_product_period_idx on public.demand_drifts (workspace_id, product_id, current_snapshot_id);

create or replace function public.prevent_phase4_history_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '55000', message = 'phase4_history_is_immutable';
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'demand_observations', 'demand_themes', 'theme_memberships', 'demand_snapshots',
    'demand_snapshot_themes', 'demand_snapshot_phrases', 'demand_snapshot_alternatives',
    'demand_snapshot_intents', 'demand_gaps', 'demand_drifts', 'demand_drift_phrases',
    'demand_drift_alternatives'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immutable', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.prevent_phase4_history_mutation()', t || '_immutable', t);
  end loop;
end $$;

alter table public.demand_observations enable row level security;
alter table public.demand_themes enable row level security;
alter table public.theme_memberships enable row level security;
alter table public.demand_snapshots enable row level security;
alter table public.demand_snapshot_themes enable row level security;
alter table public.demand_snapshot_phrases enable row level security;
alter table public.demand_snapshot_alternatives enable row level security;
alter table public.demand_snapshot_intents enable row level security;
alter table public.demand_gaps enable row level security;
alter table public.demand_drifts enable row level security;
alter table public.demand_drift_phrases enable row level security;
alter table public.demand_drift_alternatives enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'demand_observations', 'demand_themes', 'theme_memberships', 'demand_snapshots',
    'demand_snapshot_themes', 'demand_snapshot_phrases', 'demand_snapshot_alternatives',
    'demand_snapshot_intents', 'demand_gaps', 'demand_drifts', 'demand_drift_phrases',
    'demand_drift_alternatives'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', t || '_member_select', t);
  end loop;
end $$;
