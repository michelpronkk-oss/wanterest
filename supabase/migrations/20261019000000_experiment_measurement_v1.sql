-- Layer 11: experiment measurement lifecycle (experiment_measurement_v1).
-- Additive only. Legacy Phase 7 experiment rows keep their semantics; every new
-- rule applies to measurement_policy_version = 'experiment_measurement_v1'.
-- See docs/architecture.md Section 23.

-- ---------------------------------------------------------------- evidence
alter table public.evidence_nodes drop constraint if exists evidence_nodes_node_type_check;
alter table public.evidence_nodes add constraint evidence_nodes_node_type_check check (node_type in (
  'raw_source_item', 'source_item', 'conversation', 'product', 'product_snapshot',
  'demand_profile', 'conversation_analysis', 'match', 'match_evaluation', 'ranking',
  'signal', 'demand_observation', 'demand_theme', 'theme_membership',
  'demand_snapshot', 'demand_snapshot_theme', 'demand_snapshot_phrase',
  'demand_snapshot_alternative', 'demand_snapshot_intent', 'demand_gap',
  'demand_drift', 'demand_drift_phrase', 'demand_drift_alternative',
  'action', 'action_variant', 'digest', 'digest_item', 'experiment',
  'experiment_variant', 'experiment_result', 'demand_cluster', 'demand_cluster_membership',
  'demand_cluster_state', 'concept_market_state', 'concept_gap_state', 'concept_drift_state',
  'experiment_observation'
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
  'experiment_variants', 'experiment_results', 'demand_clusters', 'demand_cluster_memberships',
  'demand_cluster_states', 'concept_market_states', 'concept_gap_states', 'concept_drift_states',
  'experiment_observations'
));

-- ------------------------------------------------------ experiments: frozen plan
alter table public.experiments drop constraint if exists experiments_primary_metric_check;
alter table public.experiments add constraint experiments_primary_metric_check check (primary_metric in (
  'cta_click', 'signup_started', 'signup_completed', 'demo_requested',
  'checkout_started', 'purchase_completed', 'manual_custom'
));

alter table public.experiments add column if not exists measurement_policy_version text;
alter table public.experiments add column if not exists evidence_design text;
alter table public.experiments add column if not exists metric_source text;
alter table public.experiments add column if not exists metric_label text;
alter table public.experiments add column if not exists metric_unit text;
alter table public.experiments add column if not exists measurement_window text;
alter table public.experiments add column if not exists washout_days integer;
alter table public.experiments add column if not exists success_criterion jsonb;
alter table public.experiments add column if not exists hypothesis_structured jsonb;
alter table public.experiments add column if not exists treatment_proposal_fingerprint text;
alter table public.experiments add column if not exists measurement_plan_fingerprint text;
alter table public.experiments add column if not exists idempotency_key text;
alter table public.experiments add column if not exists registered_at timestamptz;
alter table public.experiments add column if not exists baseline_start timestamptz;
alter table public.experiments add column if not exists baseline_end timestamptz;
alter table public.experiments add column if not exists treatment_started_at timestamptz;
alter table public.experiments add column if not exists measurement_start timestamptz;
alter table public.experiments add column if not exists measurement_end timestamptz;
alter table public.experiments add column if not exists closed_reason text;
alter table public.experiments add column if not exists invalidation_reason text;
-- Outcome-relevant input changed after the current result (late treatment
-- confirmation, observation correction); set transactionally, consumed by
-- finalize_experiment_outcome with compare-and-clear.
alter table public.experiments add column if not exists outcome_recompute_requested_at timestamptz;

alter table public.experiments drop constraint if exists experiments_measurement_v1_check;
alter table public.experiments add constraint experiments_measurement_v1_check check (
  measurement_policy_version is null
  or coalesce((
    measurement_policy_version = 'experiment_measurement_v1'
    and evidence_design in ('controlled_split', 'before_after')
    and measurement_window in ('7d', '30d', '90d')
    and washout_days between 0 and 14
    and success_criterion is not null and jsonb_typeof(success_criterion) = 'object'
    and success_criterion->>'direction' in ('increase', 'decrease')
    and success_criterion->>'measure' in ('absolute_delta', 'relative_delta')
    and (success_criterion->>'minimumEffect')::numeric > 0
    and hypothesis_structured is not null and hypothesis_structured->>'hypothesisVersion' = 'experiment_hypothesis_v1'
    and treatment_proposal_fingerprint ~ '^[0-9a-f]{64}$'
    and measurement_plan_fingerprint ~ '^[0-9a-f]{64}$'
    and idempotency_key is not null and char_length(idempotency_key) between 1 and 300
    and (
      (evidence_design = 'controlled_split' and metric_source = 'experiment_events' and primary_metric <> 'manual_custom'
        and (success_criterion->>'minSamplePerArm')::integer >= 1)
      or (evidence_design = 'before_after' and metric_source = 'manual')
    )
    and ((primary_metric = 'manual_custom') = (metric_label is not null and metric_unit is not null))
    and (metric_unit is null or metric_unit in ('count', 'rate', 'currency'))
    and (metric_label is null or char_length(trim(metric_label)) between 1 and 120)
  ), false) -- a missing plan field is a violation, never a NULL pass
);
alter table public.experiments drop constraint if exists experiments_closed_reason_check;
alter table public.experiments add constraint experiments_closed_reason_check check (closed_reason is null or closed_reason in (
  'canceled_before_treatment', 'treatment_started_before_registration', 'measurement_disabled_at_treatment',
  'action_closed_before_treatment', 'treatment_abandoned', 'window_elapsed', 'stopped_early'
));
alter table public.experiments drop constraint if exists experiments_invalidation_reason_check;
alter table public.experiments add constraint experiments_invalidation_reason_check check (invalidation_reason is null or invalidation_reason in ('treatment_abandoned'));
alter table public.experiments drop constraint if exists experiments_measurement_window_bounds_check;
alter table public.experiments add constraint experiments_measurement_window_bounds_check check (
  (treatment_started_at is null and measurement_start is null and measurement_end is null)
  or (treatment_started_at is not null and measurement_start >= treatment_started_at and measurement_end > measurement_start)
);

create unique index if not exists experiments_workspace_idempotency_key
  on public.experiments (workspace_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists experiments_one_non_terminal_per_action
  on public.experiments (workspace_id, action_id) where status in ('draft', 'ready', 'running', 'paused');
create index if not exists experiments_measurement_due_idx
  on public.experiments (measurement_end) where measurement_policy_version = 'experiment_measurement_v1' and status = 'running';
create index if not exists experiments_outcome_recompute_idx
  on public.experiments (outcome_recompute_requested_at) where outcome_recompute_requested_at is not null;

-- ------------------------------------------------- experiment transitions (append-only)
create table if not exists public.experiment_transitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  experiment_id uuid not null,
  from_status text,
  to_status text not null,
  reason text,
  actor_kind text not null check (actor_kind in ('user', 'system')),
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  check (actor_kind = 'system' or actor_user_id is not null),
  unique (workspace_id, id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, experiment_id) references public.experiments(workspace_id, id) on delete cascade
);
create index if not exists experiment_transitions_experiment_idx
  on public.experiment_transitions (workspace_id, experiment_id, occurred_at);

-- ------------------------------------------------- experiment observations (append-only)
create table if not exists public.experiment_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  experiment_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  metric_key text not null check (metric_key in (
    'cta_click', 'signup_started', 'signup_completed', 'demo_requested',
    'checkout_started', 'purchase_completed', 'manual_custom', 'market_evidence_count'
  )),
  window_role text not null check (window_role in ('baseline', 'measurement')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  value numeric not null check (value >= 0),
  denominator numeric check (denominator is null or denominator >= 0),
  source text not null check (source in ('manual', 'wanterest_internal')),
  actor_user_id uuid references auth.users(id) on delete set null,
  note text check (note is null or char_length(trim(note)) between 1 and 1000),
  source_ref jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default timezone('utc', now()),
  supersedes_observation_id uuid,
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 1 and 300),
  check (period_end > period_start),
  check (source <> 'manual' or actor_user_id is not null),
  check ((source = 'wanterest_internal') = (metric_key = 'market_evidence_count')),
  unique (workspace_id, id),
  unique (experiment_id, idempotency_key),
  unique (supersedes_observation_id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, experiment_id) references public.experiments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, supersedes_observation_id) references public.experiment_observations(workspace_id, id) on delete restrict
);
create index if not exists experiment_observations_experiment_idx
  on public.experiment_observations (workspace_id, experiment_id, window_role, recorded_at);

-- ------------------------------------------------------ experiment results (append-only)
alter table public.experiment_results add column if not exists outcome text;
alter table public.experiment_results add column if not exists outcome_version text;
alter table public.experiment_results add column if not exists attribution_class text;
alter table public.experiment_results add column if not exists treatment_integrity text;
alter table public.experiment_results add column if not exists baseline_value numeric;
alter table public.experiment_results add column if not exists observed_value numeric;
alter table public.experiment_results add column if not exists effect numeric;
alter table public.experiment_results add column if not exists effect_basis text;
alter table public.experiment_results add column if not exists evidence_completeness text;
alter table public.experiment_results add column if not exists inconclusive_reasons text[] not null default '{}';
alter table public.experiment_results add column if not exists invalidation_reason text;
alter table public.experiment_results add column if not exists input_fingerprint text;
alter table public.experiment_results add column if not exists arm_results jsonb;
alter table public.experiment_results add column if not exists summary text;
alter table public.experiment_results drop constraint if exists experiment_results_outcome_v1_check;
alter table public.experiment_results add constraint experiment_results_outcome_v1_check check (
  outcome_version is null
  or coalesce((
    outcome_version = 'experiment_outcome_v1'
    and outcome in ('positive', 'negative', 'neutral', 'inconclusive', 'invalid')
    and attribution_class in ('none', 'descriptive', 'before_after_association', 'controlled_comparison')
    and treatment_integrity in ('unconfirmed', 'confirmed', 'verified_exposure')
    and evidence_completeness in ('complete', 'partial', 'missing')
    and (effect_basis is null or effect_basis in ('absolute_delta', 'relative_delta'))
    and input_fingerprint ~ '^[0-9a-f]{64}$'
    and (outcome in ('inconclusive', 'invalid') or (evidence_completeness = 'complete' and effect is not null))
    and (outcome <> 'invalid' or invalidation_reason is not null)
  ), false)
);
create unique index if not exists experiment_results_input_fingerprint_key
  on public.experiment_results (workspace_id, experiment_id, input_fingerprint) where input_fingerprint is not null;

-- ------------------------------------ controlled assignment/event referential integrity
alter table public.experiment_events drop constraint if exists experiment_events_assignment_subject_fkey;
alter table public.experiment_assignments drop constraint if exists experiment_assignments_subject_link_key;
alter table public.experiment_assignments add constraint experiment_assignments_subject_link_key
  unique (workspace_id, experiment_id, id, variant_id, subject_key_hash);
alter table public.experiment_events add constraint experiment_events_assignment_subject_fkey
  foreign key (workspace_id, experiment_id, assignment_id, variant_id, subject_key_hash)
  references public.experiment_assignments(workspace_id, experiment_id, id, variant_id, subject_key_hash) on delete restrict;

-- v1 controlled collection: assignments and events only while running, events inside the frozen window.
create or replace function public.enforce_experiment_v1_collection()
returns trigger language plpgsql set search_path = public as $$
declare
  v_exp public.experiments;
begin
  select * into v_exp from public.experiments where workspace_id = new.workspace_id and id = new.experiment_id;
  if v_exp.measurement_policy_version is distinct from 'experiment_measurement_v1' then
    return new;
  end if;
  if v_exp.status <> 'running' then
    raise exception using errcode = '22023', message = 'experiment_not_collecting';
  end if;
  if tg_table_name = 'experiment_events' then
    if (to_jsonb(new)->>'occurred_at')::timestamptz < v_exp.treatment_started_at or (to_jsonb(new)->>'occurred_at')::timestamptz >= v_exp.measurement_end then
      raise exception using errcode = '22023', message = 'experiment_event_outside_window';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists experiment_assignments_v1_collection on public.experiment_assignments;
create trigger experiment_assignments_v1_collection before insert on public.experiment_assignments
for each row execute function public.enforce_experiment_v1_collection();
drop trigger if exists experiment_events_v1_collection on public.experiment_events;
create trigger experiment_events_v1_collection before insert on public.experiment_events
for each row execute function public.enforce_experiment_v1_collection();

-- --------------------------------------------------------------- triggers
create or replace function public.experiment_window_interval(p_window text)
returns interval language sql immutable set search_path = public as $$
  select make_interval(days => case p_window when '7d' then 7 when '30d' then 30 when '90d' then 90 end);
$$;

-- Frozen pre-registration: nothing in the plan changes once the experiment leaves draft.
create or replace function public.prevent_experiment_plan_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.measurement_policy_version is null and new.measurement_policy_version is null then
    return new;
  end if;
  if new.measurement_policy_version is distinct from old.measurement_policy_version
     or new.workspace_id is distinct from old.workspace_id or new.product_id is distinct from old.product_id
     or new.action_id is distinct from old.action_id or new.idempotency_key is distinct from old.idempotency_key
     or new.created_by is distinct from old.created_by or new.evidence_node_id is distinct from old.evidence_node_id then
    raise exception using errcode = '55000', message = 'experiment_plan_frozen';
  end if;
  if old.status <> 'draft' and (
       new.evidence_design is distinct from old.evidence_design
    or new.experiment_type is distinct from old.experiment_type
    or new.name is distinct from old.name
    or new.hypothesis is distinct from old.hypothesis
    or new.hypothesis_structured is distinct from old.hypothesis_structured
    or new.primary_metric is distinct from old.primary_metric
    or new.metric_source is distinct from old.metric_source
    or new.metric_label is distinct from old.metric_label
    or new.metric_unit is distinct from old.metric_unit
    or new.measurement_window is distinct from old.measurement_window
    or new.washout_days is distinct from old.washout_days
    or new.success_criterion is distinct from old.success_criterion
    or new.treatment_proposal_fingerprint is distinct from old.treatment_proposal_fingerprint
    or new.measurement_plan_fingerprint is distinct from old.measurement_plan_fingerprint
    or new.target_page_path is distinct from old.target_page_path
    or new.target_key is distinct from old.target_key
    or new.min_sample_size is distinct from old.min_sample_size
    or new.registered_at is distinct from old.registered_at
    or new.baseline_start is distinct from old.baseline_start
    or new.baseline_end is distinct from old.baseline_end
  ) then
    raise exception using errcode = '55000', message = 'experiment_plan_frozen';
  end if;
  if (old.treatment_started_at is not null and new.treatment_started_at is distinct from old.treatment_started_at)
     or (old.measurement_start is not null and new.measurement_start is distinct from old.measurement_start)
     or (old.measurement_end is not null and new.measurement_end is distinct from old.measurement_end)
     or (old.closed_reason is not null and new.closed_reason is distinct from old.closed_reason)
     or (old.invalidation_reason is not null and new.invalidation_reason is distinct from old.invalidation_reason) then
    raise exception using errcode = '55000', message = 'experiment_plan_frozen';
  end if;
  return new;
end;
$$;
drop trigger if exists experiments_freeze_plan on public.experiments;
create trigger experiments_freeze_plan before update on public.experiments
for each row execute function public.prevent_experiment_plan_mutation();

-- Lifecycle validation: legacy rules unchanged; v1 adds no-pause, registration and closure rules.
create or replace function public.validate_experiment_transition()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> old.status and not (
    (old.status = 'draft' and new.status in ('ready', 'canceled')) or
    (old.status = 'ready' and new.status in ('running', 'canceled')) or
    (old.status = 'running' and new.status in ('paused', 'completed', 'canceled')) or
    (old.status = 'paused' and new.status in ('running', 'completed', 'canceled')) or
    (old.status in ('completed', 'canceled') and false)
  ) then
    raise exception using errcode = '22023', message = 'invalid_experiment_transition';
  end if;
  -- Only a status change is a transition: a completed row may still move its result pointer.
  if new.status = 'completed' and new.status <> old.status and old.status not in ('running', 'paused') then
    raise exception using errcode = '22023', message = 'experiment_must_run_before_completion';
  end if;
  if new.measurement_policy_version = 'experiment_measurement_v1' and new.status <> old.status then
    if new.status = 'paused' then
      raise exception using errcode = '22023', message = 'experiment_pause_not_supported';
    end if;
    if new.status = 'ready' and new.registered_at is null then
      raise exception using errcode = '22023', message = 'experiment_not_registered';
    end if;
    if new.status = 'running' and new.treatment_started_at is null then
      raise exception using errcode = '22023', message = 'experiment_treatment_not_started';
    end if;
    if new.status = 'completed' and new.closed_reason is distinct from 'window_elapsed' then
      raise exception using errcode = '22023', message = 'experiment_closed_reason_required';
    end if;
    if new.status = 'canceled' and new.closed_reason is null then
      raise exception using errcode = '22023', message = 'experiment_closed_reason_required';
    end if;
  end if;
  return new;
end;
$$;

-- One append-only transition row per status change. Actor comes from the
-- transaction-local settings a user RPC sets; everything else is the system.
create or replace function public.record_experiment_transition()
returns trigger language plpgsql set search_path = public as $$
declare
  v_kind text := coalesce(nullif(current_setting('wanterest.experiment_actor_kind', true), ''), 'system');
  v_user uuid := nullif(current_setting('wanterest.experiment_actor_user_id', true), '')::uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if v_kind <> 'user' then v_kind := 'system'; v_user := null; end if;
  insert into public.experiment_transitions (workspace_id, product_id, experiment_id, from_status, to_status, reason, actor_kind, actor_user_id, metadata)
  values (new.workspace_id, new.product_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
          coalesce(new.closed_reason, nullif(current_setting('wanterest.experiment_transition_reason', true), '')),
          v_kind, v_user, coalesce(nullif(current_setting('wanterest.experiment_transition_metadata', true), ''), '{}')::jsonb);
  return new;
end;
$$;
drop trigger if exists experiments_record_transition on public.experiments;
create trigger experiments_record_transition after insert or update of status on public.experiments
for each row execute function public.record_experiment_transition();

-- One experiment per Action: under the Action lock, only an approved Action,
-- no non-terminal experiment, and only after user pre-treatment cancellations.
create or replace function public.enforce_experiment_action_rule()
returns trigger language plpgsql set search_path = public as $$
declare
  v_action public.actions;
begin
  select * into v_action from public.actions where workspace_id = new.workspace_id and id = new.action_id for update;
  if v_action.id is null or v_action.product_id <> new.product_id then
    raise exception using errcode = '23503', message = 'experiment_action_not_found';
  end if;
  if v_action.status <> 'approved' then
    raise exception using errcode = '22023', message = 'experiment_action_not_approved';
  end if;
  if new.measurement_policy_version = 'experiment_measurement_v1' and new.treatment_proposal_fingerprint is distinct from v_action.proposal_fingerprint then
    raise exception using errcode = '22023', message = 'experiment_action_fingerprint_mismatch';
  end if;
  if exists (
    select 1 from public.experiments e
     where e.workspace_id = new.workspace_id and e.action_id = new.action_id
       and (e.status in ('draft', 'ready', 'running', 'paused', 'completed')
            or e.treatment_started_at is not null
            or e.closed_reason is distinct from 'canceled_before_treatment')
  ) then
    raise exception using errcode = '23505', message = 'experiment_action_rule';
  end if;
  return new;
end;
$$;
drop trigger if exists experiments_enforce_action_rule on public.experiments;
create trigger experiments_enforce_action_rule before insert on public.experiments
for each row execute function public.enforce_experiment_action_rule();

-- The single experiment-aware reaction to every Action status change.
create or replace function public.reconcile_action_experiments()
returns trigger language plpgsql set search_path = public as $$
declare
  v_exp public.experiments;
  v_now timestamptz := timezone('utc', now());
  v_allowed boolean := coalesce(nullif(current_setting('wanterest.experiment_starts_allowed', true), ''), 'false') = 'true';
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  -- Late treatment confirmation: an experiment that already has a result gets
  -- its outcome recomputed (new append-only revision) by the measurement pass.
  if old.status = 'in_progress' and new.status = 'completed' then
    update public.experiments set outcome_recompute_requested_at = v_now
     where workspace_id = new.workspace_id and action_id = new.id
       and measurement_policy_version = 'experiment_measurement_v1'
       and treatment_started_at is not null and current_result_id is not null;
  end if;
  select * into v_exp from public.experiments
   where workspace_id = new.workspace_id and action_id = new.id
     and measurement_policy_version = 'experiment_measurement_v1'
     and status in ('draft', 'ready', 'running', 'paused')
   for update;
  if v_exp.id is null then
    return new;
  end if;
  perform set_config('wanterest.experiment_actor_kind', 'system', true);
  perform set_config('wanterest.experiment_transition_metadata', jsonb_build_object('actionId', new.id, 'actionFrom', old.status, 'actionTo', new.status)::text, true);

  if old.status = 'approved' and new.status = 'in_progress' then
    if v_exp.status = 'draft' then
      update public.experiments set status = 'canceled', closed_reason = 'treatment_started_before_registration', ended_at = v_now
       where workspace_id = v_exp.workspace_id and id = v_exp.id;
    elsif v_exp.status = 'ready' and v_allowed then
      update public.experiments set
        status = 'running', started_at = v_now, treatment_started_at = v_now,
        measurement_start = v_now + make_interval(days => v_exp.washout_days),
        measurement_end = v_now + make_interval(days => v_exp.washout_days) + public.experiment_window_interval(v_exp.measurement_window)
       where workspace_id = v_exp.workspace_id and id = v_exp.id;
    elsif v_exp.status = 'ready' then
      update public.experiments set status = 'canceled', closed_reason = 'measurement_disabled_at_treatment', ended_at = v_now
       where workspace_id = v_exp.workspace_id and id = v_exp.id;
    else
      raise exception using errcode = '40001', message = 'experiment_state_conflict';
    end if;
  elsif old.status in ('proposed', 'approved') and new.status in ('dismissed', 'expired', 'superseded') then
    if v_exp.status in ('draft', 'ready') then
      update public.experiments set status = 'canceled', closed_reason = 'action_closed_before_treatment', ended_at = v_now
       where workspace_id = v_exp.workspace_id and id = v_exp.id;
    else
      raise exception using errcode = '40001', message = 'experiment_state_conflict';
    end if;
  elsif old.status = 'in_progress' and new.status = 'dismissed' then
    if v_exp.status = 'running' then
      update public.experiments set status = 'canceled', closed_reason = 'treatment_abandoned', invalidation_reason = 'treatment_abandoned', ended_at = v_now
       where workspace_id = v_exp.workspace_id and id = v_exp.id;
    end if;
  end if;
  -- in_progress -> completed: the experiment keeps collecting; completion is treatment evidence.
  perform set_config('wanterest.experiment_transition_metadata', '', true);
  return new;
end;
$$;
drop trigger if exists actions_reconcile_experiments on public.actions;
create trigger actions_reconcile_experiments after update of status on public.actions
for each row execute function public.reconcile_action_experiments();

-- -------------------------- Layer 10 transition_action, extended (single start path)
drop function if exists public.transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text);
create or replace function public.transition_action(
  p_workspace_id uuid,
  p_action_id uuid,
  p_from text,
  p_to text,
  p_actor_kind text,
  p_actor_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_basis_guard jsonb default null,
  p_trace_id text default null,
  p_experiment_starts_allowed boolean default false
)
returns public.actions
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_action public.actions;
  v_updated public.actions;
  v_concept boolean;
  v_now timestamptz := timezone('utc', now());
  v_event text;
  v_exp public.experiments;
  v_live timestamptz;
begin
  -- Layer 11: default closed; only an explicit opt-in lets the trigger start a ready experiment.
  perform set_config('wanterest.experiment_starts_allowed', case when coalesce(p_experiment_starts_allowed, false) then 'true' else 'false' end, true);

  if p_actor_kind not in ('user', 'system', 'service') then
    raise exception using errcode = '22023', message = 'invalid_actor_kind';
  end if;

  select * into v_action from public.actions where workspace_id = p_workspace_id and id = p_action_id for update;
  if v_action.id is null then
    raise exception using errcode = 'P0002', message = 'action_not_found';
  end if;
  if v_action.status <> p_from then
    raise exception using errcode = '40001', message = 'action_status_conflict';
  end if;
  v_concept := v_action.trigger_type in ('concept_gap', 'concept_drift');

  if not (
    (p_from = 'proposed' and (p_to in ('approved', 'dismissed', 'expired') or (p_to = 'superseded' and not v_concept)))
    or (p_from = 'approved' and (p_to in ('in_progress', 'dismissed', 'expired') or (p_to = 'superseded' and not v_concept)))
    or (p_from = 'in_progress' and p_to in ('completed', 'dismissed'))
  ) then
    raise exception using errcode = '22023', message = 'action_transition_invalid';
  end if;

  if p_to = 'expired' and p_actor_kind <> 'system' then
    raise exception using errcode = '42501', message = 'action_transition_system_only';
  end if;

  if p_actor_kind = 'user' then
    if p_actor_user_id is null or not exists (
      select 1 from public.workspace_members wm
       where wm.workspace_id = p_workspace_id and wm.user_id = p_actor_user_id
         and wm.status = 'active' and wm.role in ('owner', 'admin', 'member')
    ) then
      raise exception using errcode = '42501', message = 'action_actor_forbidden';
    end if;
  end if;

  if v_concept and p_to in ('approved', 'in_progress') then
    perform public.assert_concept_action_basis_guard(v_action.workspace_id, v_action.product_id, v_action.trigger_clustering_version, v_action.trigger_concept_key, p_basis_guard);
  end if;

  -- Layer 11 treatment integrity: completing an Action measured by a running (or
  -- window-elapsed, possibly already measured) experiment requires the date the
  -- change went live, inside the frozen window.
  if p_to = 'completed' then
    select * into v_exp from public.experiments
     where workspace_id = p_workspace_id and action_id = p_action_id
       and measurement_policy_version = 'experiment_measurement_v1' and treatment_started_at is not null
       and (status = 'running' or (status = 'completed' and closed_reason = 'window_elapsed'))
     limit 1;
    if v_exp.id is not null then
      begin
        v_live := (p_metadata->>'liveSince')::timestamptz;
      exception when others then
        v_live := null;
      end;
      if v_live is null then
        raise exception using errcode = '22023', message = 'treatment_live_since_required';
      end if;
      if v_live < v_exp.treatment_started_at or v_live >= v_exp.measurement_end or v_live > v_now then
        raise exception using errcode = '22023', message = 'treatment_live_since_invalid';
      end if;
    end if;
  end if;

  update public.actions set
    status = p_to,
    approved_at = case when p_to = 'approved' then v_now else approved_at end,
    completed_at = case when p_to = 'completed' then v_now else completed_at end,
    dismissed_at = case when p_to = 'dismissed' then v_now else dismissed_at end,
    stale_at = case when p_to in ('expired', 'superseded') then coalesce(stale_at, v_now) else stale_at end
  where workspace_id = p_workspace_id and id = p_action_id and status = p_from
  returning * into v_updated;
  if v_updated.id is null then
    raise exception using errcode = '40001', message = 'action_status_conflict';
  end if;

  v_event := case p_to
    when 'approved' then 'approved' when 'in_progress' then 'started' when 'completed' then 'completed'
    when 'dismissed' then 'dismissed' when 'expired' then 'expired' when 'superseded' then 'superseded'
  end;
  insert into public.action_events (workspace_id, product_id, action_id, actor_user_id, actor_kind, event_type, from_status, to_status, metadata)
  values (v_updated.workspace_id, v_updated.product_id, v_updated.id, p_actor_user_id, p_actor_kind, v_event, p_from, p_to, coalesce(p_metadata, '{}'::jsonb));

  if p_actor_kind = 'user' then
    perform public.record_audit_event(p_workspace_id, p_actor_user_id, 'user', 'action.' || p_to, 'action', v_updated.id, p_trace_id, coalesce(p_metadata, '{}'::jsonb));
  end if;

  return v_updated;
end;
$$;

-- ------------------------------------------------------------ RPC helpers
create or replace function public.assert_experiment_actor(p_workspace_id uuid, p_actor_user_id uuid)
returns void language plpgsql stable security invoker set search_path = public as $$
begin
  if p_actor_user_id is null or not exists (
    select 1 from public.workspace_members wm
     where wm.workspace_id = p_workspace_id and wm.user_id = p_actor_user_id
       and wm.status = 'active' and wm.role in ('owner', 'admin', 'member')
  ) then
    raise exception using errcode = '42501', message = 'experiment_actor_forbidden';
  end if;
end;
$$;

create or replace function public.set_experiment_actor(p_actor_user_id uuid)
returns void language plpgsql volatile security invoker set search_path = public as $$
begin
  perform set_config('wanterest.experiment_actor_kind', 'user', true);
  perform set_config('wanterest.experiment_actor_user_id', p_actor_user_id::text, true);
end;
$$;

-- ------------------------------------------------------------ create
create or replace function public.create_experiment(p_experiment jsonb, p_actor_user_id uuid, p_basis_guard jsonb default null)
returns public.experiments
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_in public.experiments;
  v_existing public.experiments;
  v_action public.actions;
  v_new public.experiments;
begin
  v_in := jsonb_populate_record(null::public.experiments, p_experiment);
  if v_in.id is null or v_in.workspace_id is null or v_in.product_id is null or v_in.action_id is null or v_in.evidence_node_id is null
     or v_in.idempotency_key is null or v_in.measurement_policy_version is distinct from 'experiment_measurement_v1' then
    raise exception using errcode = '22023', message = 'invalid_experiment_payload';
  end if;
  perform public.assert_experiment_actor(v_in.workspace_id, p_actor_user_id);
  perform pg_advisory_xact_lock(hashtextextended(v_in.workspace_id::text || ':experiment:' || v_in.idempotency_key, 0));
  select * into v_existing from public.experiments where workspace_id = v_in.workspace_id and idempotency_key = v_in.idempotency_key;
  if v_existing.id is not null then
    return v_existing;
  end if;

  select * into v_action from public.actions where workspace_id = v_in.workspace_id and id = v_in.action_id for update;
  if v_action.id is null then
    raise exception using errcode = 'P0002', message = 'action_not_found';
  end if;
  if v_action.trigger_type in ('concept_gap', 'concept_drift') then
    perform public.assert_concept_action_basis_guard(v_action.workspace_id, v_action.product_id, v_action.trigger_clustering_version, v_action.trigger_concept_key, p_basis_guard);
  end if;

  perform public.set_experiment_actor(p_actor_user_id);
  insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id)
  values (v_in.evidence_node_id, 'experiment', v_in.workspace_id, 'experiments', v_in.id);
  insert into public.experiments (
    id, workspace_id, product_id, action_id, evidence_node_id, experiment_type, name, hypothesis, primary_metric,
    status, traffic_allocation, target_page_path, target_key, assignment_method, min_sample_size, created_by, engine_version_id,
    measurement_policy_version, evidence_design, metric_source, metric_label, metric_unit, measurement_window, washout_days,
    success_criterion, hypothesis_structured, treatment_proposal_fingerprint, measurement_plan_fingerprint, idempotency_key
  ) values (
    v_in.id, v_in.workspace_id, v_in.product_id, v_in.action_id, v_in.evidence_node_id, v_in.experiment_type, v_in.name, v_in.hypothesis, v_in.primary_metric,
    'draft', '{}'::jsonb, v_in.target_page_path, v_in.target_key, 'deterministic_hash_v1', coalesce(v_in.min_sample_size, 1), p_actor_user_id, v_in.engine_version_id,
    v_in.measurement_policy_version, v_in.evidence_design, v_in.metric_source, v_in.metric_label, v_in.metric_unit, v_in.measurement_window, v_in.washout_days,
    v_in.success_criterion, v_in.hypothesis_structured, v_in.treatment_proposal_fingerprint, v_in.measurement_plan_fingerprint, v_in.idempotency_key
  ) returning * into v_new;

  insert into public.evidence_provenance (derived_evidence_node_id, source_evidence_node_id, relation_type, weight, ordinal)
  values (v_new.evidence_node_id, v_action.evidence_node_id, 'derived_from_action', 1, 0)
  on conflict (derived_evidence_node_id, source_evidence_node_id, relation_type, ordinal) do nothing;

  perform public.consume_usage(v_new.workspace_id, 'experiment_created', 1, 'experiment_created:' || v_new.id::text,
    jsonb_build_object('experimentId', v_new.id, 'actionId', v_new.action_id), p_actor_user_id, null);
  perform public.record_audit_event(v_new.workspace_id, p_actor_user_id, 'user', 'experiment.created', 'experiment', v_new.id, null,
    jsonb_build_object('actionId', v_new.action_id, 'design', v_new.evidence_design, 'planFingerprint', v_new.measurement_plan_fingerprint));
  return v_new;
end;
$$;

-- ------------------------------------------------------------ draft edits
create or replace function public.update_experiment_draft(p_workspace_id uuid, p_experiment_id uuid, p_actor_user_id uuid, p_plan jsonb)
returns public.experiments
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_exp public.experiments;
  v_in public.experiments;
  v_new public.experiments;
begin
  perform public.assert_experiment_actor(p_workspace_id, p_actor_user_id);
  select * into v_exp from public.experiments where workspace_id = p_workspace_id and id = p_experiment_id for update;
  if v_exp.id is null or v_exp.measurement_policy_version is distinct from 'experiment_measurement_v1' then
    raise exception using errcode = 'P0002', message = 'experiment_not_found';
  end if;
  if v_exp.status <> 'draft' then
    raise exception using errcode = '40001', message = 'experiment_not_draft';
  end if;
  v_in := jsonb_populate_record(v_exp, p_plan);
  if v_in.measurement_plan_fingerprint is not distinct from v_exp.measurement_plan_fingerprint then
    return v_exp; -- idempotent replay: no change, no audit
  end if;
  if v_in.evidence_design is distinct from v_exp.evidence_design or v_in.metric_source is distinct from v_exp.metric_source then
    raise exception using errcode = '22023', message = 'experiment_design_fixed_at_creation';
  end if;
  perform public.set_experiment_actor(p_actor_user_id);
  update public.experiments set
    name = v_in.name, hypothesis = v_in.hypothesis, primary_metric = v_in.primary_metric, metric_label = v_in.metric_label,
    metric_unit = v_in.metric_unit, measurement_window = v_in.measurement_window, washout_days = v_in.washout_days,
    success_criterion = v_in.success_criterion, hypothesis_structured = v_in.hypothesis_structured,
    target_page_path = v_in.target_page_path, target_key = v_in.target_key,
    measurement_plan_fingerprint = v_in.measurement_plan_fingerprint
  where workspace_id = p_workspace_id and id = p_experiment_id
  returning * into v_new;
  perform public.record_audit_event(p_workspace_id, p_actor_user_id, 'user', 'experiment.plan_updated', 'experiment', p_experiment_id, null,
    jsonb_build_object('planFingerprint', v_new.measurement_plan_fingerprint));
  return v_new;
end;
$$;

create or replace function public.add_experiment_variant(p_workspace_id uuid, p_experiment_id uuid, p_actor_user_id uuid, p_variant jsonb)
returns public.experiment_variants
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_exp public.experiments;
  v_in public.experiment_variants;
  v_existing public.experiment_variants;
  v_new public.experiment_variants;
begin
  perform public.assert_experiment_actor(p_workspace_id, p_actor_user_id);
  select * into v_exp from public.experiments where workspace_id = p_workspace_id and id = p_experiment_id for update;
  if v_exp.id is null or v_exp.measurement_policy_version is distinct from 'experiment_measurement_v1' then
    raise exception using errcode = 'P0002', message = 'experiment_not_found';
  end if;
  v_in := jsonb_populate_record(null::public.experiment_variants, p_variant);
  select * into v_existing from public.experiment_variants where workspace_id = p_workspace_id and experiment_id = p_experiment_id and variant_key = v_in.variant_key;
  if v_existing.id is not null then
    return v_existing;
  end if;
  if v_exp.status <> 'draft' or v_exp.evidence_design <> 'controlled_split' then
    raise exception using errcode = '40001', message = 'experiment_variants_locked';
  end if;
  insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id)
  values (v_in.evidence_node_id, 'experiment_variant', p_workspace_id, 'experiment_variants', v_in.id);
  insert into public.experiment_variants (id, workspace_id, experiment_id, evidence_node_id, source_action_variant_id, variant_key, label, content, target, allocation_weight, is_control)
  values (v_in.id, p_workspace_id, p_experiment_id, v_in.evidence_node_id, v_in.source_action_variant_id, v_in.variant_key, v_in.label, v_in.content, coalesce(v_in.target, '{}'::jsonb), v_in.allocation_weight, coalesce(v_in.is_control, false))
  returning * into v_new;
  insert into public.evidence_provenance (derived_evidence_node_id, source_evidence_node_id, relation_type, weight, ordinal)
  values (v_new.evidence_node_id, v_exp.evidence_node_id, 'variant_of_experiment', 1, 0)
  on conflict (derived_evidence_node_id, source_evidence_node_id, relation_type, ordinal) do nothing;
  perform public.record_audit_event(p_workspace_id, p_actor_user_id, 'user', 'experiment.variant_added', 'experiment', p_experiment_id, null,
    jsonb_build_object('variantKey', v_new.variant_key, 'isControl', v_new.is_control));
  return v_new;
end;
$$;

-- ------------------------------------------------------------ ready
create or replace function public.mark_experiment_ready(p_workspace_id uuid, p_experiment_id uuid, p_actor_user_id uuid)
returns public.experiments
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_exp public.experiments;
  v_action public.actions;
  v_now timestamptz := timezone('utc', now());
  v_baseline_end timestamptz;
  v_baseline_start timestamptz;
  v_new public.experiments;
  v_variant_count integer;
  v_control_count integer;
  v_weight integer;
begin
  perform public.assert_experiment_actor(p_workspace_id, p_actor_user_id);
  select * into v_exp from public.experiments where workspace_id = p_workspace_id and id = p_experiment_id for update;
  if v_exp.id is null or v_exp.measurement_policy_version is distinct from 'experiment_measurement_v1' then
    raise exception using errcode = 'P0002', message = 'experiment_not_found';
  end if;
  if v_exp.status = 'ready' then
    return v_exp; -- idempotent replay
  end if;
  if v_exp.status <> 'draft' then
    raise exception using errcode = '40001', message = 'experiment_not_draft';
  end if;
  select * into v_action from public.actions where workspace_id = p_workspace_id and id = v_exp.action_id for update;
  if v_action.status <> 'approved' then
    raise exception using errcode = '40001', message = 'experiment_action_not_approved';
  end if;

  v_baseline_end := date_trunc('day', v_now);
  v_baseline_start := v_baseline_end - public.experiment_window_interval(v_exp.measurement_window);
  if v_exp.evidence_design = 'before_after' then
    if not exists (
      select 1 from public.experiment_observations o
       where o.workspace_id = p_workspace_id and o.experiment_id = p_experiment_id and o.window_role = 'baseline' and o.source = 'manual'
         and o.metric_key = v_exp.primary_metric and o.period_start = v_baseline_start and o.period_end = v_baseline_end
         and not exists (select 1 from public.experiment_observations s where s.supersedes_observation_id = o.id)
    ) then
      raise exception using errcode = '22023', message = 'experiment_baseline_required';
    end if;
  else
    select count(*), count(*) filter (where is_control), coalesce(sum(allocation_weight), 0)
      into v_variant_count, v_control_count, v_weight
      from public.experiment_variants where workspace_id = p_workspace_id and experiment_id = p_experiment_id;
    if v_variant_count <> 2 or v_control_count <> 1 or v_weight <> 10000 or v_exp.target_page_path is null or v_exp.target_key is null then
      raise exception using errcode = '22023', message = 'experiment_controlled_setup_incomplete';
    end if;
  end if;

  perform public.set_experiment_actor(p_actor_user_id);
  update public.experiments set status = 'ready', registered_at = v_now,
    baseline_start = case when v_exp.evidence_design = 'before_after' then v_baseline_start end,
    baseline_end = case when v_exp.evidence_design = 'before_after' then v_baseline_end end
  where workspace_id = p_workspace_id and id = p_experiment_id
  returning * into v_new;
  perform public.record_audit_event(p_workspace_id, p_actor_user_id, 'user', 'experiment.ready', 'experiment', p_experiment_id, null,
    jsonb_build_object('planFingerprint', v_new.measurement_plan_fingerprint));
  return v_new;
end;
$$;

-- ------------------------------------------------------------ cancel
create or replace function public.cancel_experiment(p_workspace_id uuid, p_experiment_id uuid, p_actor_user_id uuid, p_note text default null)
returns public.experiments
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_exp public.experiments;
  v_new public.experiments;
  v_reason text;
begin
  perform public.assert_experiment_actor(p_workspace_id, p_actor_user_id);
  select * into v_exp from public.experiments where workspace_id = p_workspace_id and id = p_experiment_id for update;
  if v_exp.id is null or v_exp.measurement_policy_version is distinct from 'experiment_measurement_v1' then
    raise exception using errcode = 'P0002', message = 'experiment_not_found';
  end if;
  if v_exp.status in ('completed', 'canceled') then
    return v_exp; -- idempotent replay: already terminal, no audit
  end if;
  v_reason := case when v_exp.status in ('draft', 'ready') then 'canceled_before_treatment' else 'stopped_early' end;
  perform public.set_experiment_actor(p_actor_user_id);
  update public.experiments set status = 'canceled', closed_reason = v_reason, ended_at = timezone('utc', now())
   where workspace_id = p_workspace_id and id = p_experiment_id
  returning * into v_new;
  perform public.record_audit_event(p_workspace_id, p_actor_user_id, 'user', 'experiment.canceled', 'experiment', p_experiment_id, null,
    jsonb_build_object('closedReason', v_reason, 'note', p_note));
  return v_new;
end;
$$;

-- ------------------------------------------------------------ observations
create or replace function public.record_experiment_observation(p_observation jsonb, p_actor_kind text, p_actor_user_id uuid default null)
returns public.experiment_observations
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_in public.experiment_observations;
  v_exp public.experiments;
  v_existing public.experiment_observations;
  v_prev public.experiment_observations;
  v_new public.experiment_observations;
  v_now timestamptz := timezone('utc', now());
  v_baseline_end timestamptz;
  v_baseline public.experiment_observations;
begin
  v_in := jsonb_populate_record(null::public.experiment_observations, p_observation);
  if v_in.id is null or v_in.workspace_id is null or v_in.experiment_id is null or v_in.evidence_node_id is null or v_in.idempotency_key is null then
    raise exception using errcode = '22023', message = 'invalid_observation_payload';
  end if;
  if p_actor_kind = 'user' then
    perform public.assert_experiment_actor(v_in.workspace_id, p_actor_user_id);
    if v_in.source <> 'manual' then
      raise exception using errcode = '22023', message = 'observation_source_invalid';
    end if;
  elsif p_actor_kind = 'system' then
    if v_in.source <> 'wanterest_internal' then
      raise exception using errcode = '22023', message = 'observation_source_invalid';
    end if;
  else
    raise exception using errcode = '22023', message = 'invalid_actor_kind';
  end if;

  select * into v_exp from public.experiments where workspace_id = v_in.workspace_id and id = v_in.experiment_id for update;
  if v_exp.id is null or v_exp.measurement_policy_version is distinct from 'experiment_measurement_v1' then
    raise exception using errcode = 'P0002', message = 'experiment_not_found';
  end if;
  select * into v_existing from public.experiment_observations where experiment_id = v_in.experiment_id and idempotency_key = v_in.idempotency_key;
  if v_existing.id is not null then
    return v_existing; -- idempotent replay: no second row, no audit
  end if;

  if v_in.source = 'manual' then
    if v_exp.evidence_design <> 'before_after' or v_in.metric_key <> v_exp.primary_metric then
      raise exception using errcode = '22023', message = 'observation_metric_invalid';
    end if;
    if (v_exp.metric_unit = 'rate' and v_in.denominator is null) or (v_exp.metric_unit in ('count', 'currency') and v_in.denominator is not null) then
      raise exception using errcode = '22023', message = 'observation_form_mismatch';
    end if;
    if v_in.window_role = 'baseline' then
      v_baseline_end := date_trunc('day', v_now);
      if v_exp.status <> 'draft' or v_in.period_end <> v_baseline_end
         or v_in.period_start <> v_baseline_end - public.experiment_window_interval(v_exp.measurement_window) then
        raise exception using errcode = '22023', message = 'observation_window_invalid';
      end if;
    else
      if not (v_exp.status = 'running' or (v_exp.status = 'completed' and v_exp.closed_reason = 'window_elapsed'))
         or v_now < v_exp.measurement_end or v_now >= v_exp.measurement_end + interval '7 days'
         or v_in.period_start <> v_exp.measurement_start or v_in.period_end <> v_exp.measurement_end then
        raise exception using errcode = '22023', message = 'observation_window_invalid';
      end if;
      select * into v_baseline from public.experiment_observations b
       where b.experiment_id = v_exp.id and b.window_role = 'baseline' and b.source = 'manual'
         and b.period_start = v_exp.baseline_start and b.period_end = v_exp.baseline_end
         and not exists (select 1 from public.experiment_observations s where s.supersedes_observation_id = b.id)
       order by b.recorded_at desc limit 1;
      if v_baseline.id is not null and ((v_baseline.denominator is null) <> (v_in.denominator is null)) then
        raise exception using errcode = '22023', message = 'observation_form_mismatch';
      end if;
    end if;
  else
    if v_in.metric_key <> 'market_evidence_count' then
      raise exception using errcode = '22023', message = 'observation_metric_invalid';
    end if;
  end if;

  if (select count(*) from public.experiment_observations where workspace_id = v_in.workspace_id and experiment_id = v_in.experiment_id) >= 200 then
    raise exception using errcode = '54000', message = 'experiment_observation_limit';
  end if;

  if v_in.supersedes_observation_id is not null then
    select * into v_prev from public.experiment_observations
     where workspace_id = v_in.workspace_id and id = v_in.supersedes_observation_id and experiment_id = v_in.experiment_id;
    if v_prev.id is null or v_prev.window_role <> v_in.window_role or v_prev.metric_key <> v_in.metric_key or v_prev.source <> v_in.source then
      raise exception using errcode = '22023', message = 'observation_supersession_invalid';
    end if;
  end if;

  insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id)
  values (v_in.evidence_node_id, 'experiment_observation', v_in.workspace_id, 'experiment_observations', v_in.id);
  insert into public.experiment_observations (
    id, workspace_id, product_id, experiment_id, evidence_node_id, metric_key, window_role, period_start, period_end,
    value, denominator, source, actor_user_id, note, source_ref, supersedes_observation_id, idempotency_key
  ) values (
    v_in.id, v_in.workspace_id, v_exp.product_id, v_in.experiment_id, v_in.evidence_node_id, v_in.metric_key, v_in.window_role, v_in.period_start, v_in.period_end,
    v_in.value, v_in.denominator, v_in.source, case when p_actor_kind = 'user' then p_actor_user_id end, v_in.note,
    coalesce(v_in.source_ref, '{}'::jsonb), v_in.supersedes_observation_id, v_in.idempotency_key
  ) returning * into v_new;

  if v_new.source = 'wanterest_internal' and (v_new.source_ref->>'evidenceNodeId') is not null then
    insert into public.evidence_provenance (derived_evidence_node_id, source_evidence_node_id, relation_type, weight, ordinal)
    values (v_new.evidence_node_id, (v_new.source_ref->>'evidenceNodeId')::uuid, 'context_from', 1, 0)
    on conflict (derived_evidence_node_id, source_evidence_node_id, relation_type, ordinal) do nothing;
  end if;
  -- A manual value (e.g. a correction) arriving after a result makes the outcome recomputable.
  if v_new.source = 'manual' and v_exp.current_result_id is not null then
    update public.experiments set outcome_recompute_requested_at = v_now
     where workspace_id = v_exp.workspace_id and id = v_exp.id;
  end if;
  if p_actor_kind = 'user' then
    perform public.record_audit_event(v_new.workspace_id, p_actor_user_id, 'user',
      case when v_new.supersedes_observation_id is null then 'experiment.observation_recorded' else 'experiment.observation_corrected' end,
      'experiment', v_new.experiment_id, null,
      jsonb_build_object('observationId', v_new.id, 'windowRole', v_new.window_role, 'source', 'manual'));
  end if;
  return v_new;
end;
$$;

-- ------------------------------------------------------------ public tokens
create or replace function public.issue_experiment_token(p_workspace_id uuid, p_experiment_id uuid, p_actor_user_id uuid, p_token_id uuid, p_public_key text, p_token_hash text)
returns public.experiment_public_tokens
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_exp public.experiments;
  v_existing public.experiment_public_tokens;
  v_new public.experiment_public_tokens;
begin
  perform public.assert_experiment_actor(p_workspace_id, p_actor_user_id);
  select * into v_exp from public.experiments where workspace_id = p_workspace_id and id = p_experiment_id for update;
  if v_exp.id is null then
    raise exception using errcode = 'P0002', message = 'experiment_not_found';
  end if;
  select * into v_existing from public.experiment_public_tokens where workspace_id = p_workspace_id and id = p_token_id;
  if v_existing.id is not null then
    return v_existing; -- idempotent replay
  end if;
  if v_exp.measurement_policy_version = 'experiment_measurement_v1' and (v_exp.evidence_design <> 'controlled_split' or v_exp.status not in ('ready', 'running')) then
    raise exception using errcode = '40001', message = 'experiment_token_not_allowed';
  end if;
  insert into public.experiment_public_tokens (id, workspace_id, experiment_id, public_key, token_hash, status)
  values (p_token_id, p_workspace_id, p_experiment_id, p_public_key, p_token_hash, 'active')
  returning * into v_new;
  perform public.record_audit_event(p_workspace_id, p_actor_user_id, 'user', 'experiment.public_token_issued', 'experiment_public_tokens', v_new.id, null,
    jsonb_build_object('experimentId', p_experiment_id));
  return v_new;
end;
$$;

create or replace function public.revoke_experiment_token(p_workspace_id uuid, p_token_id uuid, p_actor_user_id uuid)
returns public.experiment_public_tokens
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_row public.experiment_public_tokens;
begin
  perform public.assert_experiment_actor(p_workspace_id, p_actor_user_id);
  -- Workspace scope is inside the UPDATE itself: a foreign token is never touched.
  update public.experiment_public_tokens set status = 'revoked', revoked_at = timezone('utc', now())
   where workspace_id = p_workspace_id and id = p_token_id and status = 'active'
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.experiment_public_tokens where workspace_id = p_workspace_id and id = p_token_id;
    if v_row.id is null then
      raise exception using errcode = 'P0002', message = 'experiment_token_not_found';
    end if;
    return v_row; -- already revoked: idempotent, no audit
  end if;
  perform public.record_audit_event(p_workspace_id, p_actor_user_id, 'user', 'experiment.public_token_revoked', 'experiment_public_tokens', v_row.id, null,
    jsonb_build_object('experimentId', v_row.experiment_id));
  return v_row;
end;
$$;

-- ------------------------------------------------ controlled aggregate (SQL-side)
create or replace function public.experiment_arm_counts(p_workspace_id uuid, p_experiment_id uuid)
returns table (variant_id uuid, is_control boolean, exposed bigint, converted bigint, excluded_events bigint, days_with_exposure bigint, window_days integer)
language sql stable security invoker set search_path = public as $$
  with e as (
    select measurement_start as s, measurement_end as t, primary_metric as m
      from public.experiments where workspace_id = p_workspace_id and id = p_experiment_id
  ),
  first_exposure as (
    select ev.variant_id, ev.subject_key_hash, min(ev.occurred_at) as exposed_at
      from public.experiment_events ev, e
     where ev.workspace_id = p_workspace_id and ev.experiment_id = p_experiment_id and ev.event_type = 'exposure'
       and ev.occurred_at >= e.s and ev.occurred_at < e.t
     group by ev.variant_id, ev.subject_key_hash
  ),
  qualifying as (
    select distinct f.variant_id, f.subject_key_hash
      from first_exposure f
      join public.experiment_events c on c.workspace_id = p_workspace_id and c.experiment_id = p_experiment_id
       and c.variant_id = f.variant_id and c.subject_key_hash = f.subject_key_hash
      join e on c.event_type = e.m and c.occurred_at >= f.exposed_at and c.occurred_at < e.t
  ),
  conversions_total as (
    select c.variant_id, count(*) as n from public.experiment_events c, e
     where c.workspace_id = p_workspace_id and c.experiment_id = p_experiment_id and c.event_type = e.m group by c.variant_id
  ),
  conversions_counted as (
    select c.variant_id, count(*) as n
      from public.experiment_events c
      join e on c.event_type = e.m
      join first_exposure f on f.variant_id = c.variant_id and f.subject_key_hash = c.subject_key_hash
     where c.workspace_id = p_workspace_id and c.experiment_id = p_experiment_id and c.occurred_at >= f.exposed_at and c.occurred_at < e.t
     group by c.variant_id
  ),
  exposures_outside as (
    select ev.variant_id, count(*) as n from public.experiment_events ev, e
     where ev.workspace_id = p_workspace_id and ev.experiment_id = p_experiment_id and ev.event_type = 'exposure'
       and (ev.occurred_at < e.s or ev.occurred_at >= e.t) group by ev.variant_id
  ),
  days as (
    select count(distinct date_trunc('day', f.exposed_at)) as d from first_exposure f
  )
  select v.id, v.is_control,
         (select count(*) from first_exposure f where f.variant_id = v.id),
         (select count(*) from qualifying q where q.variant_id = v.id),
         coalesce((select n from conversions_total ct where ct.variant_id = v.id), 0)
           - coalesce((select n from conversions_counted cc where cc.variant_id = v.id), 0)
           + coalesce((select n from exposures_outside eo where eo.variant_id = v.id), 0),
         (select d from days),
         (select ceil(extract(epoch from (e.t - e.s)) / 86400)::integer from e)
    from public.experiment_variants v
   where v.workspace_id = p_workspace_id and v.experiment_id = p_experiment_id
   order by v.is_control desc, v.variant_key;
$$;

-- ---------------------------------------- due experiments for the measurement pass
create or replace function public.experiments_due_for_measurement(p_now timestamptz, p_limit integer default 50)
returns setof public.experiments
language sql stable security invoker set search_path = public as $$
  select * from public.experiments e
   where e.measurement_policy_version = 'experiment_measurement_v1'
     and (
       (e.status = 'running' and e.evidence_design = 'controlled_split' and p_now >= e.measurement_end + interval '1 day')
       or (e.status = 'running' and e.evidence_design = 'before_after' and (
             p_now >= e.measurement_end + interval '7 days'
             or (p_now >= e.measurement_end and exists (
                   select 1 from public.experiment_observations o
                    where o.experiment_id = e.id and o.window_role = 'measurement' and o.source = 'manual')))
          )
       or (e.status = 'canceled' and e.treatment_started_at is not null and e.current_result_id is null)
       -- revision candidates: only rows carrying the transactional marker (partial index), never a historical rescan
       or (e.outcome_recompute_requested_at is not null and e.status in ('completed', 'canceled') and e.current_result_id is not null)
     )
   order by coalesce(e.measurement_end, e.ended_at), e.id
   limit least(greatest(coalesce(p_limit, 50), 1), 50);
$$;

-- ---------------------------------------------- outcome revision + finalization
drop function if exists public.finalize_experiment_outcome(uuid, uuid, jsonb, boolean, uuid[]);
create or replace function public.finalize_experiment_outcome(p_workspace_id uuid, p_experiment_id uuid, p_result jsonb, p_close boolean, p_observation_ids uuid[] default '{}', p_recompute_seen timestamptz default null)
returns public.experiment_results
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_exp public.experiments;
  v_in public.experiment_results;
  v_row public.experiment_results;
  v_revision integer;
  v_obs uuid;
  v_node uuid;
begin
  select * into v_exp from public.experiments where workspace_id = p_workspace_id and id = p_experiment_id for update;
  if v_exp.id is null or v_exp.measurement_policy_version is distinct from 'experiment_measurement_v1' then
    raise exception using errcode = 'P0002', message = 'experiment_not_found';
  end if;
  v_in := jsonb_populate_record(null::public.experiment_results, p_result);
  select * into v_row from public.experiment_results
   where workspace_id = p_workspace_id and experiment_id = p_experiment_id and input_fingerprint = v_in.input_fingerprint;
  if v_row.id is null then
    select coalesce(max(revision), 0) + 1 into v_revision from public.experiment_results where workspace_id = p_workspace_id and experiment_id = p_experiment_id;
    if v_revision > 100 then
      raise exception using errcode = '54000', message = 'experiment_result_limit';
    end if;
    insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id)
    values (v_in.evidence_node_id, 'experiment_result', p_workspace_id, 'experiment_results', v_in.id);
    insert into public.experiment_results (
      id, workspace_id, experiment_id, evidence_node_id, revision, calculation_version, primary_metric, result_state, min_sample_size,
      total_assignments, total_exposed_subjects, variant_results, outcome, outcome_version, attribution_class, treatment_integrity,
      baseline_value, observed_value, effect, effect_basis, evidence_completeness, inconclusive_reasons, invalidation_reason,
      input_fingerprint, arm_results, summary
    ) values (
      v_in.id, p_workspace_id, p_experiment_id, v_in.evidence_node_id, v_revision, 'experiment_outcome_v1', v_exp.primary_metric, 'completed',
      greatest(coalesce(v_in.min_sample_size, 1), 1), coalesce(v_in.total_assignments, 0), coalesce(v_in.total_exposed_subjects, 0), coalesce(v_in.variant_results, '[]'::jsonb),
      v_in.outcome, 'experiment_outcome_v1', v_in.attribution_class, v_in.treatment_integrity,
      v_in.baseline_value, v_in.observed_value, v_in.effect, v_in.effect_basis, v_in.evidence_completeness, coalesce(v_in.inconclusive_reasons, '{}'),
      v_in.invalidation_reason, v_in.input_fingerprint, v_in.arm_results, v_in.summary
    ) returning * into v_row;
    insert into public.evidence_provenance (derived_evidence_node_id, source_evidence_node_id, relation_type, weight, ordinal)
    values (v_row.evidence_node_id, v_exp.evidence_node_id, 'measures_experiment', 1, 0)
    on conflict (derived_evidence_node_id, source_evidence_node_id, relation_type, ordinal) do nothing;
    foreach v_obs in array coalesce(p_observation_ids, '{}') loop
      select evidence_node_id into v_node from public.experiment_observations where workspace_id = p_workspace_id and experiment_id = p_experiment_id and id = v_obs;
      if v_node is not null then
        insert into public.evidence_provenance (derived_evidence_node_id, source_evidence_node_id, relation_type, weight, ordinal)
        values (v_row.evidence_node_id, v_node, 'uses_observation', 1, 0)
        on conflict (derived_evidence_node_id, source_evidence_node_id, relation_type, ordinal) do nothing;
      end if;
    end loop;
  end if;
  if v_exp.current_result_id is distinct from v_row.id then
    update public.experiments set current_result_id = v_row.id where workspace_id = p_workspace_id and id = p_experiment_id;
  end if;
  if p_close and v_exp.status = 'running' then
    update public.experiments set status = 'completed', closed_reason = 'window_elapsed', ended_at = timezone('utc', now())
     where workspace_id = p_workspace_id and id = p_experiment_id;
  end if;
  -- Compare-and-clear: a marker set after the caller read its inputs survives for the next pass.
  if v_exp.outcome_recompute_requested_at is not null and v_exp.outcome_recompute_requested_at = p_recompute_seen then
    update public.experiments set outcome_recompute_requested_at = null
     where workspace_id = p_workspace_id and id = p_experiment_id;
  end if;
  return v_row;
end;
$$;

-- -------------------------------------------------------------- RLS / grants
alter table public.experiment_transitions enable row level security;
alter table public.experiment_observations enable row level security;
revoke all on public.experiment_transitions from anon, authenticated;
revoke all on public.experiment_observations from anon, authenticated;
grant select on public.experiment_transitions to authenticated;
grant select on public.experiment_observations to authenticated;
grant all on public.experiment_transitions to service_role;
grant all on public.experiment_observations to service_role;
drop policy if exists experiment_transitions_member_select on public.experiment_transitions;
create policy experiment_transitions_member_select on public.experiment_transitions for select to authenticated
using (public.is_workspace_member(workspace_id));
drop policy if exists experiment_observations_member_select on public.experiment_observations;
create policy experiment_observations_member_select on public.experiment_observations for select to authenticated
using (public.is_workspace_member(workspace_id));

drop trigger if exists experiment_transitions_append_only on public.experiment_transitions;
create trigger experiment_transitions_append_only before update or delete on public.experiment_transitions
for each row execute function public.prevent_phase7_append_only_mutation();
drop trigger if exists experiment_observations_append_only on public.experiment_observations;
create trigger experiment_observations_append_only before update or delete on public.experiment_observations
for each row execute function public.prevent_phase7_append_only_mutation();

revoke all on function public.experiment_window_interval(text) from public, anon, authenticated;
revoke all on function public.enforce_experiment_v1_collection() from public, anon, authenticated;
revoke all on function public.transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.assert_experiment_actor(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_experiment_actor(uuid) from public, anon, authenticated;
revoke all on function public.create_experiment(jsonb, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.update_experiment_draft(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.add_experiment_variant(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mark_experiment_ready(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.cancel_experiment(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_experiment_observation(jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.issue_experiment_token(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.revoke_experiment_token(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.experiment_arm_counts(uuid, uuid) from public, anon, authenticated;
revoke all on function public.experiments_due_for_measurement(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.finalize_experiment_outcome(uuid, uuid, jsonb, boolean, uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.experiment_window_interval(text) to service_role;
grant execute on function public.transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text, boolean) to service_role;
grant execute on function public.assert_experiment_actor(uuid, uuid) to service_role;
grant execute on function public.set_experiment_actor(uuid) to service_role;
grant execute on function public.create_experiment(jsonb, uuid, jsonb) to service_role;
grant execute on function public.update_experiment_draft(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.add_experiment_variant(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.mark_experiment_ready(uuid, uuid, uuid) to service_role;
grant execute on function public.cancel_experiment(uuid, uuid, uuid, text) to service_role;
grant execute on function public.record_experiment_observation(jsonb, text, uuid) to service_role;
grant execute on function public.issue_experiment_token(uuid, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.revoke_experiment_token(uuid, uuid, uuid) to service_role;
grant execute on function public.experiment_arm_counts(uuid, uuid) to service_role;
grant execute on function public.experiments_due_for_measurement(timestamptz, integer) to service_role;
grant execute on function public.finalize_experiment_outcome(uuid, uuid, jsonb, boolean, uuid[], timestamptz) to service_role;

comment on table public.experiment_observations is 'Layer 11: append-only before/after, manual and internal-context observations; corrections supersede, never update.';
comment on table public.experiment_transitions is 'Layer 11: one append-only row per experiment status change (user or system actor).';
comment on function public.transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text, boolean) is 'Layer 10 compare-and-set Action transition; Layer 11 adds the default-closed experiment start opt-in and treatment liveSince validation.';
