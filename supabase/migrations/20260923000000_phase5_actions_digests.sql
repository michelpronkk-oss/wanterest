-- Phase 5: evidence-backed actions, immutable variants, feedback, and digests.
-- Forward-only. Phase 1-4 migrations are intentionally not modified.

alter table public.job_runs drop constraint if exists job_runs_job_type_check;
alter table public.job_runs add constraint job_runs_job_type_check check (job_type in (
  'discover-source', 'normalize-source-items', 'dedupe-conversations',
  'analyze-conversations', 'match-product', 'rank-matches',
  'aggregate-demand', 'calculate-demand-gap', 'calculate-demand-drift',
  'backfill-demand-snapshots', 'generate-actions', 'build-digest'
));

alter table public.engine_versions drop constraint if exists engine_versions_engine_type_check;
alter table public.engine_versions add constraint engine_versions_engine_type_check check (engine_type in (
  'profile', 'classifier', 'matcher', 'ranker', 'map', 'gap', 'drift',
  'action', 'action_variant', 'digest_composer'
));

alter table public.evidence_nodes drop constraint if exists evidence_nodes_node_type_check;
alter table public.evidence_nodes add constraint evidence_nodes_node_type_check check (node_type in (
  'raw_source_item', 'source_item', 'conversation', 'product', 'product_snapshot',
  'demand_profile', 'conversation_analysis', 'match', 'match_evaluation', 'ranking',
  'signal', 'demand_observation', 'demand_theme', 'theme_membership',
  'demand_snapshot', 'demand_snapshot_theme', 'demand_snapshot_phrase',
  'demand_snapshot_alternative', 'demand_snapshot_intent', 'demand_gap',
  'demand_drift', 'demand_drift_phrase', 'demand_drift_alternative',
  'action', 'action_variant', 'digest', 'digest_item'
));

alter table public.evidence_nodes drop constraint if exists evidence_nodes_entity_table_check;
alter table public.evidence_nodes add constraint evidence_nodes_entity_table_check check (entity_table in (
  'raw_source_items', 'source_items', 'conversations', 'products', 'product_snapshots',
  'demand_profiles', 'conversation_analysis', 'product_matches',
  'product_match_evaluations', 'match_rankings', 'signals', 'demand_observations',
  'demand_themes', 'theme_memberships', 'demand_snapshots', 'demand_snapshot_themes',
  'demand_snapshot_phrases', 'demand_snapshot_alternatives', 'demand_snapshot_intents',
  'demand_gaps', 'demand_drifts', 'demand_drift_phrases', 'demand_drift_alternatives',
  'actions', 'action_variants', 'digests', 'digest_items'
));

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  action_type text not null check (action_type in (
    'messaging_change', 'landing_page', 'positioning_change', 'offer_hypothesis',
    'onboarding_change', 'comparison_page', 'content_angle', 'campaign_angle',
    'product_research'
  )),
  trigger_type text not null check (trigger_type in ('demand_gap', 'demand_drift', 'demand_snapshot', 'signal')),
  trigger_id uuid not null,
  trigger_evidence_node_id uuid not null references public.evidence_nodes(id) on delete restrict,
  trigger_concept_key text not null check (char_length(trim(trigger_concept_key)) between 1 and 300),
  target_key text not null check (char_length(trim(target_key)) between 1 and 200),
  title text not null check (char_length(trim(title)) between 1 and 300),
  summary text not null check (char_length(trim(summary)) between 1 and 2_000),
  why text not null check (char_length(trim(why)) between 1 and 2_000),
  suggested_change text not null check (char_length(trim(suggested_change)) between 1 and 5_000),
  current_state text,
  target_metric text,
  business_hypothesis jsonb not null default '{}'::jsonb,
  evidence_context jsonb not null default '{}'::jsonb,
  priority_score numeric not null check (priority_score between 0 and 1),
  confidence numeric not null check (confidence between 0 and 1),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'in_progress', 'completed', 'dismissed', 'superseded')),
  action_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  priority_formula_version text not null,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 1 and 300),
  approved_at timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  valid_from timestamptz not null default timezone('utc', now()),
  stale_at timestamptz,
  superseded_by_action_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, idempotency_key),
  unique (workspace_id, product_id, action_type, target_key, trigger_concept_key, action_engine_version_id, input_fingerprint),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, superseded_by_action_id) references public.actions(workspace_id, id) on delete set null
);

create index if not exists actions_product_status_priority_idx
  on public.actions (workspace_id, product_id, status, priority_score desc, created_at desc);
create index if not exists actions_trigger_idx
  on public.actions (workspace_id, trigger_type, trigger_id);

create table if not exists public.action_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  action_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  variant_key text not null check (variant_key ~ '^[a-z][a-z0-9_-]{0,80}$'),
  label text not null check (char_length(trim(label)) between 1 and 200),
  content jsonb not null,
  rationale text not null check (char_length(trim(rationale)) between 1 and 2_000),
  status text not null default 'generated' check (status in ('generated', 'selected', 'rejected', 'archived')),
  variant_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, action_id, variant_engine_version_id, variant_key, input_fingerprint),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, action_id) references public.actions(workspace_id, id) on delete cascade
);

create index if not exists action_variants_action_idx
  on public.action_variants (workspace_id, action_id, created_at);

create table if not exists public.action_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  action_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  feedback_type text not null check (feedback_type in (
    'useful', 'not_useful', 'too_generic', 'not_relevant', 'already_done',
    'saved', 'approved', 'dismissed', 'completed'
  )),
  reason text check (reason is null or char_length(trim(reason)) between 1 and 1_000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, action_id) references public.actions(workspace_id, id) on delete cascade
);

create index if not exists action_feedback_action_idx
  on public.action_feedback (workspace_id, action_id, created_at desc);

create table if not exists public.action_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  action_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null check (actor_kind in ('user', 'system', 'service')),
  event_type text not null check (event_type in ('approved', 'dismissed', 'started', 'completed', 'superseded', 'regenerated')),
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, action_id) references public.actions(workspace_id, id) on delete cascade
);

create index if not exists action_events_action_idx
  on public.action_events (workspace_id, action_id, created_at desc);

create table if not exists public.digests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  period_start timestamptz not null,
  period_end timestamptz not null,
  digest_type text not null check (digest_type in ('daily', 'weekly')),
  render_version text not null check (char_length(trim(render_version)) between 1 and 120),
  status text not null default 'materialized' check (status in ('materialized', 'sent', 'superseded')),
  summary text not null check (char_length(trim(summary)) <= 5_000),
  structured_content jsonb not null default '{}'::jsonb,
  engine_version_id uuid references public.engine_versions(id) on delete restrict,
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 1 and 300),
  created_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, idempotency_key),
  check (period_end > period_start),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade
);

create index if not exists digests_workspace_period_idx
  on public.digests (workspace_id, product_id, period_end desc, digest_type);

create table if not exists public.digest_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  digest_id uuid not null,
  item_type text not null check (item_type in ('signal', 'theme', 'gap', 'drift', 'action')),
  item_id uuid not null,
  source_evidence_node_id uuid not null references public.evidence_nodes(id) on delete restrict,
  position integer not null check (position >= 0),
  reason text not null check (char_length(trim(reason)) between 1 and 2_000),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (digest_id, item_type, item_id),
  foreign key (workspace_id, digest_id) references public.digests(workspace_id, id) on delete cascade
);

create index if not exists digest_items_digest_position_idx
  on public.digest_items (workspace_id, digest_id, position);

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
  end;
  select * into v_node from public.evidence_nodes where id = new.trigger_evidence_node_id;
  if v_node.id is null or v_node.entity_table <> v_entity_table or v_node.entity_id <> new.trigger_id
     or v_node.workspace_id is distinct from new.workspace_id then
    raise exception using errcode = '23514', message = 'action_trigger_evidence_mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists actions_validate_trigger on public.actions;
create trigger actions_validate_trigger
before insert or update of trigger_type, trigger_id, trigger_evidence_node_id, workspace_id
on public.actions for each row execute function public.validate_action_trigger();

create or replace function public.validate_action_variant_parent()
returns trigger language plpgsql set search_path = public as $$
declare
  v_action public.actions;
begin
  select * into v_action from public.actions where workspace_id = new.workspace_id and id = new.action_id;
  if v_action.id is null or v_action.product_id <> new.product_id then
    raise exception using errcode = '23514', message = 'action_variant_parent_mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists action_variants_validate_parent on public.action_variants;
create trigger action_variants_validate_parent
before insert or update of workspace_id, product_id, action_id
on public.action_variants for each row execute function public.validate_action_variant_parent();

create or replace function public.validate_digest_item_evidence()
returns trigger language plpgsql set search_path = public as $$
declare
  v_entity_table text;
  v_node public.evidence_nodes;
begin
  v_entity_table := case new.item_type
    when 'signal' then 'signals'
    when 'theme' then 'demand_snapshot_themes'
    when 'gap' then 'demand_gaps'
    when 'drift' then 'demand_drifts'
    when 'action' then 'actions'
  end;
  select * into v_node from public.evidence_nodes where id = new.source_evidence_node_id;
  if v_node.id is null or v_node.entity_table <> v_entity_table or v_node.entity_id <> new.item_id
     or v_node.workspace_id is distinct from new.workspace_id then
    raise exception using errcode = '23514', message = 'digest_item_evidence_mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists digest_items_validate_evidence on public.digest_items;
create trigger digest_items_validate_evidence
before insert or update of workspace_id, item_type, item_id, source_evidence_node_id
on public.digest_items for each row execute function public.validate_digest_item_evidence();

create or replace function public.prevent_action_generated_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.action_type is distinct from old.action_type
     or new.trigger_type is distinct from old.trigger_type
     or new.trigger_id is distinct from old.trigger_id
     or new.trigger_evidence_node_id is distinct from old.trigger_evidence_node_id
     or new.trigger_concept_key is distinct from old.trigger_concept_key
     or new.target_key is distinct from old.target_key
     or new.title is distinct from old.title
     or new.summary is distinct from old.summary
     or new.why is distinct from old.why
     or new.suggested_change is distinct from old.suggested_change
     or new.current_state is distinct from old.current_state
     or new.target_metric is distinct from old.target_metric
     or new.business_hypothesis is distinct from old.business_hypothesis
     or new.evidence_context is distinct from old.evidence_context
     or new.priority_score is distinct from old.priority_score
     or new.confidence is distinct from old.confidence
     or new.action_engine_version_id is distinct from old.action_engine_version_id
     or new.priority_formula_version is distinct from old.priority_formula_version
     or new.input_fingerprint is distinct from old.input_fingerprint
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception using errcode = '55000', message = 'phase5_action_generated_fields_are_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists actions_generated_immutable on public.actions;
create trigger actions_generated_immutable before update on public.actions
for each row execute function public.prevent_action_generated_mutation();

create or replace function public.prevent_digest_generated_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.product_id is distinct from old.product_id
     or new.evidence_node_id is distinct from old.evidence_node_id
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.digest_type is distinct from old.digest_type
     or new.render_version is distinct from old.render_version
     or new.summary is distinct from old.summary
     or new.structured_content is distinct from old.structured_content
     or new.engine_version_id is distinct from old.engine_version_id
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception using errcode = '55000', message = 'phase5_digest_generated_fields_are_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists digests_generated_immutable on public.digests;
create trigger digests_generated_immutable before update on public.digests
for each row execute function public.prevent_digest_generated_mutation();

create or replace function public.prevent_phase5_generated_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '55000', message = 'phase5_generated_artifact_is_immutable';
end;
$$;

drop trigger if exists action_variants_immutable on public.action_variants;
create trigger action_variants_immutable before update or delete on public.action_variants
for each row execute function public.prevent_phase5_generated_mutation();

drop trigger if exists digest_items_immutable on public.digest_items;
create trigger digest_items_immutable before update or delete on public.digest_items
for each row execute function public.prevent_phase5_generated_mutation();

drop trigger if exists action_feedback_append_only on public.action_feedback;
create trigger action_feedback_append_only before update or delete on public.action_feedback
for each row execute function public.prevent_phase5_generated_mutation();

drop trigger if exists action_events_append_only on public.action_events;
create trigger action_events_append_only before update or delete on public.action_events
for each row execute function public.prevent_phase5_generated_mutation();

drop trigger if exists actions_updated_at on public.actions;
create trigger actions_updated_at before update on public.actions
for each row execute function public.updated_at_trigger();

alter table public.actions enable row level security;
alter table public.action_variants enable row level security;
alter table public.action_feedback enable row level security;
alter table public.action_events enable row level security;
alter table public.digests enable row level security;
alter table public.digest_items enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['actions', 'action_variants', 'action_feedback', 'action_events', 'digests', 'digest_items'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', t || '_member_select', t);
  end loop;
end $$;

comment on table public.actions is 'Evidence-backed recommendations; generated fields are replayable and deduplicated.';
comment on table public.action_variants is 'Immutable structured execution hypotheses, not experiments.';
comment on table public.digests is 'Immutable materialized intelligence for an explicit period; delivery is optional.';
