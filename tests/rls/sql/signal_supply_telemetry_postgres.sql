-- Layer 12A.1 real-Postgres proof for 20261020000000_signal_supply_telemetry_v1.sql.
-- Run by tests/rls/signal-supply-telemetry-postgres.test.ts against a throwaway
-- local database with every migration applied (never a shared/production DB).
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema if not exists s12t;
grant usage on schema s12t to authenticated, service_role;
create or replace function s12t.expect_error(p_sql text, p_pattern text, p_name text) returns text language plpgsql as $$
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
create or replace function s12t.ok(p_cond boolean, p_name text) returns text language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'check % failed', p_name; end if;
  return 'OK ' || p_name;
end;
$$;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'a@example.test'), ('10000000-0000-4000-8000-000000000002', 'b@example.test');
insert into public.workspaces (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'A', 'ws-a', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'B', 'ws-b', '10000000-0000-4000-8000-000000000002');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'member'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'member');
select set_config('request.jwt.claim.role', 'service_role', false);
insert into public.products (id, workspace_id, name, slug) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'PA', 'pa'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'PB', 'pb');
insert into public.market_partitions (id, partition_key, identity_version, source_key, retrieval_spec) values
  ('40000000-0000-4000-8000-000000000001', 'market_partition_identity_v1:gh', 'market_partition_identity_v1', 'github', '{}'),
  ('40000000-0000-4000-8000-000000000002', 'market_partition_identity_v1:yt', 'market_partition_identity_v1', 'youtube', '{}');
insert into public.job_runs (id, job_type, idempotency_key, trace_id, workspace_id, product_id, status) values
  ('50000000-0000-4000-8000-000000000001', 'refresh-market-partition', 'r1', 't', null, null, 'succeeded'),
  ('50000000-0000-4000-8000-000000000002', 'refresh-market-partition', 'r2', 't', null, null, 'succeeded'),
  ('50000000-0000-4000-8000-000000000003', 'refresh-market-partition', 'r3', 't', null, null, 'succeeded'),
  ('50000000-0000-4000-8000-000000000011', 'match-product-incremental', 'm1', 't', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'succeeded'),
  ('50000000-0000-4000-8000-000000000012', 'match-product-incremental', 'm2', 't', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'succeeded'),
  ('50000000-0000-4000-8000-000000000013', 'match-product-incremental', 'm3', 't', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'succeeded'),
  ('50000000-0000-4000-8000-000000000021', 'discover-source', 'd1', 't', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'succeeded');

create or replace function s12t.refresh(p_job uuid, p_partition uuid, p_source text, p_raw int, p_new int, p_uniq int, p_new_canon int, p_cost numeric, p_unit text, p_finished timestamptz)
returns void language sql as $$
  insert into public.supply_refresh_facts (telemetry_version, job_run_id, market_partition_id, partition_key, source_key, refresh_status, execution_status, refresh_started_at, refresh_finished_at,
    raw_count, raw_new_count, normalized_count, unique_conversation_count, new_canonical_count, reused_canonical_count, pages_completed, provider_request_count, provider_cost_value, provider_cost_unit, latency_ms)
  values ('signal_supply_telemetry_v1', p_job, p_partition, (select partition_key from public.market_partitions where id = p_partition), p_source, 'succeeded', 'completed_with_results', p_finished - interval '10 seconds', p_finished,
    p_raw, p_new, p_raw, p_uniq, p_new_canon, p_uniq - p_new_canon, 1, 2, p_cost, p_unit, 10000)
  on conflict (job_run_id) do nothing
$$;
create or replace function s12t.product(p_job uuid, p_refresh uuid, p_ws uuid, p_product uuid, p_cand int, p_sel int, p_eval int, p_q int, p_w int, p_r int, p_finished timestamptz)
returns void language sql as $$
  insert into public.product_supply_facts (telemetry_version, workspace_id, product_id, job_run_id, refresh_job_run_id, market_partition_id, partition_key, source_key,
    refresh_conversation_count, already_matched_count, candidate_count, overflow_count, selected_count, evaluated_count, weak_count, rejected_count, qualified_count, materialized_count,
    demand_rebuilt, clusters_created_count, cluster_memberships_created_count, reasoning_call_count, reasoning_cost_value, reasoning_cost_unit, started_at, finished_at)
  values ('signal_supply_telemetry_v1', p_ws, p_product, p_job, p_refresh, '40000000-0000-4000-8000-000000000001', 'market_partition_identity_v1:gh', 'github',
    p_cand + 1, 1, p_cand, 0, p_sel, p_eval, p_w, p_r, p_q, p_q, p_q > 0, 1, 2, 3, 0.01, 'usd', p_finished - interval '5 seconds', p_finished)
  on conflict (job_run_id) do nothing
$$;

-- ------------------------------------------------------ grants / RLS contract
select s12t.ok(not has_function_privilege('authenticated', 'public.signal_supply_funnel(timestamptz, timestamptz, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.signal_supply_funnel(timestamptz, timestamptz, uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.signal_supply_funnel(timestamptz, timestamptz, uuid, uuid)', 'execute'), 'funnel_service_role_only');
select s12t.ok(not has_table_privilege('authenticated', 'public.supply_refresh_facts', 'select')
  and not has_table_privilege('anon', 'public.supply_refresh_facts', 'select')
  and not has_table_privilege('authenticated', 'public.product_supply_facts', 'insert')
  and not has_table_privilege('authenticated', 'public.product_supply_facts', 'update')
  and has_table_privilege('authenticated', 'public.product_supply_facts', 'select')
  and (select relrowsecurity from pg_class where oid = 'public.supply_refresh_facts'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.product_supply_facts'::regclass), 'table_grants_and_rls');

-- ------------------------------------------------------ constraints
select s12t.expect_error($q$ select s12t.refresh('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'github', 10, 4, 3, 2, 5, 'unknown', now()) $q$, '23514|check', 'unknown_unit_cannot_carry_value');
select s12t.expect_error($q$ select s12t.refresh('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'github', 10, 4, 3, 2, null, 'usd', now()) $q$, '23514|check', 'usd_requires_value');
select s12t.expect_error($q$ select s12t.refresh('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'github', 10, 4, 3, 2, 1, 'dollars', now()) $q$, '23514|check', 'unit_enum_bounded');
select s12t.expect_error($q$ select s12t.refresh('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'github', 3, 4, 3, 2, null, 'unknown', now()) $q$, '23514|check', 'raw_new_not_above_raw');
select s12t.expect_error($q$ select s12t.refresh('50000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000001', 'github', 10, 4, 3, 2, null, 'unknown', now()) $q$, 'supply_refresh_fact_job_mismatch', 'refresh_fact_requires_global_refresh_job');
select s12t.expect_error($q$ select s12t.product('50000000-0000-4000-8000-000000000012', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 3, 3, 3, 1, 1, 1, now()) $q$, 'product_supply_fact_scope_mismatch', 'cross_workspace_job_rejected');
select s12t.expect_error($q$ select s12t.product('50000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 3, 3, 3, 1, 1, 1, now()) $q$, 'product_supply_fact_scope_mismatch|23503', 'cross_workspace_product_rejected');
select s12t.expect_error($q$ select s12t.product('50000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 3, 3, 3, 1, 1, 1, now()) $q$, 'product_supply_fact_refresh_mismatch', 'refresh_reference_must_be_global_refresh');
select s12t.expect_error($q$ select s12t.product('50000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 3, 3, 2, 2, 1, 1, now()) $q$, '23514|check', 'decisions_not_above_evaluated');

-- ------------------------------------------------------ facts + idempotency + immutability
select s12t.refresh('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'github', 10, 4, 3, 2, null, 'unknown', now() - interval '2 hours');
select s12t.refresh('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'github', 99, 99, 99, 0, null, 'unknown', now() - interval '1 hour');
select s12t.ok((select count(*) = 1 and max(raw_count) = 10 from public.supply_refresh_facts where job_run_id = '50000000-0000-4000-8000-000000000001'), 'refresh_replay_first_row_wins');
select s12t.refresh('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'github', 6, 0, 5, 0, null, 'unknown', now() - interval '3 hours');
select s12t.refresh('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000002', 'youtube', 8, 8, 8, 8, 101, 'quota_units', now() - interval '1 hour');
select s12t.product('50000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 6, 5, 5, 1, 2, 2, now() - interval '2 hours');
select s12t.product('50000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 60, 50, 50, 10, 20, 20, now());
select s12t.ok((select count(*) = 1 and max(candidate_count) = 6 from public.product_supply_facts where job_run_id = '50000000-0000-4000-8000-000000000011'), 'product_replay_first_row_wins');
select s12t.product('50000000-0000-4000-8000-000000000012', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 4, 4, 4, 2, 1, 1, now() - interval '2 hours');
select s12t.product('50000000-0000-4000-8000-000000000013', '50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 0, 0, 0, 0, 0, 0, now() - interval '3 hours');
select s12t.expect_error($q$ update public.supply_refresh_facts set raw_count = raw_count + 1 $q$, 'supply_fact_immutable', 'refresh_facts_immutable');
select s12t.expect_error($q$ update public.product_supply_facts set qualified_count = qualified_count + 1 $q$, 'supply_fact_immutable', 'product_facts_immutable');

-- ------------------------------------------------------ qualified-evidence fixtures (FK chains bypassed for fixtures only)
set session_replication_role = replica;
insert into public.source_items (id, evidence_node_id, source_key, external_id, body, captured_at, content_hash, latest_raw_source_item_id, normalization_version) values
  ('60000000-0000-4000-8000-000000000001', gen_random_uuid(), 'github', 'gh-1', 'b', now(), repeat('a', 64), gen_random_uuid(), 'v1'),
  ('60000000-0000-4000-8000-000000000002', gen_random_uuid(), 'hacker-news', 'hn-1', 'b', now(), repeat('b', 64), gen_random_uuid(), 'v1'),
  ('60000000-0000-4000-8000-000000000003', gen_random_uuid(), 'fixture', 'fx-1', 'b', now(), repeat('c', 64), gen_random_uuid(), 'v1'),
  ('60000000-0000-4000-8000-000000000004', gen_random_uuid(), 'github', 'gh-2', 'b', now(), repeat('d', 64), gen_random_uuid(), 'v1');
insert into public.conversations (id, evidence_node_id, conversation_key, primary_source_item_id, body, captured_at, content_hash, canonicalization_version)
select ('70000000-0000-4000-8000-00000000000' || n)::uuid, gen_random_uuid(), 'k' || n, ('60000000-0000-4000-8000-00000000000' || n)::uuid, 'b', now(), repeat(n::text, 64), 'canonical-v1' from generate_series(1, 4) n;
create or replace function s12t.eval(p_ws uuid, p_product uuid, p_conv uuid, p_decision text, p_at timestamptz) returns void language sql as $$
  insert into public.product_match_evaluations (id, workspace_id, product_match_id, product_id, conversation_id, demand_profile_id, conversation_analysis_id, match_engine_version_id, evidence_node_id, input_fingerprint, match_confidence, rationale, decision, created_at)
  values (gen_random_uuid(), p_ws, gen_random_uuid(), p_product, p_conv, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'), 0.5, 'r', p_decision, p_at)
$$;
-- product A: conv1 qualified twice (counts once, at its first qualification), conv2 qualified, conv3 fixture qualified (excluded), conv4 weak (excluded)
select s12t.eval('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'qualified', now() - interval '5 hours');
select s12t.eval('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'qualified', now() - interval '1 hour');
select s12t.eval('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'qualified', now() - interval '2 hours');
select s12t.eval('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003', 'qualified', now() - interval '2 hours');
select s12t.eval('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000004', 'weak', now() - interval '2 hours');
-- conv4 first qualified 3 days ago: its first qualification is outside a 1-day window (later requalification never counts)
select s12t.eval('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000004', 'qualified', now() - interval '30 minutes');
select s12t.eval('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000004', 'qualified', now() - interval '3 days');
-- product B (other workspace): the same public conversation qualifies independently
select s12t.eval('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', 'qualified', now() - interval '2 hours');
set session_replication_role = origin;

-- ------------------------------------------------------ funnel RPC
select s12t.expect_error($q$ select public.signal_supply_funnel(now() - interval '32 days', now()) $q$, 'signal_supply_window_invalid', 'window_capped_31_days');
select s12t.expect_error($q$ select public.signal_supply_funnel(now(), now() - interval '1 day') $q$, 'signal_supply_window_invalid', 'window_must_be_forward');
select s12t.expect_error($q$ select public.signal_supply_funnel(null, now()) $q$, 'signal_supply_window_invalid', 'window_required');
select s12t.expect_error($q$ select public.signal_supply_funnel(now() - interval '1 day', now(), null, '30000000-0000-4000-8000-000000000001') $q$, 'signal_supply_scope_invalid', 'product_scope_needs_workspace');
select s12t.ok((select (f->'refresh'->'bySource') = '[]'::jsonb and (f->'products') = '[]'::jsonb and (f->'qualifiedEvidence'->>'grossTotal')::int = 0
  from (select public.signal_supply_funnel(now() - interval '400 days', now() - interval '380 days') f) x), 'zero_data_window');

create temp table s12_f as select public.signal_supply_funnel(now() - interval '1 day', now() + interval '1 minute') f;
select s12t.ok((select (s->>'raw')::int = 16 and (s->>'raw_new')::int = 4 and (s->>'refresh_jobs')::int = 2 and (s->>'new_canonical')::int = 2 and (s->>'reused_canonical')::int = 6
    and (s->>'duplicate_rate')::numeric = 0.75 and (s->>'provider_requests')::int = 4
  from s12_f, jsonb_array_elements(f->'refresh'->'bySource') s where s->>'source_key' = 'github'), 'refresh_by_source_exact');
select s12t.ok((select jsonb_agg(c) = '[{"jobs": 2, "unit": "unknown", "value": null}]'::jsonb from s12_f, jsonb_array_elements(f->'refresh'->'bySource') s, jsonb_array_elements(s->'costs') c where s->>'source_key' = 'github')
  and (select jsonb_agg(c) = '[{"jobs": 1, "unit": "quota_units", "value": 101}]'::jsonb from s12_f, jsonb_array_elements(f->'refresh'->'bySource') s, jsonb_array_elements(s->'costs') c where s->>'source_key' = 'youtube')
  and not exists (select 1 from s12_f, jsonb_array_elements(f->'refresh'->'bySource') s, jsonb_array_elements(s->'costs') c where c->>'unit' = 'usd'), 'costs_grouped_by_unit_quota_never_usd');
select s12t.ok((select count(*) = 2 from s12_f, jsonb_array_elements(f->'refresh'->'byPartition') p), 'by_partition_dimension');
select s12t.ok((select (p->>'candidates')::int = 6 and (p->>'selected')::int = 5 and (p->>'evaluated')::int = 5 and (p->>'qualified')::int = 1 and (p->>'weak')::int = 2 and (p->>'rejected')::int = 2
    and (p->>'product_jobs')::int = 2 and (p->>'selection_rate')::numeric = 0.8333 and (p->>'qualification_rate')::numeric = 0.2 and (p->>'clusters_created')::int = 2
  from s12_f, jsonb_array_elements(f->'products') p where p->>'product_id' = '30000000-0000-4000-8000-000000000001'), 'product_by_scope_exact');
select s12t.ok((select jsonb_agg(c) = '[{"jobs": 2, "unit": "usd", "value": 0.02}]'::jsonb from s12_f, jsonb_array_elements(f->'products') p, jsonb_array_elements(p->'reasoning_costs') c where p->>'product_id' = '30000000-0000-4000-8000-000000000001'), 'reasoning_cost_grouped_by_unit');
-- product A in window: conv1 (first at -5h), conv2 (-2h) -> 2; conv3 fixture excluded; conv4 first qualified 3 days ago -> excluded. Product B: conv1 -> 1.
select s12t.ok((select (f->'qualifiedEvidence'->>'grossTotal')::int = 3 from s12_f), 'first_qualified_distinct_total');
select s12t.ok((select jsonb_agg(q order by q->>'product_id', q->>'source_key') = jsonb_build_array(
    jsonb_build_object('source_key', 'github', 'product_id', '30000000-0000-4000-8000-000000000001', 'workspace_id', '20000000-0000-4000-8000-000000000001', 'gross_qualified_evidence', 1),
    jsonb_build_object('source_key', 'hacker-news', 'product_id', '30000000-0000-4000-8000-000000000001', 'workspace_id', '20000000-0000-4000-8000-000000000001', 'gross_qualified_evidence', 1),
    jsonb_build_object('source_key', 'github', 'product_id', '30000000-0000-4000-8000-000000000002', 'workspace_id', '20000000-0000-4000-8000-000000000002', 'gross_qualified_evidence', 1))
  from s12_f, jsonb_array_elements(f->'qualifiedEvidence'->'grossBySource') q), 'first_qualified_by_source_and_product');
select s12t.ok((select f->'qualifiedEvidence'->>'net' = 'deferred' and f->'deferred' ? 'clusters_strengthened' and f->'deferred' ? 'surface' and f->'deferred' ? 'concept' from s12_f), 'deferred_dimensions_explicit');
-- A narrower window that excludes conv1's first qualification drops it even though it qualified again inside
select s12t.ok((select (public.signal_supply_funnel(now() - interval '3 hours', now() + interval '1 minute', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001')->'qualifiedEvidence'->>'grossTotal')::int = 1), 'requalification_never_recounted');
select s12t.ok((select jsonb_array_length(public.signal_supply_funnel(now() - interval '1 day', now() + interval '1 minute', '20000000-0000-4000-8000-000000000002')->'products') = 1), 'workspace_scope_filter');
select s12t.ok((select count(*) = 2 from pg_indexes where indexname in ('product_match_evaluations_first_qualified_idx', 'product_match_evaluations_qualified_created_idx')), 'first_qualified_indexes');

-- ------------------------------------------------------ RLS as real roles
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select s12t.ok((select count(*) = 2 from public.product_supply_facts) and (select bool_and(workspace_id = '20000000-0000-4000-8000-000000000001') from public.product_supply_facts), 'rls_member_reads_own_workspace_only');
select s12t.expect_error($q$ select count(*) from public.supply_refresh_facts $q$, '42501|permission denied', 'rls_no_global_refresh_read');
select s12t.expect_error($q$ select public.signal_supply_funnel(now() - interval '1 day', now()) $q$, '42501|permission denied', 'authenticated_cannot_call_funnel');
select s12t.expect_error($q$ delete from public.product_supply_facts $q$, '42501|permission denied', 'authenticated_cannot_delete');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
select s12t.ok((select count(*) = 1 from public.product_supply_facts), 'rls_other_member_isolated');
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
set role service_role;
select s12t.ok((select jsonb_typeof(public.signal_supply_funnel(now() - interval '1 day', now())) = 'object'), 'service_role_calls_funnel');
reset role;

select 'ALL_CHECKS_PASSED';
