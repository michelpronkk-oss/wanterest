-- Layer 11 real-Postgres proof for 20261019000000_experiment_measurement_v1.sql.
-- Run by tests/rls/experiment-measurement-postgres.test.ts against a throwaway local
-- database that has every migration applied (never a shared/production DB).
-- Each check prints "OK <name>"; any failure raises and aborts the script.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema if not exists l11t;
grant usage on schema l11t to authenticated, service_role;
create or replace function l11t.expect_error(p_sql text, p_pattern text, p_name text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ~ p_pattern or sqlstate ~ p_pattern then return 'OK ' || p_name; end if;
    raise exception 'check % failed: expected /%/ got [%] %', p_name, p_pattern, sqlstate, sqlerrm;
  end;
  raise exception 'check % failed: expected an error matching /%/', p_name, p_pattern;
end;
$$;
create or replace function l11t.ok(p_cond boolean, p_name text) returns text language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'check % failed', p_name; end if;
  return 'OK ' || p_name;
end;
$$;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'member@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'viewer@example.test'),
  ('10000000-0000-4000-8000-000000000003', 'outsider@example.test');
insert into public.workspaces (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Workspace One', 'workspace-one', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Workspace Two', 'workspace-two', '10000000-0000-4000-8000-000000000003');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'member'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'viewer'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'owner');
select set_config('request.jwt.claim.role', 'service_role', false);
select public.initialize_workspace_entitlements('20000000-0000-4000-8000-000000000001', (select id from public.plan_catalog where plan_code = 'growth' order by version desc limit 1));
select public.initialize_workspace_entitlements('20000000-0000-4000-8000-000000000002', (select id from public.plan_catalog where plan_code = 'free' order by version desc limit 1));
insert into public.products (id, workspace_id, name, slug) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Product One', 'product-one'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Product Two', 'product-two');
insert into public.engine_versions (id, engine_type, version, model) values ('40000000-0000-4000-8000-000000000001', 'action', 'l11-real-pg-test', 'deterministic');
insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('51000000-0000-4000-8000-000000000001', 'product_snapshot', '20000000-0000-4000-8000-000000000001', 'product_snapshots', '50000000-0000-4000-8000-000000000001');
insert into public.product_snapshots (id, workspace_id, product_id, evidence_node_id, snapshot_version, page_type, raw_text, normalized_text, content_hash)
values ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 1, 'manual', 'x', 'x', repeat('a', 64));

-- Set a workspace-one integer/boolean entitlement (append-only revision).
create or replace function l11t.entitle(p_key text, p_value jsonb) returns void language plpgsql as $$
begin
  update public.workspace_entitlements set effective_to = now() where workspace_id = '20000000-0000-4000-8000-000000000001' and capability_key = p_key and effective_to is null;
  insert into public.workspace_entitlements (workspace_id, plan_catalog_id, capability_key, value_type, value_json, revision, effective_from)
  select workspace_id, plan_catalog_id, capability_key, value_type, p_value, revision + 1, now() from public.workspace_entitlements
   where workspace_id = '20000000-0000-4000-8000-000000000001' and capability_key = p_key order by revision desc limit 1;
end;
$$;
select l11t.entitle('experiments_max', '100'::jsonb);

create table l11t.guards (action_id uuid primary key, guard jsonb not null);
-- One concept (market + gap) and one proposed concept Action for it; stores the basis guard.
create or replace function l11t.action(p_action uuid, p_concept text) returns uuid language plpgsql as $$
declare
  v_market uuid := gen_random_uuid();
  v_gap uuid := gen_random_uuid();
  v_key text := 'action:' || p_concept;
begin
  insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values (gen_random_uuid(), 'concept_market_state', '20000000-0000-4000-8000-000000000001', 'concept_market_states', v_market);
  insert into public.concept_market_states (id, workspace_id, product_id, evidence_node_id, clustering_version, anchor_concept_key, concept_market_state_policy_version, market_state_engine_version_id, previous_state_id, sequence, input_fingerprint, strength_level, distinct_evidence_count, distinct_source_count, contributing_membership_count, excluded_membership_count, computed_at)
  values (v_market, '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', (select id from public.evidence_nodes where entity_id = v_market), 'demand_clustering_v1', p_concept, 'concept_market_state_v1', '40000000-0000-4000-8000-000000000001', null, 1, repeat('a', 64), 'corroborated', 24, 2, 24, 0, now());
  insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values (gen_random_uuid(), 'concept_gap_state', '20000000-0000-4000-8000-000000000001', 'concept_gap_states', v_gap);
  insert into public.concept_gap_states (id, workspace_id, product_id, evidence_node_id, clustering_version, anchor_concept_key, gap_state_policy_version, gap_engine_version_id, market_state_id, product_snapshot_id, previous_state_id, sequence, input_fingerprint, status, share_of_current_demand, positioning_weight, high_intent_share, sample_quality, gap_score, computed_at)
  values (v_gap, '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', (select id from public.evidence_nodes where entity_id = v_gap), 'demand_clustering_v1', p_concept, 'concept_gap_state_v1', '40000000-0000-4000-8000-000000000001', v_market, '50000000-0000-4000-8000-000000000001', null, 1, repeat('b', 64), 'scored', 0.6, 0.1, 1, 'normal', 0.6, now());
  perform public.create_concept_action(jsonb_build_object(
    'id', p_action, 'workspace_id', '20000000-0000-4000-8000-000000000001', 'product_id', '30000000-0000-4000-8000-000000000001',
    'evidence_node_id', gen_random_uuid(), 'action_type', 'messaging_change', 'trigger_type', 'concept_gap', 'trigger_id', v_gap,
    'trigger_evidence_node_id', (select id from public.evidence_nodes where entity_id = v_gap),
    'trigger_concept_key', p_concept, 'trigger_clustering_version', 'demand_clustering_v1', 'proposal_fingerprint', repeat('d', 64),
    'target_key', 'homepage_hero', 'title', 'Test title', 'summary', 'Test summary', 'why', 'Test why', 'suggested_change', 'Test change',
    'priority_score', 0.5, 'confidence', 0.5, 'action_engine_version_id', '40000000-0000-4000-8000-000000000001',
    'priority_formula_version', 'action-priority-v1', 'input_fingerprint', encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), 'idempotency_key', v_key));
  insert into l11t.guards values (p_action, jsonb_build_object(
    'marketStatePolicyVersion', 'concept_market_state_v1', 'marketStateId', v_market,
    'gapStatePolicyVersion', 'concept_gap_state_v1', 'gapStateId', v_gap,
    'driftStatePolicyVersion', 'concept_drift_state_v1', 'driftStateIds', '{}'::jsonb));
  return p_action;
end;
$$;
-- Action transition by the workspace member (guard attached where Layer 10 requires one).
create or replace function l11t.tx(p_action uuid, p_from text, p_to text, p_meta jsonb default '{}'::jsonb, p_allowed boolean default false) returns public.actions language sql as $$
  select public.transition_action('20000000-0000-4000-8000-000000000001', p_action, p_from, p_to, 'user', '10000000-0000-4000-8000-000000000001', p_meta,
    case when p_to in ('approved', 'in_progress') then (select guard from l11t.guards where action_id = p_action) end, null, p_allowed)
$$;
-- A v1 experiment plan payload for one Action.
create or replace function l11t.exp(p_id uuid, p_action uuid, p_design text, p_plan text default 'plan-a') returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'workspace_id', '20000000-0000-4000-8000-000000000001', 'product_id', '30000000-0000-4000-8000-000000000001',
    'action_id', p_action, 'evidence_node_id', gen_random_uuid(), 'experiment_type', 'messaging_test', 'name', 'Test experiment',
    'hypothesis', 'If we change the hero, then qualified demos increase.',
    'primary_metric', case when p_design = 'before_after' then 'manual_custom' else 'signup_completed' end,
    'metric_source', case when p_design = 'before_after' then 'manual' else 'experiment_events' end,
    'metric_label', case when p_design = 'before_after' then 'Qualified demos' end,
    'metric_unit', case when p_design = 'before_after' then 'count' end,
    'target_page_path', case when p_design = 'controlled_split' then '/pricing' end,
    'target_key', case when p_design = 'controlled_split' then 'hero' end,
    'min_sample_size', 3, 'engine_version_id', '40000000-0000-4000-8000-000000000001',
    'measurement_policy_version', 'experiment_measurement_v1', 'evidence_design', p_design, 'measurement_window', '7d', 'washout_days', 0,
    'success_criterion', jsonb_build_object('direction', 'increase', 'measure', 'absolute_delta', 'minimumEffect', 5)
      || case when p_design = 'controlled_split' then jsonb_build_object('minSamplePerArm', 3) else '{}'::jsonb end,
    'hypothesis_structured', jsonb_build_object('hypothesisVersion', 'experiment_hypothesis_v1', 'change', 'hero'),
    'treatment_proposal_fingerprint', (select proposal_fingerprint from public.actions where id = p_action),
    'measurement_plan_fingerprint', encode(sha256(convert_to(p_plan, 'UTF8')), 'hex'),
    'idempotency_key', 'experiment:' || p_action || ':' || encode(sha256(convert_to(p_plan, 'UTF8')), 'hex'))
$$;
-- Test-only clock shift: moves a running experiment's treatment/measurement window into the past.
create or replace function l11t.age(p_exp uuid, p_days integer) returns void language plpgsql as $$
begin
  alter table public.experiments disable trigger experiments_freeze_plan;
  update public.experiments set
    started_at = started_at - make_interval(days => p_days), treatment_started_at = treatment_started_at - make_interval(days => p_days),
    measurement_start = measurement_start - make_interval(days => p_days), measurement_end = measurement_end - make_interval(days => p_days)
   where id = p_exp;
  alter table public.experiments enable trigger experiments_freeze_plan;
end;
$$;
create or replace function l11t.obs(p_id uuid, p_exp uuid, p_role text, p_value numeric, p_key text, p_start timestamptz, p_end timestamptz, p_supersedes uuid default null, p_denominator numeric default null) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'workspace_id', '20000000-0000-4000-8000-000000000001', 'experiment_id', p_exp, 'evidence_node_id', gen_random_uuid(),
    'metric_key', 'manual_custom', 'window_role', p_role, 'period_start', p_start, 'period_end', p_end, 'value', p_value, 'denominator', p_denominator,
    'source', 'manual', 'idempotency_key', p_key, 'supersedes_observation_id', p_supersedes)
$$;
create or replace function l11t.result(p_id uuid, p_fp text, p_outcome text default 'positive') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'evidence_node_id', gen_random_uuid(), 'outcome', p_outcome, 'attribution_class', 'before_after_association',
    'treatment_integrity', 'confirmed', 'baseline_value', 10, 'observed_value', 18, 'effect', 8, 'effect_basis', 'absolute_delta',
    'evidence_completeness', 'complete', 'inconclusive_reasons', '{}'::text[], 'input_fingerprint', p_fp, 'summary', 'Observed after the change: 18 vs 10 before.')
$$;
create or replace function l11t.bl_end() returns timestamptz language sql as $$ select date_trunc('day', timezone('utc', now())) $$;

select l11t.action('70000000-0000-4000-8000-000000000001', 'c_before_after');
select l11t.action('70000000-0000-4000-8000-000000000002', 'c_controlled');
select l11t.action('70000000-0000-4000-8000-000000000003', 'c_draft_at_start');
select l11t.action('70000000-0000-4000-8000-000000000004', 'c_flag_off');
select l11t.action('70000000-0000-4000-8000-000000000005', 'c_closed_before');
select l11t.action('70000000-0000-4000-8000-000000000006', 'c_abandoned');
select l11t.action('70000000-0000-4000-8000-000000000007', 'c_recreate');

-- ------------------------------------------------------ privileges (grants)
select l11t.ok(
  not has_function_privilege('authenticated', 'public.create_experiment(jsonb, uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.create_experiment(jsonb, uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_experiment_observation(jsonb, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.finalize_experiment_outcome(uuid, uuid, jsonb, boolean, uuid[])', 'execute')
  and not has_function_privilege('authenticated', 'public.revoke_experiment_token(uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.experiment_arm_counts(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text, boolean)', 'execute')
  and has_function_privilege('service_role', 'public.create_experiment(jsonb, uuid, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.cancel_experiment(uuid, uuid, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.experiments_due_for_measurement(timestamptz, integer)', 'execute')
  and has_function_privilege('service_role', 'public.transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text, boolean)', 'execute'),
  'rpc_grants_service_role_only');
select l11t.ok((select count(*) = 0 from pg_proc where proname = 'transition_action' and pronargs = 9), 'old_transition_action_signature_dropped');
select l11t.ok((select count(*) = 1 from pg_proc p where p.proname = 'transition_action'
  and pg_get_function_arguments(p.oid) like '%p_experiment_starts_allowed boolean DEFAULT false%'), 'experiment_starts_default_false');
select l11t.ok((select relrowsecurity from pg_class where oid = 'public.experiment_observations'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.experiment_transitions'::regclass), 'new_tables_rls_enabled');

-- -------------------------------------------------------------- creation
select l11t.expect_error($q$ select public.create_experiment(l11t.exp(gen_random_uuid(), '70000000-0000-4000-8000-000000000001', 'before_after'), '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000001')) $q$, 'experiment_action_not_approved', 'create_requires_approved_action');
select (l11t.tx(id, 'proposed', 'approved')).status from unnest(array['70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000005', '70000000-0000-4000-8000-000000000006', '70000000-0000-4000-8000-000000000007']::uuid[]) as id;
select l11t.expect_error($q$ select public.create_experiment(l11t.exp(gen_random_uuid(), '70000000-0000-4000-8000-000000000001', 'before_after'), '10000000-0000-4000-8000-000000000002', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000001')) $q$, 'experiment_actor_forbidden', 'viewer_cannot_create');
select l11t.expect_error($q$ select public.create_experiment(l11t.exp(gen_random_uuid(), '70000000-0000-4000-8000-000000000001', 'before_after'), '10000000-0000-4000-8000-000000000003', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000001')) $q$, 'experiment_actor_forbidden', 'outsider_cannot_create');
select l11t.expect_error($q$ select public.create_experiment(l11t.exp(gen_random_uuid(), '70000000-0000-4000-8000-000000000001', 'before_after') || '{"workspace_id":"20000000-0000-4000-8000-000000000002","product_id":"30000000-0000-4000-8000-000000000002"}', '10000000-0000-4000-8000-000000000003', null) $q$, 'action_not_found', 'cross_workspace_action_rejected');
select l11t.expect_error($q$ select public.create_experiment(l11t.exp(gen_random_uuid(), '70000000-0000-4000-8000-000000000001', 'before_after'), '10000000-0000-4000-8000-000000000001', null) $q$, 'action_basis_guard_required', 'create_revalidates_layer10_basis');
select l11t.expect_error($q$ select public.create_experiment(l11t.exp(gen_random_uuid(), '70000000-0000-4000-8000-000000000001', 'before_after') || jsonb_build_object('treatment_proposal_fingerprint', repeat('e', 64)), '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000001')) $q$, 'experiment_action_fingerprint_mismatch', 'treatment_fingerprint_must_match_action');
select l11t.expect_error($q$ select public.create_experiment(l11t.exp(gen_random_uuid(), '70000000-0000-4000-8000-000000000001', 'before_after') || '{"success_criterion":{"direction":"increase","measure":"absolute_delta","minimumEffect":0}}', '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000001')) $q$, 'experiments_measurement_v1_check', 'minimum_effect_required');
select l11t.expect_error($q$ select public.create_experiment(l11t.exp(gen_random_uuid(), '70000000-0000-4000-8000-000000000001', 'before_after') || '{"metric_label":null}', '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000001')) $q$, 'experiments_measurement_v1_check', 'manual_custom_requires_label_and_unit');
select l11t.expect_error($q$ select public.create_experiment(l11t.exp(gen_random_uuid(), '70000000-0000-4000-8000-000000000002', 'controlled_split') || '{"primary_metric":"manual_custom","metric_label":"x","metric_unit":"count"}', '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000002')) $q$, 'experiments_measurement_v1_check', 'controlled_rejects_manual_metric');
select l11t.expect_error($q$ select public.create_experiment(l11t.exp(gen_random_uuid(), '70000000-0000-4000-8000-000000000002', 'controlled_split') || '{"success_criterion":{"direction":"increase","measure":"absolute_delta","minimumEffect":0.01}}', '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000002')) $q$, 'experiments_measurement_v1_check', 'controlled_requires_min_sample_per_arm');
select l11t.ok((select count(*) = 0 from public.experiments) and (select count(*) = 0 from public.evidence_nodes where node_type = 'experiment'), 'rejections_leave_no_rows');

-- usage refusal: the whole creation rolls back (no experiment, node, provenance, audit)
select l11t.entitle('experiments_max', '0'::jsonb);
select l11t.expect_error($q$ select public.create_experiment(l11t.exp('80000000-0000-4000-8000-0000000000aa', '70000000-0000-4000-8000-000000000001', 'before_after'), '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000001')) $q$, 'usage_limit_exceeded', 'usage_refusal_raises');
select l11t.ok(not exists (select 1 from public.experiments where id = '80000000-0000-4000-8000-0000000000aa')
  and not exists (select 1 from public.evidence_nodes where entity_id = '80000000-0000-4000-8000-0000000000aa')
  and not exists (select 1 from public.audit_log where target_id = '80000000-0000-4000-8000-0000000000aa')
  and not exists (select 1 from public.experiment_transitions where experiment_id = '80000000-0000-4000-8000-0000000000aa'), 'usage_refusal_full_rollback_no_compensating_delete');
select l11t.entitle('experiments_max', '100'::jsonb);

select (public.create_experiment(l11t.exp('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'before_after'), '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000001'))).status;
select l11t.ok((select status = 'draft' and registered_at is null and idempotency_key like 'experiment:70000000-0000-4000-8000-000000000001:%' from public.experiments where id = '80000000-0000-4000-8000-000000000001'), 'create_inserts_draft');
select l11t.ok((select count(*) = 1 from public.usage_ledger where idempotency_key = 'experiment_created:80000000-0000-4000-8000-000000000001'), 'usage_consumed_once');
select l11t.ok((select count(*) = 1 from public.evidence_provenance p join public.experiments e on e.evidence_node_id = p.derived_evidence_node_id
  join public.actions a on a.evidence_node_id = p.source_evidence_node_id where e.id = '80000000-0000-4000-8000-000000000001' and a.id = '70000000-0000-4000-8000-000000000001' and p.relation_type = 'derived_from_action'), 'derived_from_action_provenance');
select l11t.ok((select count(*) = 1 from public.audit_log where target_id = '80000000-0000-4000-8000-000000000001' and action = 'experiment.created' and actor_user_id = '10000000-0000-4000-8000-000000000001'), 'create_audited');
select l11t.ok((select count(*) = 1 from public.experiment_transitions where experiment_id = '80000000-0000-4000-8000-000000000001' and from_status is null and to_status = 'draft' and actor_kind = 'user' and actor_user_id = '10000000-0000-4000-8000-000000000001'), 'create_transition_row');
-- replay with a new caller UUID resolves the stored row with no side effects
select l11t.ok((public.create_experiment(l11t.exp('80000000-0000-4000-8000-0000000000ff', '70000000-0000-4000-8000-000000000001', 'before_after'), '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000001'))).id = '80000000-0000-4000-8000-000000000001', 'replay_resolves_by_idempotency_key');
select l11t.ok((select count(*) = 0 from public.evidence_nodes where entity_id = '80000000-0000-4000-8000-0000000000ff')
  and (select count(*) = 1 from public.usage_ledger where idempotency_key like 'experiment_created:%')
  and (select count(*) = 1 from public.audit_log where action = 'experiment.created'), 'replay_no_side_effects');
-- a different plan for the same Action is rejected while one is non-terminal
select l11t.expect_error($q$ select public.create_experiment(l11t.exp('80000000-0000-4000-8000-0000000000fe', '70000000-0000-4000-8000-000000000001', 'before_after', 'plan-b'), '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000001')) $q$, 'experiment_action_rule|23505', 'one_experiment_per_action');
select l11t.ok((select count(*) = 0 from public.evidence_nodes where entity_id = '80000000-0000-4000-8000-0000000000fe'), 'one_per_action_rollback');

-- -------------------------------------------------------------- draft edits / plan freeze
select l11t.expect_error($q$ select public.update_experiment_draft('20000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '{"name":"x","measurement_plan_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}') $q$, 'experiment_not_found', 'draft_edit_cross_workspace_not_found');
select l11t.ok((public.update_experiment_draft('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  jsonb_build_object('name', 'Renamed experiment', 'measurement_plan_fingerprint', repeat('1', 64)))).name = 'Renamed experiment', 'draft_edit_applies');
select l11t.expect_error($q$ select public.update_experiment_draft('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', jsonb_build_object('evidence_design', 'controlled_split', 'measurement_plan_fingerprint', repeat('2', 64))) $q$, 'experiment_design_fixed_at_creation', 'design_fixed_at_creation');
select l11t.expect_error($q$ update public.experiments set idempotency_key = 'x' where id = '80000000-0000-4000-8000-000000000001' $q$, 'experiment_plan_frozen', 'identity_frozen_even_in_draft');

-- -------------------------------------------------------------- before/after baseline
select l11t.expect_error($q$ select public.mark_experiment_ready('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $q$, 'experiment_baseline_required', 'ready_requires_baseline');
select l11t.expect_error($q$ select public.record_experiment_observation(l11t.obs(gen_random_uuid(), '80000000-0000-4000-8000-000000000001', 'baseline', 10, 'bl-wrong', l11t.bl_end() - interval '30 days', l11t.bl_end()), 'user', '10000000-0000-4000-8000-000000000001') $q$, 'observation_window_invalid', 'baseline_window_must_match_plan');
select l11t.expect_error($q$ select public.record_experiment_observation(l11t.obs(gen_random_uuid(), '80000000-0000-4000-8000-000000000001', 'baseline', 10, 'bl-rate', l11t.bl_end() - interval '7 days', l11t.bl_end(), null, 100), 'user', '10000000-0000-4000-8000-000000000001') $q$, 'observation_form_mismatch', 'count_metric_rejects_denominator');
select l11t.expect_error($q$ select public.record_experiment_observation(l11t.obs(gen_random_uuid(), '80000000-0000-4000-8000-000000000001', 'baseline', 10, 'bl-viewer', l11t.bl_end() - interval '7 days', l11t.bl_end()), 'user', '10000000-0000-4000-8000-000000000002') $q$, 'experiment_actor_forbidden', 'viewer_cannot_record_observation');
select l11t.expect_error($q$ select public.record_experiment_observation(l11t.obs(gen_random_uuid(), '80000000-0000-4000-8000-000000000001', 'baseline', 10, 'bl-sys', l11t.bl_end() - interval '7 days', l11t.bl_end()), 'system', null) $q$, 'observation_source_invalid', 'system_cannot_write_manual_metric');
select l11t.ok((public.record_experiment_observation(l11t.obs('81000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 'baseline', 9, 'bl-1', l11t.bl_end() - interval '7 days', l11t.bl_end()), 'user', '10000000-0000-4000-8000-000000000001')).value = 9, 'baseline_recorded');
select l11t.ok((public.record_experiment_observation(l11t.obs('81000000-0000-4000-8000-0000000000ff', '80000000-0000-4000-8000-000000000001', 'baseline', 999, 'bl-1', l11t.bl_end() - interval '7 days', l11t.bl_end()), 'user', '10000000-0000-4000-8000-000000000001')).id = '81000000-0000-4000-8000-000000000001', 'observation_replay_idempotent');
-- correction appends a superseding row; a second correction of the same row is rejected
select l11t.ok((public.record_experiment_observation(l11t.obs('81000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000001', 'baseline', 10, 'bl-2', l11t.bl_end() - interval '7 days', l11t.bl_end(), '81000000-0000-4000-8000-000000000001'), 'user', '10000000-0000-4000-8000-000000000001')).supersedes_observation_id = '81000000-0000-4000-8000-000000000001', 'baseline_correction_supersedes');
select l11t.expect_error($q$ select public.record_experiment_observation(l11t.obs(gen_random_uuid(), '80000000-0000-4000-8000-000000000001', 'baseline', 11, 'bl-3', l11t.bl_end() - interval '7 days', l11t.bl_end(), '81000000-0000-4000-8000-000000000001'), 'user', '10000000-0000-4000-8000-000000000001') $q$, '23505|experiment_observations_supersedes', 'supersession_is_a_chain_not_a_fork');
select l11t.ok((select count(*) = 1 from public.audit_log where action = 'experiment.observation_recorded') and (select count(*) = 1 from public.audit_log where action = 'experiment.observation_corrected'), 'observation_audit');
select l11t.expect_error($q$ update public.experiment_observations set value = 1 where id = '81000000-0000-4000-8000-000000000001' $q$, 'phase7_append_only_record', 'observations_append_only');
select l11t.expect_error($q$ delete from public.experiment_observations where id = '81000000-0000-4000-8000-000000000001' $q$, 'phase7_append_only_record', 'observations_no_delete');

select l11t.ok((public.mark_experiment_ready('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')).status = 'ready', 'ready_with_baseline');
select l11t.ok((select registered_at is not null and baseline_end = l11t.bl_end() and baseline_start = l11t.bl_end() - interval '7 days' from public.experiments where id = '80000000-0000-4000-8000-000000000001'), 'baseline_window_from_registration_day');
select l11t.ok((public.mark_experiment_ready('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')).status = 'ready'
  and (select count(*) = 1 from public.audit_log where action = 'experiment.ready'), 'ready_replay_no_second_audit');
select l11t.expect_error($q$ update public.experiments set name = 'late edit' where id = '80000000-0000-4000-8000-000000000001' $q$, 'experiment_plan_frozen', 'plan_frozen_after_ready');
select l11t.expect_error($q$ update public.experiments set success_criterion = '{"direction":"decrease","measure":"absolute_delta","minimumEffect":1}' where id = '80000000-0000-4000-8000-000000000001' $q$, 'experiment_plan_frozen', 'success_criterion_frozen');
select l11t.expect_error($q$ select public.update_experiment_draft('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', jsonb_build_object('name', 'x', 'measurement_plan_fingerprint', repeat('3', 64))) $q$, 'experiment_not_draft', 'draft_rpc_rejects_ready');
select l11t.expect_error($q$ select public.record_experiment_observation(l11t.obs(gen_random_uuid(), '80000000-0000-4000-8000-000000000001', 'baseline', 12, 'bl-late', l11t.bl_end() - interval '7 days', l11t.bl_end()), 'user', '10000000-0000-4000-8000-000000000001') $q$, 'observation_window_invalid', 'baseline_closed_after_ready');
select l11t.expect_error($q$ select public.issue_experiment_token('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', gen_random_uuid(), 'pk_before_after_token_000001', repeat('c', 64)) $q$, 'experiment_token_not_allowed', 'before_after_gets_no_public_token');

-- -------------------------------------------------------------- start coordination
-- ready + starts allowed -> running with the frozen window
select l11t.ok((l11t.tx('70000000-0000-4000-8000-000000000001', 'approved', 'in_progress', '{}'::jsonb, true)).status = 'in_progress', 'action_start_allowed');
select l11t.ok((select status = 'running' and treatment_started_at is not null and measurement_start = treatment_started_at
  and measurement_end = treatment_started_at + interval '7 days' from public.experiments where id = '80000000-0000-4000-8000-000000000001'), 'ready_experiment_starts_with_window');
select l11t.ok((select count(*) = 1 from public.experiment_transitions where experiment_id = '80000000-0000-4000-8000-000000000001' and from_status = 'ready' and to_status = 'running'
  and actor_kind = 'system' and actor_user_id is null and metadata->>'actionId' = '70000000-0000-4000-8000-000000000001'), 'start_transition_system_actor');
select l11t.expect_error($q$ update public.experiments set status = 'paused' where id = '80000000-0000-4000-8000-000000000001' $q$, 'experiment_pause_not_supported', 'v1_pause_not_supported');
select l11t.expect_error($q$ update public.experiments set measurement_end = measurement_end + interval '1 day' where id = '80000000-0000-4000-8000-000000000001' $q$, 'experiment_plan_frozen', 'window_frozen_once_set');

-- draft at treatment start -> canceled treatment_started_before_registration
select (public.create_experiment(l11t.exp('80000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', 'before_after'), '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000003'))).status;
select (l11t.tx('70000000-0000-4000-8000-000000000003', 'approved', 'in_progress', '{}'::jsonb, true)).status;
select l11t.ok((select status = 'canceled' and closed_reason = 'treatment_started_before_registration' and treatment_started_at is null from public.experiments where id = '80000000-0000-4000-8000-000000000003'), 'draft_at_start_canceled');

-- ready but starts NOT allowed (flag off) -> canceled measurement_disabled_at_treatment; the Action still starts
select (public.create_experiment(l11t.exp('80000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000004', 'before_after'), '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000004'))).status;
select (public.record_experiment_observation(l11t.obs(gen_random_uuid(), '80000000-0000-4000-8000-000000000004', 'baseline', 3, 'bl-4', l11t.bl_end() - interval '7 days', l11t.bl_end()), 'user', '10000000-0000-4000-8000-000000000001')).id is not null;
select (public.mark_experiment_ready('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001')).status;
select l11t.ok((l11t.tx('70000000-0000-4000-8000-000000000004', 'approved', 'in_progress')).status = 'in_progress', 'action_start_default_not_allowed');
select l11t.ok((select status = 'canceled' and closed_reason = 'measurement_disabled_at_treatment' from public.experiments where id = '80000000-0000-4000-8000-000000000004'), 'flag_off_cancels_ready_at_start');

-- Action closed before treatment -> canceled action_closed_before_treatment
select (public.create_experiment(l11t.exp('80000000-0000-4000-8000-000000000005', '70000000-0000-4000-8000-000000000005', 'before_after'), '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000005'))).status;
select (l11t.tx('70000000-0000-4000-8000-000000000005', 'approved', 'dismissed')).status;
select l11t.ok((select status = 'canceled' and closed_reason = 'action_closed_before_treatment' from public.experiments where id = '80000000-0000-4000-8000-000000000005'), 'action_dismissed_cancels_pre_treatment');

-- user cancel before treatment allows a new experiment for the same Action; a system cancel does not
select (public.create_experiment(l11t.exp('80000000-0000-4000-8000-000000000007', '70000000-0000-4000-8000-000000000007', 'before_after'), '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000007'))).status;
select l11t.expect_error($q$ select public.cancel_experiment('20000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000003', null) $q$, 'experiment_not_found', 'cancel_cross_workspace_not_found');
select l11t.ok((public.cancel_experiment('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'wrong plan')).closed_reason = 'canceled_before_treatment', 'user_cancel_before_treatment');
select l11t.ok((public.cancel_experiment('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'again')).status = 'canceled'
  and (select count(*) = 1 from public.audit_log where action = 'experiment.canceled' and target_id = '80000000-0000-4000-8000-000000000007'), 'cancel_replay_no_second_audit');
select l11t.ok((public.create_experiment(l11t.exp('80000000-0000-4000-8000-000000000008', '70000000-0000-4000-8000-000000000007', 'before_after', 'plan-b'), '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000007'))).status = 'draft', 'recreate_after_user_cancel');

-- -------------------------------------------------------------- abandonment
select (public.create_experiment(l11t.exp('80000000-0000-4000-8000-000000000006', '70000000-0000-4000-8000-000000000006', 'before_after'), '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000006'))).status;
select (public.record_experiment_observation(l11t.obs(gen_random_uuid(), '80000000-0000-4000-8000-000000000006', 'baseline', 3, 'bl-6', l11t.bl_end() - interval '7 days', l11t.bl_end()), 'user', '10000000-0000-4000-8000-000000000001')).id is not null;
select (public.mark_experiment_ready('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001')).status;
select (l11t.tx('70000000-0000-4000-8000-000000000006', 'approved', 'in_progress', '{}'::jsonb, true)).status;
select l11t.ok((l11t.tx('70000000-0000-4000-8000-000000000006', 'in_progress', 'dismissed')).status = 'dismissed', 'abandon_action');
select l11t.ok((select status = 'canceled' and closed_reason = 'treatment_abandoned' and invalidation_reason = 'treatment_abandoned' from public.experiments where id = '80000000-0000-4000-8000-000000000006'), 'abandon_invalidates_running_experiment');
select l11t.ok(exists (select 1 from public.experiments_due_for_measurement(now(), 50) where id = '80000000-0000-4000-8000-000000000006'), 'abandoned_is_due_for_invalid_result');
select l11t.ok((public.finalize_experiment_outcome('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000006',
  jsonb_build_object('id', gen_random_uuid(), 'evidence_node_id', gen_random_uuid(), 'outcome', 'invalid', 'attribution_class', 'none', 'treatment_integrity', 'unconfirmed',
    'evidence_completeness', 'missing', 'invalidation_reason', 'treatment_abandoned', 'input_fingerprint', repeat('6', 64)), true, '{}')).outcome = 'invalid', 'abandoned_finalized_invalid');
select l11t.ok((select status = 'canceled' and current_result_id is not null from public.experiments where id = '80000000-0000-4000-8000-000000000006')
  and not exists (select 1 from public.experiments_due_for_measurement(now(), 50) where id = '80000000-0000-4000-8000-000000000006'), 'abandoned_drained_once');
select l11t.expect_error($q$ select public.finalize_experiment_outcome('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000006', jsonb_build_object('id', gen_random_uuid(), 'evidence_node_id', gen_random_uuid(), 'outcome', 'invalid', 'attribution_class', 'none', 'treatment_integrity', 'unconfirmed', 'evidence_completeness', 'missing', 'input_fingerprint', repeat('7', 64)), true, '{}') $q$, 'experiment_results_outcome_v1_check', 'invalid_requires_reason');

-- -------------------------------------------------------------- completion + liveSince
select l11t.expect_error($q$ select l11t.tx('70000000-0000-4000-8000-000000000001', 'in_progress', 'completed', '{}'::jsonb) $q$, 'treatment_live_since_required', 'complete_requires_live_since');
select l11t.expect_error($q$ select l11t.tx('70000000-0000-4000-8000-000000000001', 'in_progress', 'completed', jsonb_build_object('liveSince', now() - interval '1 day')) $q$, 'treatment_live_since_invalid', 'live_since_before_treatment_rejected');
select l11t.expect_error($q$ select l11t.tx('70000000-0000-4000-8000-000000000001', 'in_progress', 'completed', '{"liveSince":"not a date"}'::jsonb) $q$, 'treatment_live_since_required', 'live_since_unparseable_rejected');
select l11t.ok((l11t.tx('70000000-0000-4000-8000-000000000001', 'in_progress', 'completed', jsonb_build_object('liveSince', now()))).status = 'completed', 'complete_with_live_since');
select l11t.ok((select status = 'running' from public.experiments where id = '80000000-0000-4000-8000-000000000001'), 'action_completion_keeps_experiment_collecting');

-- -------------------------------------------------------------- measurement window + outcome
select l11t.expect_error($q$ select public.record_experiment_observation(l11t.obs(gen_random_uuid(), e.id, 'measurement', 18, 'm-early', e.measurement_start, e.measurement_end), 'user', '10000000-0000-4000-8000-000000000001') from public.experiments e where e.id = '80000000-0000-4000-8000-000000000001' $q$, 'observation_window_invalid', 'measurement_before_window_end_rejected');
select l11t.ok(not exists (select 1 from public.experiments_due_for_measurement(now(), 50) where id = '80000000-0000-4000-8000-000000000001'), 'not_due_before_window_end');
select l11t.age('80000000-0000-4000-8000-000000000001', 8);
select l11t.expect_error($q$ select public.record_experiment_observation(l11t.obs(gen_random_uuid(), e.id, 'measurement', 18, 'm-wrong', e.measurement_start + interval '1 day', e.measurement_end), 'user', '10000000-0000-4000-8000-000000000001') from public.experiments e where e.id = '80000000-0000-4000-8000-000000000001' $q$, 'observation_window_invalid', 'measurement_period_must_match_frozen_window');
select l11t.ok((select (public.record_experiment_observation(l11t.obs('81000000-0000-4000-8000-000000000010', e.id, 'measurement', 18, 'm-1', e.measurement_start, e.measurement_end), 'user', '10000000-0000-4000-8000-000000000001')).value = 18
  from public.experiments e where e.id = '80000000-0000-4000-8000-000000000001'), 'measurement_recorded_in_grace');
select l11t.ok(exists (select 1 from public.experiments_due_for_measurement(now(), 50) where id = '80000000-0000-4000-8000-000000000001'), 'due_after_measurement_recorded');
-- internal market context: system-only, never the primary metric
select l11t.ok((public.record_experiment_observation(jsonb_build_object('id', gen_random_uuid(), 'workspace_id', '20000000-0000-4000-8000-000000000001', 'experiment_id', '80000000-0000-4000-8000-000000000001', 'evidence_node_id', gen_random_uuid(),
  'metric_key', 'market_evidence_count', 'window_role', 'measurement', 'period_start', now() - interval '8 days', 'period_end', now() - interval '1 day', 'value', 24, 'source', 'wanterest_internal',
  'idempotency_key', 'ctx-1', 'source_ref', jsonb_build_object('evidenceNodeId', (select evidence_node_id from public.concept_market_states limit 1))), 'system', null)).source = 'wanterest_internal', 'market_context_recorded');
select l11t.ok((select count(*) = 1 from public.evidence_provenance where relation_type = 'context_from'), 'context_from_provenance');
select l11t.expect_error($q$ select public.record_experiment_observation(jsonb_build_object('id', gen_random_uuid(), 'workspace_id', '20000000-0000-4000-8000-000000000001', 'experiment_id', '80000000-0000-4000-8000-000000000001', 'evidence_node_id', gen_random_uuid(), 'metric_key', 'market_evidence_count', 'window_role', 'measurement', 'period_start', now() - interval '8 days', 'period_end', now(), 'value', 1, 'source', 'manual', 'idempotency_key', 'ctx-user'), 'user', '10000000-0000-4000-8000-000000000001') $q$, 'observation_metric_invalid|23514', 'user_cannot_write_market_context');

select l11t.ok((public.finalize_experiment_outcome('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', l11t.result('82000000-0000-4000-8000-000000000001', repeat('a', 64)), true,
  array['81000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000010']::uuid[])).revision = 1, 'finalize_appends_revision_1');
select l11t.ok((select status = 'completed' and closed_reason = 'window_elapsed' and current_result_id = '82000000-0000-4000-8000-000000000001' from public.experiments where id = '80000000-0000-4000-8000-000000000001'), 'finalize_closes_window_elapsed');
select l11t.ok((select count(*) = 1 from public.experiment_transitions where experiment_id = '80000000-0000-4000-8000-000000000001' and to_status = 'completed' and actor_kind = 'system'), 'completion_transition_system');
select l11t.ok((select count(*) = 1 from public.evidence_provenance p join public.experiment_results r on r.evidence_node_id = p.derived_evidence_node_id where r.id = '82000000-0000-4000-8000-000000000001' and p.relation_type = 'measures_experiment')
  and (select count(*) = 2 from public.evidence_provenance p join public.experiment_results r on r.evidence_node_id = p.derived_evidence_node_id where r.id = '82000000-0000-4000-8000-000000000001' and p.relation_type = 'uses_observation'), 'result_provenance');
select l11t.ok((public.finalize_experiment_outcome('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', l11t.result(gen_random_uuid(), repeat('a', 64)), true, '{}')).id = '82000000-0000-4000-8000-000000000001'
  and (select count(*) = 1 from public.experiment_results where experiment_id = '80000000-0000-4000-8000-000000000001'), 'finalize_replay_same_fingerprint');
-- a late correction yields a new revision; history is never overwritten
select l11t.ok((public.finalize_experiment_outcome('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', l11t.result('82000000-0000-4000-8000-000000000002', repeat('b', 64), 'neutral') || '{"effect":2,"observed_value":12}', false, '{}')).revision = 2, 'revision_2_appended');
select l11t.ok((select current_result_id = '82000000-0000-4000-8000-000000000002' from public.experiments where id = '80000000-0000-4000-8000-000000000001')
  and (select outcome = 'positive' from public.experiment_results where id = '82000000-0000-4000-8000-000000000001'), 'history_preserved_pointer_moves');
select l11t.expect_error($q$ update public.experiment_results set outcome = 'negative' where id = '82000000-0000-4000-8000-000000000001' $q$, 'phase7_append_only_record', 'results_append_only');
select l11t.expect_error($q$ select public.finalize_experiment_outcome('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', l11t.result(gen_random_uuid(), repeat('c', 64)) || '{"evidence_completeness":"partial"}', false, '{}') $q$, 'experiment_results_outcome_v1_check', 'directional_outcome_requires_complete_evidence');
select l11t.expect_error($q$ update public.experiment_transitions set reason = 'x' $q$, 'phase7_append_only_record', 'transitions_append_only');
select l11t.expect_error($q$ update public.experiments set status = 'running' where id = '80000000-0000-4000-8000-000000000001' $q$, 'invalid_experiment_transition', 'terminal_is_terminal');

-- -------------------------------------------------------------- controlled split
select (public.create_experiment(l11t.exp('80000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', 'controlled_split'), '10000000-0000-4000-8000-000000000001', (select guard from l11t.guards where action_id = '70000000-0000-4000-8000-000000000002'))).status;
select l11t.expect_error($q$ select public.mark_experiment_ready('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001') $q$, 'experiment_controlled_setup_incomplete', 'controlled_needs_two_arms');
select (public.add_experiment_variant('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
  jsonb_build_object('id', '83000000-0000-4000-8000-000000000001', 'evidence_node_id', gen_random_uuid(), 'variant_key', 'control', 'label', 'Control', 'content', '{}'::jsonb, 'allocation_weight', 5000, 'is_control', true))).id;
select (public.add_experiment_variant('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
  jsonb_build_object('id', '83000000-0000-4000-8000-000000000002', 'evidence_node_id', gen_random_uuid(), 'variant_key', 'treatment', 'label', 'Treatment', 'content', '{}'::jsonb, 'allocation_weight', 5000, 'is_control', false))).id;
select l11t.ok((select count(*) = 2 from public.evidence_provenance where relation_type = 'variant_of_experiment'), 'variant_provenance');
select l11t.ok((public.mark_experiment_ready('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001')).baseline_start is null, 'controlled_ready_without_baseline');
select l11t.expect_error($q$ select public.add_experiment_variant('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', jsonb_build_object('id', gen_random_uuid(), 'evidence_node_id', gen_random_uuid(), 'variant_key', 'late', 'label', 'Late', 'content', '{}'::jsonb, 'allocation_weight', 1)) $q$, 'experiment_variants_locked', 'variants_locked_after_ready');
-- tokens: issue, cross-workspace revoke rejected with no mutation, revoke, replay
select (public.issue_experiment_token('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 'pk_controlled_token_00000001', repeat('d', 64))).status;
select l11t.expect_error($q$ select public.revoke_experiment_token('20000000-0000-4000-8000-000000000002', '84000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003') $q$, 'experiment_token_not_found', 'revoke_cross_workspace_rejected');
select l11t.ok((select status = 'active' from public.experiment_public_tokens where id = '84000000-0000-4000-8000-000000000001'), 'foreign_revoke_did_not_mutate');
select l11t.expect_error($q$ select public.revoke_experiment_token('20000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002') $q$, 'experiment_actor_forbidden', 'viewer_cannot_revoke');

select (l11t.tx('70000000-0000-4000-8000-000000000002', 'approved', 'in_progress', '{}'::jsonb, true)).status;
select l11t.age('80000000-0000-4000-8000-000000000002', 9);
-- assignments: control (a1, a2, a3) and treatment (b1, b2, b3, b4)
insert into public.experiment_assignments (id, workspace_id, experiment_id, variant_id, subject_key_hash)
select ('85000000-0000-4000-8000-00000000000' || n)::uuid, '20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002',
  case when n <= 3 then '83000000-0000-4000-8000-000000000001'::uuid else '83000000-0000-4000-8000-000000000002'::uuid end, repeat(n::text, 64)
from generate_series(1, 7) n;
-- FK integrity: event variant/subject must match its assignment
select l11t.expect_error($q$ insert into public.experiment_events (workspace_id, experiment_id, variant_id, assignment_id, external_event_id, event_type, subject_key_hash, occurred_at)
  values ('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000001', 'bad-variant', 'exposure', repeat('1', 64), now() - interval '5 days') $q$, 'experiment_events_assignment_subject_fkey|23503', 'event_variant_must_match_assignment');
select l11t.expect_error($q$ insert into public.experiment_events (workspace_id, experiment_id, variant_id, assignment_id, external_event_id, event_type, subject_key_hash, occurred_at)
  values ('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'bad-subject', 'exposure', repeat('2', 64), now() - interval '5 days') $q$, 'experiment_events_assignment_subject_fkey|23503', 'event_subject_must_match_assignment');
-- v1 collection guard: events outside the frozen window and writes to a non-running experiment are rejected
select l11t.expect_error($q$ insert into public.experiment_events (workspace_id, experiment_id, variant_id, assignment_id, external_event_id, event_type, subject_key_hash, occurred_at)
  values ('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'too-late', 'exposure', repeat('1', 64), now() - interval '1 day') $q$, 'experiment_event_outside_window', 'event_after_window_rejected');
select l11t.expect_error($q$ insert into public.experiment_events (workspace_id, experiment_id, variant_id, assignment_id, external_event_id, event_type, subject_key_hash, occurred_at)
  values ('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'too-early', 'exposure', repeat('1', 64), now() - interval '10 days') $q$, 'experiment_event_outside_window', 'event_before_treatment_rejected');
create temp table l11_ev (sub int, ev text, at timestamptz);
-- window is [now-9d, now-2d)
insert into l11_ev values
  (1, 'exposure', now() - interval '8 days'), (1, 'signup_completed', now() - interval '7 days'),        -- control converted
  (2, 'exposure', now() - interval '8 days'),                                                         -- control exposed only
  (3, 'signup_completed', now() - interval '8 days'), (3, 'exposure', now() - interval '6 days'),        -- conversion before exposure: not counted
  (4, 'exposure', now() - interval '8 days'), (4, 'signup_completed', now() - interval '7 days'), (4, 'signup_completed', now() - interval '6 days'), -- converted once (subject-level)
  (5, 'exposure', now() - interval '7 days'), (5, 'signup_completed', now() - interval '1 day'),         -- conversion after window end: not counted
  (6, 'exposure', now() - interval '10 days'),                                                        -- exposure before window: excluded
  (7, 'exposure', now() - interval '5 days'), (7, 'signup_completed', now() - interval '4 days');        -- treatment converted
-- Out-of-window rows are loaded with the collection guard off to prove the SQL aggregate excludes them anyway.
alter table public.experiment_events disable trigger experiment_events_v1_collection;
insert into public.experiment_events (workspace_id, experiment_id, variant_id, assignment_id, external_event_id, event_type, subject_key_hash, occurred_at)
select '20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', a.variant_id, a.id, 'ev-' || row_number() over (), l.ev, a.subject_key_hash, l.at
from l11_ev l join public.experiment_assignments a on a.id = ('85000000-0000-4000-8000-00000000000' || l.sub)::uuid;
alter table public.experiment_events enable trigger experiment_events_v1_collection;
select l11t.ok((select exposed = 3 and converted = 1 from public.experiment_arm_counts('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002') where is_control), 'control_arm_exact_counts');
select l11t.ok((select exposed = 3 and converted = 2 and excluded_events = 2 from public.experiment_arm_counts('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002') where not is_control), 'treatment_arm_exact_counts');
select l11t.ok((select window_days = 7 from public.experiment_arm_counts('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002') limit 1), 'window_days_reported');
select l11t.ok((select count(*) = 0 from public.experiment_arm_counts('20000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000002')), 'arm_counts_workspace_scoped');
select l11t.ok(exists (select 1 from public.experiments_due_for_measurement(now(), 50) where id = '80000000-0000-4000-8000-000000000002'), 'controlled_due_one_day_after_window');
select l11t.ok((select count(*) <= 50 from public.experiments_due_for_measurement(now(), 5000)), 'due_limit_capped');
-- running cancel -> stopped_early
select l11t.ok((public.cancel_experiment('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', null)).closed_reason = 'stopped_early', 'running_cancel_is_stopped_early');
select l11t.expect_error($q$ insert into public.experiment_assignments (workspace_id, experiment_id, variant_id, subject_key_hash) values ('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001', repeat('9', 64)) $q$, 'experiment_not_collecting', 'no_assignment_after_close');
select l11t.ok((select actor_kind = 'user' and actor_user_id = '10000000-0000-4000-8000-000000000001' and reason = 'stopped_early' from public.experiment_transitions where experiment_id = '80000000-0000-4000-8000-000000000002' and to_status = 'canceled'), 'user_cancel_transition_actor');
select l11t.ok((public.revoke_experiment_token('20000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')).status = 'revoked', 'revoke_token');
select l11t.ok((public.revoke_experiment_token('20000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')).status = 'revoked'
  and (select count(*) = 1 from public.audit_log where action = 'experiment.public_token_revoked'), 'revoke_replay_no_second_audit');

-- -------------------------------------------------------------- bounds
do $$ begin
  for i in 1..200 loop
    perform public.record_experiment_observation(l11t.obs(gen_random_uuid(), '80000000-0000-4000-8000-000000000008', 'baseline', i, 'cap-' || i, l11t.bl_end() - interval '7 days', l11t.bl_end()), 'user', '10000000-0000-4000-8000-000000000001');
  end loop;
end $$;
select l11t.expect_error($q$ select public.record_experiment_observation(l11t.obs(gen_random_uuid(), '80000000-0000-4000-8000-000000000008', 'baseline', 1, 'cap-201', l11t.bl_end() - interval '7 days', l11t.bl_end()), 'user', '10000000-0000-4000-8000-000000000001') $q$, 'experiment_observation_limit', 'observation_cap_200');
select l11t.ok((public.record_experiment_observation(l11t.obs(gen_random_uuid(), '80000000-0000-4000-8000-000000000008', 'baseline', 1, 'cap-7', l11t.bl_end() - interval '7 days', l11t.bl_end()), 'user', '10000000-0000-4000-8000-000000000001')).value = 7, 'replay_still_resolves_at_cap');

-- -------------------------------------------------------------- legacy rows keep Phase 7 semantics
select l11t.ok((select count(*) = 0 from public.experiments where measurement_policy_version is null), 'no_legacy_rows_fabricated');

-- ----------------------------------- executed as the real roles (security invoker + RLS)
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
select l11t.ok((select count(*) = 0 from public.experiment_observations) and (select count(*) = 0 from public.experiment_transitions), 'rls_outsider_sees_nothing');
select l11t.expect_error($q$ select public.cancel_experiment('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', null) $q$, '42501|permission denied', 'authenticated_cannot_execute_cancel');
select l11t.expect_error($q$ insert into public.experiment_observations (workspace_id, product_id, experiment_id, evidence_node_id, metric_key, window_role, period_start, period_end, value, source, idempotency_key) values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000008', gen_random_uuid(), 'manual_custom', 'baseline', now() - interval '1 day', now(), 1, 'wanterest_internal', 'x') $q$, '42501|permission denied', 'authenticated_cannot_write_observations');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
select l11t.ok((select count(*) > 0 from public.experiment_observations) and (select count(*) > 0 from public.experiment_transitions), 'rls_viewer_member_reads');
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select l11t.ok((public.cancel_experiment('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', null)).status = 'canceled', 'service_role_cancel');
reset role;

select 'ALL_CHECKS_PASSED';
