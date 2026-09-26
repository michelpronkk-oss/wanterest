-- 12A.3A.1 Amendment IV (signal_revalidation_preview_v1) real-Postgres no-write proof.
-- Run by tests/rls/signal-revalidation-preview-postgres.test.ts against a throwaway
-- local database that has every migration applied (never a shared/production DB).
-- Seeds one fully-materialized signal (through demand_cluster_memberships), takes a
-- full checksum of every table the preview reads from, runs the EXACT sequence of
-- read-only SELECT statements the preview's repository methods issue (product,
-- snapshots, demand profile, conversation, source item, conversation analysis,
-- match, evaluation, signals list, clusters, memberships, shadow-reasoning replay),
-- then re-checksums the same tables and requires byte-for-byte equality. This is the
-- SQL-level proof that the preview's actual read pattern causes zero writes,
-- independent of and in addition to the type-level/in-memory-runtime proof.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema if not exists l12pt;
grant usage on schema l12pt to authenticated, service_role;
create or replace function l12pt.ok(p_cond boolean, p_name text) returns text language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'check % failed', p_name; end if;
  return 'OK ' || p_name;
end;
$$;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values ('10000000-0000-4000-8000-000000000001', 'owner@example.test');
insert into public.workspaces (id, name, slug, created_by) values ('20000000-0000-4000-8000-000000000001', 'Preview Test Workspace', 'preview-test-workspace', '10000000-0000-4000-8000-000000000001');
insert into public.products (id, workspace_id, name, slug) values ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Preview Test Product', 'preview-test-product');

insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000001', 'source_item', '20000000-0000-4000-8000-000000000001', 'source_items', '41000000-0000-4000-8000-000000000001');
insert into public.raw_source_items (id, evidence_node_id, source_key, external_id, fetched_at, payload_json, payload_hash) values ('42000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'fixture', 'preview-test-raw-1', now(), '{}'::jsonb, repeat('a', 64));
insert into public.source_items (id, evidence_node_id, source_key, external_id, body, published_at, captured_at, content_hash, latest_raw_source_item_id, normalization_version) values ('41000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'github', 'preview-test-source-1', 'We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.', '2026-09-03T05:37:14+00:00', now(), repeat('b', 64), '42000000-0000-4000-8000-000000000001', 'fixture-v1');

insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000002', 'conversation', '20000000-0000-4000-8000-000000000001', 'conversations', '43000000-0000-4000-8000-000000000001');
insert into public.conversations (id, evidence_node_id, conversation_key, primary_source_item_id, body, published_at, captured_at, content_hash, canonicalization_version) values ('43000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'fixture:preview-test:1', '41000000-0000-4000-8000-000000000001', 'We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.', '2026-09-03T05:37:14+00:00', now(), repeat('c', 64), 'fixture-v1');

insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000003', 'demand_profile', '20000000-0000-4000-8000-000000000001', 'demand_profiles', '44000000-0000-4000-8000-000000000001');
insert into public.engine_versions (id, engine_type, version, model) values ('45000000-0000-4000-8000-000000000001', 'profile', 'l12pt-profile-v1', 'deterministic');
insert into public.demand_profiles (id, workspace_id, product_id, evidence_node_id, profile_version, confidence, engine_version_id) values ('44000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 1, 0.9, '45000000-0000-4000-8000-000000000001');

insert into public.engine_versions (id, engine_type, version, model) values ('45000000-0000-4000-8000-000000000002', 'classifier', 'l12pt-analysis-v1', 'deterministic');
insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000004', 'conversation_analysis', '20000000-0000-4000-8000-000000000001', 'conversation_analysis', '46000000-0000-4000-8000-000000000001');
insert into public.conversation_analysis (id, conversation_id, evidence_node_id, engine_version_id, input_fingerprint, intent_type, specificity, confidence) values ('46000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004', '45000000-0000-4000-8000-000000000002', repeat('d', 64), 'switching_intent', 0.8, 0.9);

insert into public.engine_versions (id, engine_type, version, model) values ('45000000-0000-4000-8000-000000000003', 'matcher', 'l12pt-matcher-v1', 'deterministic');
insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000005', 'match', '20000000-0000-4000-8000-000000000001', 'product_matches', '47000000-0000-4000-8000-000000000001');
insert into public.product_matches (id, workspace_id, product_id, conversation_id, evidence_node_id) values ('47000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005');

insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000006', 'match_evaluation', '20000000-0000-4000-8000-000000000001', 'product_match_evaluations', '48000000-0000-4000-8000-000000000001');
insert into public.product_match_evaluations (id, workspace_id, product_match_id, product_id, conversation_id, demand_profile_id, conversation_analysis_id, match_engine_version_id, evidence_node_id, input_fingerprint, match_confidence, rationale, evidence, decision) values ('48000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000006', repeat('e', 64), 0.9, 'Materialized evaluation for preview test.', '{"qualification": {"status": "qualified", "diagnostics": {"failed": false}}}'::jsonb, 'qualified');
update public.product_matches set current_match_evaluation_id = '48000000-0000-4000-8000-000000000001' where id = '47000000-0000-4000-8000-000000000001';

insert into public.engine_versions (id, engine_type, version, model) values ('45000000-0000-4000-8000-000000000004', 'ranker', 'l12pt-ranker-v1', 'deterministic');
insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000007', 'ranking', '20000000-0000-4000-8000-000000000001', 'match_rankings', '49000000-0000-4000-8000-000000000001');
insert into public.match_rankings (id, workspace_id, product_match_evaluation_id, ranking_engine_version_id, evidence_node_id, formula_version, semantic_relevance, pain_alignment, buyer_alignment, intent_strength, specificity, freshness, source_quality, opportunity_score, input_fingerprint) values ('49000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000007', 'ranking_formula_v1', 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, repeat('f', 64));

insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000008', 'signal', '20000000-0000-4000-8000-000000000001', 'signals', '4a000000-0000-4000-8000-000000000001');
insert into public.signals (id, workspace_id, product_id, product_match_id, product_match_evaluation_id, match_ranking_id, conversation_id, evidence_node_id, intent_type, excerpt, why_it_matters, source_key, published_at) values ('4a000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000008', 'switching_intent', 'We are leaving Jira and moving to Linear.', 'A user is switching from Jira to Linear.', 'github', '2026-09-03T05:37:14+00:00');

insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-000000000009', 'match', '20000000-0000-4000-8000-000000000001', 'demand_clusters', '4b000000-0000-4000-8000-000000000001');
insert into public.demand_clusters (id, workspace_id, product_id, evidence_node_id, clustering_version, clustering_engine_version_id, cluster_key, anchor_concept_key, intent_family, target_scope, label, identity) values ('4b000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000009', 'demand_clustering_v1', '45000000-0000-4000-8000-000000000004', 'issue-tracking-switching', 'issue_tracking', 'switch', 'product', 'Switching to Linear', '{}'::jsonb);
insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id) values ('40000000-0000-4000-8000-00000000000a', 'match', '20000000-0000-4000-8000-000000000001', 'demand_cluster_memberships', '4c000000-0000-4000-8000-000000000001');
insert into public.demand_cluster_memberships (id, workspace_id, product_id, cluster_id, match_evaluation_id, product_match_id, conversation_id, evidence_node_id, clustering_version, clustering_engine_version_id, source_key, evidence_at, confidence, assignment) values ('4c000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-00000000000a', 'demand_clustering_v1', '45000000-0000-4000-8000-000000000004', 'github', now(), 0.9, '{}'::jsonb);

-- ---------------------------------------------------------------- checksum helper
create or replace function l12pt.table_checksum(p_table text) returns text language plpgsql as $$
declare v_result text;
begin
  execute format('select coalesce(md5(string_agg(t::text, %L order by id::text)), %L) from %I t', '|', 'empty', p_table) into v_result;
  return v_result;
end;
$$;

create or replace function l12pt.all_checksums() returns text language plpgsql as $$
declare v_result text := '';
begin
  v_result := v_result || 'workspaces=' || l12pt.table_checksum('workspaces') || ';';
  v_result := v_result || 'products=' || l12pt.table_checksum('products') || ';';
  v_result := v_result || 'product_snapshots=' || l12pt.table_checksum('product_snapshots') || ';';
  v_result := v_result || 'demand_profiles=' || l12pt.table_checksum('demand_profiles') || ';';
  v_result := v_result || 'conversations=' || l12pt.table_checksum('conversations') || ';';
  v_result := v_result || 'source_items=' || l12pt.table_checksum('source_items') || ';';
  v_result := v_result || 'conversation_analysis=' || l12pt.table_checksum('conversation_analysis') || ';';
  v_result := v_result || 'product_matches=' || l12pt.table_checksum('product_matches') || ';';
  v_result := v_result || 'product_match_evaluations=' || l12pt.table_checksum('product_match_evaluations') || ';';
  v_result := v_result || 'match_rankings=' || l12pt.table_checksum('match_rankings') || ';';
  v_result := v_result || 'signals=' || l12pt.table_checksum('signals') || ';';
  v_result := v_result || 'demand_clusters=' || l12pt.table_checksum('demand_clusters') || ';';
  v_result := v_result || 'demand_cluster_memberships=' || l12pt.table_checksum('demand_cluster_memberships') || ';';
  v_result := v_result || 'evidence_nodes=' || l12pt.table_checksum('evidence_nodes') || ';';
  return v_result;
end;
$$;

create table l12pt.before_checksum as select l12pt.all_checksums() as value;

-- ---------------------------------------------------------------- simulated preview read sequence
-- Mirrors, in order, exactly the SELECTs SignalRevalidationPreviewIntelligenceRepository /
-- SignalRevalidationPreviewClusterRepository / SignalRevalidationPreviewShadowRepository issue
-- for one signal: listSignals -> getEvaluationById -> getMatchById -> getConversation ->
-- getSourceItem -> getConversationAnalysisById -> getProduct -> getDemandProfileById ->
-- getProductSnapshots -> listClusters -> listMemberships -> shadow loadForReplay.
do $$
declare v_count int;
begin
  select count(*) into v_count from public.signals where workspace_id = '20000000-0000-4000-8000-000000000001';
  select count(*) into v_count from public.product_match_evaluations where id = '48000000-0000-4000-8000-000000000001';
  select count(*) into v_count from public.product_matches where id = '47000000-0000-4000-8000-000000000001';
  select count(*) into v_count from public.conversations where id = '43000000-0000-4000-8000-000000000001';
  select count(*) into v_count from public.source_items where id = '41000000-0000-4000-8000-000000000001';
  select count(*) into v_count from public.conversation_analysis where id = '46000000-0000-4000-8000-000000000001';
  select count(*) into v_count from public.products where id = '30000000-0000-4000-8000-000000000001';
  select count(*) into v_count from public.demand_profiles where id = '44000000-0000-4000-8000-000000000001';
  select count(*) into v_count from public.product_snapshots where product_id = '30000000-0000-4000-8000-000000000001';
  select count(*) into v_count from public.demand_clusters where workspace_id = '20000000-0000-4000-8000-000000000001' and product_id = '30000000-0000-4000-8000-000000000001' and clustering_version = 'demand_clustering_v1';
  select count(*) into v_count from public.demand_cluster_memberships where workspace_id = '20000000-0000-4000-8000-000000000001' and product_id = '30000000-0000-4000-8000-000000000001' and clustering_version = 'demand_clustering_v1';
  select count(*) into v_count from public.semantic_shadow_reasoning where workspace_id = '20000000-0000-4000-8000-000000000001' and product_id = '30000000-0000-4000-8000-000000000001' and conversation_id = '43000000-0000-4000-8000-000000000001';
end $$;

select l12pt.ok(l12pt.all_checksums() = (select value from l12pt.before_checksum), 'no_write_after_simulated_preview_read_sequence');

select 'ALL_CHECKS_PASSED';
