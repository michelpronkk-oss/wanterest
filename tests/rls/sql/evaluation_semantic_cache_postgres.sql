-- 12A.3A.1 Amendment III (evaluation_semantic_cache_v2) real-Postgres proof.
-- Run by tests/rls/evaluation-semantic-cache-postgres.test.ts against a throwaway
-- local database that has every migration applied (never a shared/production DB).
-- Proves, directly against the actual schema, the two guarantees the fingerprint
-- redesign relies on rather than introducing itself: (1) the existing
-- unique (product_match_id, match_engine_version_id, input_fingerprint) constraint
-- on product_match_evaluations already makes concurrent identical-fingerprint
-- inserts race-safe with no new locking, and (2) the existing
-- prevent_phase3_history_mutation trigger already makes product_match_evaluations
-- physically immutable, so a cache miss can only ever mean "insert a new row and
-- move product_matches.current_match_evaluation_id" - never rewrite history.
-- Each check prints "OK <name>"; any failure raises and aborts the script.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema if not exists l12ct;
grant usage on schema l12ct to authenticated, service_role;
create or replace function l12ct.expect_error(p_sql text, p_pattern text, p_name text) returns text language plpgsql as $$
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
create or replace function l12ct.ok(p_cond boolean, p_name text) returns text language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'check % failed', p_name; end if;
  return 'OK ' || p_name;
end;
$$;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values ('10000000-0000-4000-8000-000000000001', 'owner@example.test');
insert into public.workspaces (id, name, slug, created_by) values ('20000000-0000-4000-8000-000000000001', 'Cache Test Workspace', 'cache-test-workspace', '10000000-0000-4000-8000-000000000001');
insert into public.products (id, workspace_id, name, slug) values ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Cache Test Product', 'cache-test-product');

insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000001', 'source_item', '20000000-0000-4000-8000-000000000001', 'source_items', '41000000-0000-4000-8000-000000000001');
insert into public.raw_source_items (id, evidence_node_id, source_key, external_id, fetched_at, payload_json, payload_hash) values ('42000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'fixture', 'cache-test-raw-1', now(), '{}'::jsonb, repeat('a', 64));
insert into public.source_items (id, evidence_node_id, source_key, external_id, body, captured_at, content_hash, latest_raw_source_item_id, normalization_version) values ('41000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'fixture', 'cache-test-source-1', 'I need a workflow tool because manual reporting is slow.', now(), repeat('b', 64), '42000000-0000-4000-8000-000000000001', 'fixture-v1');

insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000002', 'conversation', '20000000-0000-4000-8000-000000000001', 'conversations', '43000000-0000-4000-8000-000000000001');
insert into public.conversations (id, evidence_node_id, conversation_key, primary_source_item_id, body, captured_at, content_hash, canonicalization_version) values ('43000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'fixture:cache-test:1', '41000000-0000-4000-8000-000000000001', 'I need a workflow tool because manual reporting is slow.', now(), repeat('c', 64), 'fixture-v1');

insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000003', 'demand_profile', '20000000-0000-4000-8000-000000000001', 'demand_profiles', '44000000-0000-4000-8000-000000000001');
insert into public.engine_versions (id, engine_type, version, model) values ('45000000-0000-4000-8000-000000000001', 'profile', 'l12ct-profile-v1', 'deterministic');
insert into public.demand_profiles (id, workspace_id, product_id, evidence_node_id, profile_version, confidence, engine_version_id) values ('44000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 1, 0.9, '45000000-0000-4000-8000-000000000001');

insert into public.engine_versions (id, engine_type, version, model) values ('45000000-0000-4000-8000-000000000002', 'classifier', 'l12ct-analysis-v1', 'deterministic');
insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000004', 'conversation_analysis', '20000000-0000-4000-8000-000000000001', 'conversation_analysis', '46000000-0000-4000-8000-000000000001');
insert into public.conversation_analysis (id, conversation_id, evidence_node_id, engine_version_id, input_fingerprint, intent_type, specificity, confidence) values ('46000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004', '45000000-0000-4000-8000-000000000002', repeat('d', 64), 'high_intent', 0.8, 0.9);

insert into public.engine_versions (id, engine_type, version, model) values ('45000000-0000-4000-8000-000000000003', 'matcher', 'l12ct-matcher-v1', 'deterministic');
insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000005', 'match', '20000000-0000-4000-8000-000000000001', 'product_matches', '47000000-0000-4000-8000-000000000001');
insert into public.product_matches (id, workspace_id, product_id, conversation_id, evidence_node_id) values ('47000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005');

select set_config('request.jwt.claim.role', 'service_role', false);

-- ---------------------------------------------------------------- checks
-- 1) A first evaluation under fingerprint F1 ("the old, pre-hotfix failed row") persists cleanly.
insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000006', 'match_evaluation', '20000000-0000-4000-8000-000000000001', 'product_match_evaluations', '48000000-0000-4000-8000-000000000001');
insert into public.product_match_evaluations (id, workspace_id, product_match_id, product_id, conversation_id, demand_profile_id, conversation_analysis_id, match_engine_version_id, evidence_node_id, input_fingerprint, match_confidence, rationale, evidence, decision) values ('48000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000006', repeat('1', 64), 0.5, 'Old failed fallback (fingerprint F1).', '{"qualification": {"diagnostics": {"failed": true}}}'::jsonb, 'rejected');
update public.product_matches set current_match_evaluation_id = '48000000-0000-4000-8000-000000000001' where id = '47000000-0000-4000-8000-000000000001';
select l12ct.ok((select count(*) from public.product_match_evaluations where product_match_id = '47000000-0000-4000-8000-000000000001') = 1, 'first_evaluation_persisted');

-- 2) A duplicate insert reusing the EXACT SAME (product_match_id, match_engine_version_id, input_fingerprint)
--    tuple - simulating a second worker computing the identical fingerprint - is rejected by the DB itself
--    with a unique-violation (23505), independent of any application-level cache check.
insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000007', 'match_evaluation', '20000000-0000-4000-8000-000000000001', 'product_match_evaluations', '48000000-0000-4000-8000-000000000002');
select l12ct.expect_error(
  $sql$ insert into public.product_match_evaluations (id, workspace_id, product_match_id, product_id, conversation_id, demand_profile_id, conversation_analysis_id, match_engine_version_id, evidence_node_id, input_fingerprint, match_confidence, rationale, evidence, decision) values ('48000000-0000-4000-8000-000000000099', '20000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000007', repeat('1', 64), 0.5, 'Duplicate fingerprint attempt.', '{}'::jsonb, 'rejected'); $sql$,
  '23505', 'duplicate_fingerprint_rejected_by_unique_constraint'
);

-- 3) A DIFFERENT fingerprint F2 ("the fresh, post-hotfix successful qualification") for the SAME
--    product_match/engine_version inserts as a brand new row - the old F1 row is untouched.
insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000008', 'match_evaluation', '20000000-0000-4000-8000-000000000001', 'product_match_evaluations', '48000000-0000-4000-8000-000000000003');
insert into public.product_match_evaluations (id, workspace_id, product_match_id, product_id, conversation_id, demand_profile_id, conversation_analysis_id, match_engine_version_id, evidence_node_id, input_fingerprint, match_confidence, rationale, evidence, decision) values ('48000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000008', repeat('2', 64), 0.9, 'Fresh successful evaluation (fingerprint F2).', '{"qualification": {"diagnostics": {"failed": false}}}'::jsonb, 'qualified');
select l12ct.ok((select count(*) from public.product_match_evaluations where product_match_id = '47000000-0000-4000-8000-000000000001') = 2, 'second_distinct_fingerprint_coexists_with_first');
select l12ct.ok((select evidence->'qualification'->'diagnostics'->>'failed' from public.product_match_evaluations where id = '48000000-0000-4000-8000-000000000001') = 'true', 'old_failed_row_untouched');

-- 4) The current-pointer mechanism (product_matches.current_match_evaluation_id) is mutable and moves
--    to the new row - this is the ONLY thing that changes; product_match_evaluations itself never does.
update public.product_matches set current_match_evaluation_id = '48000000-0000-4000-8000-000000000003' where id = '47000000-0000-4000-8000-000000000001';
select l12ct.ok((select current_match_evaluation_id from public.product_matches where id = '47000000-0000-4000-8000-000000000001') = '48000000-0000-4000-8000-000000000003', 'current_pointer_advanced_to_new_row');

-- 5) product_match_evaluations is physically immutable: neither an UPDATE nor a DELETE on the OLD
--    (failed) row is possible, even now that a newer row exists and the pointer has moved past it.
select l12ct.expect_error($sql$ update public.product_match_evaluations set decision = 'qualified' where id = '48000000-0000-4000-8000-000000000001'; $sql$, 'phase3_history_is_immutable', 'old_row_update_blocked');
select l12ct.expect_error($sql$ delete from public.product_match_evaluations where id = '48000000-0000-4000-8000-000000000001'; $sql$, 'phase3_history_is_immutable', 'old_row_delete_blocked');
select l12ct.ok((select count(*) from public.product_match_evaluations where product_match_id = '47000000-0000-4000-8000-000000000001') = 2, 'both_rows_still_present_after_blocked_mutation_attempts');

select 'ALL_CHECKS_PASSED';
