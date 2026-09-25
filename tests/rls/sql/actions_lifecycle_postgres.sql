-- Layer 10 real-Postgres proof for 20261018000000_actions_lifecycle_v1.sql.
-- Run by tests/rls/actions-lifecycle-postgres.test.ts against a throwaway local
-- database that has every migration applied (never a shared/production DB).
-- Each check prints "OK <name>"; any failure raises and aborts the script.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema if not exists l10t;
grant usage on schema l10t to authenticated, service_role;
-- test helpers only; granted to the roles exercised below
create or replace function l10t.expect_error(p_sql text, p_pattern text, p_name text) returns text language plpgsql as $$
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
create or replace function l10t.ok(p_cond boolean, p_name text) returns text language plpgsql as $$
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
select public.initialize_workspace_entitlements('20000000-0000-4000-8000-000000000001', (select id from public.plan_catalog where plan_code = 'pro' order by version desc limit 1));
select public.initialize_workspace_entitlements('20000000-0000-4000-8000-000000000002', (select id from public.plan_catalog where plan_code = 'free' order by version desc limit 1));
insert into public.products (id, workspace_id, name, slug) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Product One', 'product-one'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Product Two', 'product-two');
insert into public.engine_versions (id, engine_type, version, model) values ('40000000-0000-4000-8000-000000000001', 'action', 'l10-real-pg-test', 'deterministic');

-- concept state helpers (evidence node + row) for (workspace one, product one)
create or replace function l10t.market(p_id uuid, p_cv text, p_key text, p_seq int, p_prev uuid) returns uuid language plpgsql as $$
begin
  insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values (gen_random_uuid(), 'concept_market_state', '20000000-0000-4000-8000-000000000001', 'concept_market_states', p_id);
  insert into public.concept_market_states (id, workspace_id, product_id, evidence_node_id, clustering_version, anchor_concept_key, concept_market_state_policy_version, market_state_engine_version_id, previous_state_id, sequence, input_fingerprint, strength_level, distinct_evidence_count, distinct_source_count, contributing_membership_count, excluded_membership_count, computed_at)
  values (p_id, '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', (select id from public.evidence_nodes where entity_table = 'concept_market_states' and entity_id = p_id), p_cv, p_key, 'concept_market_state_v1', '40000000-0000-4000-8000-000000000001', p_prev, p_seq, repeat('a', 64), 'corroborated', 24, 2, 24, 0, now());
  return p_id;
end;
$$;
create or replace function l10t.gap(p_id uuid, p_market uuid, p_seq int, p_prev uuid) returns uuid language plpgsql as $$
declare v_m public.concept_market_states;
begin
  select * into v_m from public.concept_market_states where id = p_market;
  insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values (gen_random_uuid(), 'concept_gap_state', v_m.workspace_id, 'concept_gap_states', p_id);
  insert into public.concept_gap_states (id, workspace_id, product_id, evidence_node_id, clustering_version, anchor_concept_key, gap_state_policy_version, gap_engine_version_id, market_state_id, product_snapshot_id, previous_state_id, sequence, input_fingerprint, status, share_of_current_demand, positioning_weight, high_intent_share, sample_quality, gap_score, computed_at)
  values (p_id, v_m.workspace_id, v_m.product_id, (select id from public.evidence_nodes where entity_table = 'concept_gap_states' and entity_id = p_id), v_m.clustering_version, v_m.anchor_concept_key, 'concept_gap_state_v1', '40000000-0000-4000-8000-000000000001', p_market, '50000000-0000-4000-8000-000000000001', p_prev, p_seq, repeat('b', 64), 'scored', 0.6, 0.1, 1, 'normal', 0.6, now());
  return p_id;
end;
$$;
create or replace function l10t.drift(p_id uuid, p_market uuid, p_window text, p_seq int, p_prev uuid) returns uuid language plpgsql as $$
declare v_m public.concept_market_states;
begin
  select * into v_m from public.concept_market_states where id = p_market;
  insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values (gen_random_uuid(), 'concept_drift_state', v_m.workspace_id, 'concept_drift_states', p_id);
  insert into public.concept_drift_states (id, workspace_id, product_id, evidence_node_id, clustering_version, anchor_concept_key, drift_state_policy_version, comparability_version, drift_engine_version_id, window_type, market_state_id, previous_state_id, sequence, input_fingerprint, comparable, comparability_reason, computed_at)
  values (p_id, v_m.workspace_id, v_m.product_id, (select id from public.evidence_nodes where entity_table = 'concept_drift_states' and entity_id = p_id), v_m.clustering_version, v_m.anchor_concept_key, 'concept_drift_state_v1', 'drift_comparability_v1', '40000000-0000-4000-8000-000000000001', p_window, p_market, p_prev, p_seq, repeat('c', 64), false, 'insufficient_history', now());
  return p_id;
end;
$$;
-- A concept-Action payload for one basis gap state.
create or replace function l10t.payload(p_id uuid, p_key text, p_gap uuid, p_concept text, p_cv text, p_type text default 'concept_gap', p_fp text default repeat('d', 64)) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'workspace_id', '20000000-0000-4000-8000-000000000001', 'product_id', '30000000-0000-4000-8000-000000000001',
    'evidence_node_id', gen_random_uuid(), 'action_type', 'messaging_change', 'trigger_type', p_type, 'trigger_id', p_gap,
    'trigger_evidence_node_id', (select id from public.evidence_nodes where entity_id = p_gap),
    'trigger_concept_key', p_concept, 'trigger_clustering_version', p_cv, 'proposal_fingerprint', p_fp,
    'target_key', 'homepage_hero', 'title', 'Test title', 'summary', 'Test summary', 'why', 'Test why', 'suggested_change', 'Test change',
    'priority_score', 0.5, 'confidence', 0.5, 'action_engine_version_id', '40000000-0000-4000-8000-000000000001',
    'priority_formula_version', 'action-priority-v1', 'input_fingerprint', encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), 'idempotency_key', p_key)
$$;

insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('51000000-0000-4000-8000-000000000001', 'product_snapshot', '20000000-0000-4000-8000-000000000001', 'product_snapshots', '50000000-0000-4000-8000-000000000001');
insert into public.product_snapshots (id, workspace_id, product_id, evidence_node_id, snapshot_version, page_type, raw_text, normalized_text, content_hash)
values ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 1, 'manual', 'x', 'x', repeat('a', 64));

select l10t.market('60000000-0000-4000-8000-000000000001', 'demand_clustering_v1', 'pricing', 1, null);
select l10t.gap('61000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 1, null);
select l10t.drift('62000000-0000-4000-8000-000000000007', '60000000-0000-4000-8000-000000000001', '7d', 1, null);
select l10t.drift('62000000-0000-4000-8000-000000000030', '60000000-0000-4000-8000-000000000001', '30d', 1, null);
select l10t.drift('62000000-0000-4000-8000-000000000090', '60000000-0000-4000-8000-000000000001', '90d', 1, null);
-- same anchor under another clustering version
select l10t.market('60000000-0000-4000-8000-000000000002', 'demand_clustering_v2', 'pricing', 1, null);
select l10t.gap('61000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 1, null);
-- second concept for supersession / concurrency
select l10t.market('60000000-0000-4000-8000-000000000003', 'demand_clustering_v1', 'api_access', 1, null);
select l10t.gap('61000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000003', 1, null);
select l10t.gap('61000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000003', 2, '61000000-0000-4000-8000-000000000003');

-- ------------------------------------------------------ privileges (grants)
select l10t.ok(not has_function_privilege('anon', 'public.create_concept_action(jsonb, uuid, text, jsonb, numeric, jsonb, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_concept_action(jsonb, uuid, text, jsonb, numeric, jsonb, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.concept_latest_market_states(uuid, uuid, text, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.concept_latest_drift_states(uuid, uuid, text, text, text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.assert_concept_action_basis_guard(uuid, uuid, text, text, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.create_concept_action(jsonb, uuid, text, jsonb, numeric, jsonb, text)', 'execute')
  and has_function_privilege('service_role', 'public.transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text)', 'execute')
  and has_function_privilege('service_role', 'public.concept_latest_gap_states(uuid, uuid, text, text, integer)', 'execute'), 'rpc_grants_service_role_only');

-- ------------------------------------------------------- schema constraints
select l10t.ok((select count(*) = 1 from pg_indexes where indexname = 'actions_one_open_concept_action' and indexdef like '%(workspace_id, product_id, trigger_clustering_version, trigger_concept_key)%' and indexdef not like '%trigger_type,%'), 'one_open_index_shape');

select l10t.expect_error($q$ select public.create_concept_action(l10t.payload(gen_random_uuid(), 'k-null-cv', '61000000-0000-4000-8000-000000000001', 'pricing', null)) $q$, 'actions_concept_identity_check|invalid_concept_action_payload|23514', 'concept_requires_clustering_version');
select l10t.expect_error($q$ select public.create_concept_action(l10t.payload(gen_random_uuid(), 'k-bad-fp', '61000000-0000-4000-8000-000000000001', 'pricing', 'demand_clustering_v1', 'concept_gap', 'nothex')) $q$, 'actions_concept_identity_check', 'concept_requires_valid_fingerprint');
select l10t.expect_error($q$ select public.create_concept_action(l10t.payload(gen_random_uuid(), 'k-cv-mismatch', '61000000-0000-4000-8000-000000000001', 'pricing', 'demand_clustering_v2')) $q$, 'action_concept_identity_mismatch', 'clustering_version_mismatch_rejected');
select l10t.expect_error($q$ select public.create_concept_action(l10t.payload(gen_random_uuid(), 'k-anchor-mismatch', '61000000-0000-4000-8000-000000000001', 'reporting', 'demand_clustering_v1')) $q$, 'action_concept_identity_mismatch', 'anchor_mismatch_rejected');
-- The BEFORE trigger would reject the (deliberately mismatched) legacy basis first; disable it inside the
-- rolled-back sub-transaction so the CHECK constraint itself is what is exercised.
select l10t.expect_error($q$
  alter table public.actions disable trigger actions_validate_trigger;
  insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('70000000-0000-4000-8000-0000000000aa', 'action', '20000000-0000-4000-8000-000000000001', 'actions', '70000000-0000-4000-8000-0000000000ab');
  insert into public.actions (id, workspace_id, product_id, evidence_node_id, action_type, trigger_type, trigger_id, trigger_evidence_node_id, trigger_concept_key, trigger_clustering_version, target_key, title, summary, why, suggested_change, priority_score, confidence, action_engine_version_id, priority_formula_version, input_fingerprint, idempotency_key)
  values ('70000000-0000-4000-8000-0000000000ab', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-0000000000aa', 'messaging_change', 'demand_gap', '61000000-0000-4000-8000-000000000001', (select id from public.evidence_nodes where entity_id = '61000000-0000-4000-8000-000000000001'), 'pricing', 'demand_clustering_v1', 'homepage_hero', 't', 's', 'w', 'c', 0.5, 0.5, '40000000-0000-4000-8000-000000000001', 'v', repeat('e', 64), 'legacy-with-cv')
$q$, 'actions_concept_identity_check', 'legacy_must_not_carry_concept_fields');

-- --------------------------------------------- creation, replay, one-open slot
create temp table l10_ids (name text primary key, id uuid);
insert into l10_ids select 'v1', (public.create_concept_action(l10t.payload('71000000-0000-4000-8000-000000000001', 'action:pricing:v1', '61000000-0000-4000-8000-000000000001', 'pricing', 'demand_clustering_v1'))).id;
select l10t.ok((select id from l10_ids where name = 'v1') = '71000000-0000-4000-8000-000000000001', 'create_concept_action_inserts');
select l10t.ok((select count(*) = 1 from public.usage_ledger where idempotency_key = 'action_generated:71000000-0000-4000-8000-000000000001'), 'usage_consumed_once');
select l10t.ok((select count(*) = 1 from public.evidence_provenance p join public.actions a on a.evidence_node_id = p.derived_evidence_node_id where a.id = '71000000-0000-4000-8000-000000000001' and p.relation_type = 'triggered_by'), 'triggered_by_provenance');
-- Retry with a DIFFERENT caller UUID and evidence node: resolves the stored row; no orphan node, no second usage row.
select l10t.ok((public.create_concept_action(l10t.payload('71000000-0000-4000-8000-0000000000ff', 'action:pricing:v1', '61000000-0000-4000-8000-000000000001', 'pricing', 'demand_clustering_v1'))).id = '71000000-0000-4000-8000-000000000001', 'replay_resolves_by_idempotency_key');
select l10t.ok((select count(*) = 0 from public.evidence_nodes where entity_table = 'actions' and entity_id = '71000000-0000-4000-8000-0000000000ff')
  and (select count(*) = 1 from public.usage_ledger where idempotency_key like 'action_generated:71000000-0000-4000-8000-0000000000%'), 'replay_no_orphan_node_no_double_usage');
-- Same anchor under a different clustering version is a different concept slot.
select l10t.ok((public.create_concept_action(l10t.payload('71000000-0000-4000-8000-000000000002', 'action:pricing:v2', '61000000-0000-4000-8000-000000000002', 'pricing', 'demand_clustering_v2'))).status = 'proposed', 'same_anchor_other_clustering_version_allowed');
-- A second open Action for the same canonical concept (cross-type slot) is rejected with full rollback.
select l10t.expect_error($q$ select public.create_concept_action(l10t.payload('71000000-0000-4000-8000-000000000003', 'action:pricing:other', '62000000-0000-4000-8000-000000000007', 'pricing', 'demand_clustering_v1', 'concept_drift')) $q$, '23505|actions_one_open_concept_action', 'one_open_slot_cross_type');
select l10t.ok((select count(*) = 0 from public.evidence_nodes where entity_table = 'actions' and entity_id = '71000000-0000-4000-8000-000000000003'), 'one_open_violation_rolls_back_node');
-- Generated fields are immutable, incl. the new ones.
select l10t.expect_error($q$ update public.actions set proposal_fingerprint = repeat('f', 64) where id = '71000000-0000-4000-8000-000000000001' $q$, 'phase5_action_generated_fields_are_immutable', 'proposal_fingerprint_immutable');
select l10t.expect_error($q$ update public.actions set trigger_clustering_version = 'demand_clustering_v9' where id = '71000000-0000-4000-8000-000000000001' $q$, 'immutable|action_concept_identity_mismatch', 'clustering_version_immutable');

-- ------------------------------------------------ bounded latest-state reads
select l10t.ok((select count(*) = 2 from public.concept_latest_market_states('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'demand_clustering_v1', 'concept_market_state_v1', 500)), 'latest_market_states_one_per_concept');
select l10t.ok((select array_agg(id order by anchor_concept_key) = array['61000000-0000-4000-8000-000000000004'::uuid, '61000000-0000-4000-8000-000000000001'::uuid] from public.concept_latest_gap_states('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'demand_clustering_v1', 'concept_gap_state_v1', 500)), 'latest_gap_states_latest_sequence');
select l10t.ok((select count(*) = 1 from public.concept_latest_market_states('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'demand_clustering_v1', 'concept_market_state_v1', 1)), 'latest_states_db_limit');
select l10t.ok((select count(*) = 1 from public.concept_latest_drift_states('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'demand_clustering_v1', 'concept_drift_state_v1', '7d', 99999)), 'latest_drift_states_capped_param');

-- ----------------------------------------------------------- transitions
-- basis guard: correct guard approves; stale guard fails with no transition
create temp table l10_guard as select jsonb_build_object(
  'marketStatePolicyVersion', 'concept_market_state_v1', 'marketStateId', '60000000-0000-4000-8000-000000000001',
  'gapStatePolicyVersion', 'concept_gap_state_v1', 'gapStateId', '61000000-0000-4000-8000-000000000001',
  'driftStatePolicyVersion', 'concept_drift_state_v1', 'driftStateIds', jsonb_build_object('7d', '62000000-0000-4000-8000-000000000007', '30d', '62000000-0000-4000-8000-000000000030', '90d', '62000000-0000-4000-8000-000000000090')) as guard;
select l10t.expect_error($q$ select public.transition_action('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'proposed', 'approved', 'user', '10000000-0000-4000-8000-000000000001', '{}'::jsonb, null) $q$, 'action_basis_guard_required', 'approve_requires_guard');
select l10t.expect_error($q$ select public.transition_action('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'proposed', 'approved', 'user', '10000000-0000-4000-8000-000000000001', '{}'::jsonb, (select guard || jsonb_build_object('gapStateId', '61000000-0000-4000-8000-000000000003') from l10_guard)) $q$, 'action_basis_changed', 'stale_guard_rejected');
select l10t.expect_error($q$ select public.transition_action('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'proposed', 'approved', 'user', '10000000-0000-4000-8000-000000000002', '{}'::jsonb, (select guard from l10_guard)) $q$, 'action_actor_forbidden', 'viewer_cannot_transition');
select l10t.expect_error($q$ select public.transition_action('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'proposed', 'approved', 'user', '10000000-0000-4000-8000-000000000003', '{}'::jsonb, (select guard from l10_guard)) $q$, 'action_actor_forbidden', 'non_member_cannot_transition');
select l10t.expect_error($q$ select public.transition_action('20000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', 'proposed', 'dismissed', 'user', '10000000-0000-4000-8000-000000000003', '{}'::jsonb, null) $q$, 'action_not_found', 'cross_workspace_action_id_not_found');
select l10t.expect_error($q$ select public.transition_action('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'proposed', 'expired', 'user', '10000000-0000-4000-8000-000000000001', '{}'::jsonb, null) $q$, 'action_transition_system_only', 'expired_is_system_only');
select l10t.expect_error($q$ select public.transition_action('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'proposed', 'superseded', 'system', null, '{}'::jsonb, null) $q$, 'action_transition_invalid', 'concept_supersede_only_via_create');
select l10t.expect_error($q$ select public.transition_action('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'approved', 'in_progress', 'user', '10000000-0000-4000-8000-000000000001', '{}'::jsonb, (select guard from l10_guard)) $q$, 'action_status_conflict', 'compare_and_set_from_status');
select l10t.ok((public.transition_action('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'proposed', 'approved', 'user', '10000000-0000-4000-8000-000000000001', '{"executionMode":"manual"}'::jsonb, (select guard from l10_guard))).status = 'approved', 'member_approves_with_current_guard');
select l10t.ok((select count(*) = 1 from public.action_events where action_id = '71000000-0000-4000-8000-000000000001' and event_type = 'approved' and actor_kind = 'user')
  and (select count(*) = 1 from public.audit_log where target_id = '71000000-0000-4000-8000-000000000001' and action = 'action.approved'), 'event_and_audit_written_together');
select l10t.ok((public.transition_action('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'approved', 'in_progress', 'user', '10000000-0000-4000-8000-000000000001', '{}'::jsonb, (select guard from l10_guard))).status = 'in_progress', 'start_with_current_guard');
select l10t.expect_error($q$ select public.transition_action('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'in_progress', 'expired', 'system', null, '{}'::jsonb, null) $q$, 'action_transition_invalid', 'in_progress_never_expires');
select l10t.ok((public.transition_action('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'in_progress', 'completed', 'user', '10000000-0000-4000-8000-000000000001', '{"note":"done","executionMode":"manual"}'::jsonb, null)).completed_at is not null, 'complete_without_guard');
-- System expiry sets stale_at.
select l10t.ok((public.transition_action('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'proposed', 'expired', 'system', null, '{"reason":"no_eligible_basis"}'::jsonb, null)).stale_at is not null, 'system_expiry_sets_stale_at');
select l10t.ok((select count(*) = 1 from public.action_events where action_id = '71000000-0000-4000-8000-000000000002' and event_type = 'expired' and actor_kind = 'system'), 'expired_event_recorded');

-- --------------------------------------------------------- atomic supersession
insert into l10_ids select 'old', (public.create_concept_action(l10t.payload('72000000-0000-4000-8000-000000000001', 'action:api:old', '61000000-0000-4000-8000-000000000003', 'api_access', 'demand_clustering_v1'))).id;
-- usage refusal rolls back everything: flip the workspace to a plan without actions, attempt supersession.
update public.workspace_entitlements set effective_to = now() where workspace_id = '20000000-0000-4000-8000-000000000001' and capability_key = 'actions_enabled' and effective_to is null;
insert into public.workspace_entitlements (workspace_id, plan_catalog_id, capability_key, value_type, value_json, revision, effective_from)
select workspace_id, plan_catalog_id, capability_key, value_type, 'false'::jsonb, revision + 1, now() from public.workspace_entitlements where workspace_id = '20000000-0000-4000-8000-000000000001' and capability_key = 'actions_enabled' order by revision desc limit 1;
select l10t.expect_error($q$ select public.create_concept_action(l10t.payload('72000000-0000-4000-8000-000000000002', 'action:api:new', '61000000-0000-4000-8000-000000000004', 'api_access', 'demand_clustering_v1', 'concept_gap', repeat('9', 64)), '72000000-0000-4000-8000-000000000001', 'proposed') $q$, 'usage_capability_disabled', 'usage_refusal_raises');
select l10t.ok((select status = 'proposed' and superseded_by_action_id is null from public.actions where id = '72000000-0000-4000-8000-000000000001')
  and not exists (select 1 from public.actions where id = '72000000-0000-4000-8000-000000000002')
  and not exists (select 1 from public.evidence_nodes where entity_table = 'actions' and entity_id = '72000000-0000-4000-8000-000000000002'), 'usage_refusal_full_rollback');
update public.workspace_entitlements set effective_to = now() where workspace_id = '20000000-0000-4000-8000-000000000001' and capability_key = 'actions_enabled' and effective_to is null;
insert into public.workspace_entitlements (workspace_id, plan_catalog_id, capability_key, value_type, value_json, revision, effective_from)
select workspace_id, plan_catalog_id, capability_key, value_type, 'true'::jsonb, revision + 1, now() from public.workspace_entitlements where workspace_id = '20000000-0000-4000-8000-000000000001' and capability_key = 'actions_enabled' order by revision desc limit 1;
-- stale expected status
select l10t.expect_error($q$ select public.create_concept_action(l10t.payload('72000000-0000-4000-8000-000000000002', 'action:api:new', '61000000-0000-4000-8000-000000000004', 'api_access', 'demand_clustering_v1', 'concept_gap', repeat('9', 64)), '72000000-0000-4000-8000-000000000001', 'approved') $q$, 'action_status_conflict', 'supersede_compare_and_set');
-- stale basis guard
select l10t.expect_error($q$ select public.create_concept_action(l10t.payload('72000000-0000-4000-8000-000000000002', 'action:api:new', '61000000-0000-4000-8000-000000000004', 'api_access', 'demand_clustering_v1', 'concept_gap', repeat('9', 64)), '72000000-0000-4000-8000-000000000001', 'proposed',
  jsonb_build_object('marketStatePolicyVersion', 'concept_market_state_v1', 'marketStateId', '60000000-0000-4000-8000-000000000003', 'gapStatePolicyVersion', 'concept_gap_state_v1', 'gapStateId', '61000000-0000-4000-8000-000000000003', 'driftStatePolicyVersion', 'concept_drift_state_v1', 'driftStateIds', '{}'::jsonb)) $q$, 'action_basis_changed', 'supersede_basis_guard');
-- successful supersession, then replay with a new caller UUID
insert into l10_ids select 'new', (public.create_concept_action(l10t.payload('72000000-0000-4000-8000-000000000002', 'action:api:new', '61000000-0000-4000-8000-000000000004', 'api_access', 'demand_clustering_v1', 'concept_gap', repeat('9', 64)), '72000000-0000-4000-8000-000000000001', 'proposed',
  jsonb_build_object('marketStatePolicyVersion', 'concept_market_state_v1', 'marketStateId', '60000000-0000-4000-8000-000000000003', 'gapStatePolicyVersion', 'concept_gap_state_v1', 'gapStateId', '61000000-0000-4000-8000-000000000004', 'driftStatePolicyVersion', 'concept_drift_state_v1', 'driftStateIds', '{}'::jsonb))).id;
select l10t.ok((select status = 'superseded' and superseded_by_action_id = '72000000-0000-4000-8000-000000000002' and stale_at is not null from public.actions where id = '72000000-0000-4000-8000-000000000001'), 'atomic_supersession');
select l10t.ok((select count(*) = 1 from public.evidence_provenance p join public.actions a on a.evidence_node_id = p.derived_evidence_node_id where a.id = '72000000-0000-4000-8000-000000000002' and p.relation_type = 'supersedes_action'), 'supersedes_action_provenance');
select l10t.ok((public.create_concept_action(l10t.payload('72000000-0000-4000-8000-0000000000ee', 'action:api:new', '61000000-0000-4000-8000-000000000004', 'api_access', 'demand_clustering_v1', 'concept_gap', repeat('9', 64)), '72000000-0000-4000-8000-000000000001', 'proposed')).id = '72000000-0000-4000-8000-000000000002', 'supersession_replay_new_uuid_resolves');
select l10t.ok((select count(*) = 1 from public.usage_ledger where idempotency_key = 'action_generated:72000000-0000-4000-8000-000000000002')
  and (select count(*) = 0 from public.evidence_nodes where entity_table = 'actions' and entity_id = '72000000-0000-4000-8000-0000000000ee'), 'supersession_replay_no_side_effects');
select l10t.ok((select count(*) = 1 from public.actions where trigger_concept_key = 'api_access' and status in ('proposed', 'approved', 'in_progress')), 'exactly_one_open_after_supersession');

-- ----------------------------------- executed as the real roles (security invoker)
select l10t.gap('61000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000003', 3, '61000000-0000-4000-8000-000000000004');
set role authenticated;
select l10t.expect_error($q$ select public.create_concept_action(l10t.payload(gen_random_uuid(), 'k-auth', '61000000-0000-4000-8000-000000000005', 'api_access', 'demand_clustering_v1')) $q$, '42501|permission denied', 'authenticated_cannot_execute_create');
select l10t.expect_error($q$ select public.transition_action('20000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', 'proposed', 'dismissed', 'user', '10000000-0000-4000-8000-000000000001', '{}'::jsonb, null) $q$, '42501|permission denied', 'authenticated_cannot_execute_transition');
select l10t.expect_error($q$ select * from public.concept_latest_market_states('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'demand_clustering_v1', 'concept_market_state_v1', 500) $q$, '42501|permission denied', 'authenticated_cannot_read_latest_states');
reset role;
set role service_role;
select l10t.ok((select count(*) = 2 from public.concept_latest_market_states('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'demand_clustering_v1', 'concept_market_state_v1', 500)), 'service_role_reads_latest_states');
select l10t.ok((public.transition_action('20000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', 'proposed', 'dismissed', 'user', '10000000-0000-4000-8000-000000000001', '{"note":"not now"}'::jsonb, null)).status = 'dismissed', 'service_role_transition_with_audit');
select l10t.ok((public.create_concept_action(l10t.payload('73000000-0000-4000-8000-000000000001', 'action:api:svc', '61000000-0000-4000-8000-000000000005', 'api_access', 'demand_clustering_v1', 'concept_gap', repeat('8', 64)))).status = 'proposed', 'service_role_create_with_usage');
reset role;

select 'ALL_CHECKS_PASSED';
