-- Layer 12A.2 real-Postgres proof for 20261021000000_supply_partition_seeding_v1.sql.
-- Run by tests/rls/supply-partition-seeding-postgres.test.ts against a throwaway
-- local database with every migration applied (never a shared/production DB).
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema if not exists s12s;
grant usage on schema s12s to anon, authenticated, service_role;
create or replace function s12s.expect_error(p_sql text, p_pattern text, p_name text) returns text language plpgsql as $$
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
create or replace function s12s.ok(p_cond boolean, p_name text) returns text language plpgsql as $$
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
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'PB', 'pb'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'PARCH', 'parch');
insert into public.job_runs (id, job_type, idempotency_key, trace_id, workspace_id, product_id, status) values
  ('50000000-0000-4000-8000-000000000001', 'discover-source', 's1', 't', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'succeeded'),
  ('50000000-0000-4000-8000-000000000002', 'discover-source', 's2', 't', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'succeeded'),
  ('50000000-0000-4000-8000-000000000003', 'discover-source', 's3', 't', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'succeeded');

-- p(workspace, product, job, origin, partition-suffix, query id, now, max partitions/source, max seeds/product/source)
create or replace function s12s.seed(p_ws uuid, p_product uuid, p_job uuid, p_origin text, p_key text, p_qp text, p_now timestamptz, p_src_cap int default 60, p_prod_cap int default 6, p_source text default 'github')
returns text language sql as $$
  select public.upsert_market_partition_interest(p_ws, p_product, p_origin, p_job,
    md5('mp:' || p_key)::uuid, 'market_partition_identity_v1:' || p_key, 'market_partition_identity_v1', p_source,
    jsonb_build_object('v', 'market_partition_identity_v1', 'source_key', p_source, 'expression', p_key, 'params', '{}'::jsonb, 'expandThreads', false),
    p_qp, jsonb_build_object('queryPlanId', p_qp, 'source', p_source, 'queryFamily', 'pain', 'demandSurface', 'pain_first', 'concepts', '["c"]'::jsonb, 'competitorSpecific', false),
    case when p_origin = 'planner_seed' then 'supply_partition_seeding_v1' end, '{"queryFamily":"pain"}'::jsonb, p_now, 14 * 86400, p_src_cap, p_prod_cap)
$$;
create table s12s.results (name text primary key, status text not null);
grant all on s12s.results to authenticated, service_role;
-- Runs one seed/renew call as its own statement and records its status, so later checks never depend on AND evaluation order.
create or replace function s12s.run(p_name text, p_expect text, p_ws uuid, p_product uuid, p_job uuid, p_origin text, p_key text, p_qp text, p_now timestamptz, p_src_cap int default 60, p_prod_cap int default 6, p_source text default 'github')
returns text language plpgsql as $$
declare v text;
begin
  v := s12s.seed(p_ws, p_product, p_job, p_origin, p_key, p_qp, p_now, p_src_cap, p_prod_cap, p_source);
  insert into s12s.results values (p_name, v);
  if v <> p_expect then raise exception 'check % failed: expected % got %', p_name, p_expect, v; end if;
  return 'OK ' || p_name;
end;
$$;
create or replace function s12s.active(p_key text) returns bigint language sql as $$
  select count(*) from public.active_market_partition_interests(array['market_partition_identity_v1:' || p_key], now())
$$;

-- ------------------------------------------------------ schema, grants, RLS
select s12s.ok((select relrowsecurity from pg_class where oid = 'public.market_partition_interests'::regclass), 'rls_enabled');
select s12s.ok(not has_table_privilege('anon', 'public.market_partition_interests', 'select') and not has_table_privilege('anon', 'public.market_partition_interests', 'insert'), 'anon_no_access');
select s12s.ok(has_table_privilege('authenticated', 'public.market_partition_interests', 'select')
  and not has_table_privilege('authenticated', 'public.market_partition_interests', 'insert')
  and not has_table_privilege('authenticated', 'public.market_partition_interests', 'update')
  and not has_table_privilege('authenticated', 'public.market_partition_interests', 'delete'), 'authenticated_select_only');
select s12s.ok(not has_function_privilege('authenticated', 'public.upsert_market_partition_interest(uuid, uuid, text, uuid, uuid, text, text, text, jsonb, text, jsonb, text, jsonb, timestamptz, integer, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.active_market_partition_interests(text[], timestamptz, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.retire_exhausted_seed_partitions(timestamptz, integer, integer, integer)', 'execute')
  and has_function_privilege('service_role', 'public.upsert_market_partition_interest(uuid, uuid, text, uuid, uuid, text, text, text, jsonb, text, jsonb, text, jsonb, timestamptz, integer, integer, integer)', 'execute')
  and has_function_privilege('service_role', 'public.retire_exhausted_seed_partitions(timestamptz, integer, integer, integer)', 'execute'), 'rpcs_service_role_only');
select s12s.ok(not exists (select 1 from pg_proc where proname in ('upsert_market_partition_interest', 'active_market_partition_interests', 'retire_exhausted_seed_partitions', 'enforce_market_partition_interest_scope', 'deactivate_market_partition_interests_for_product') and prosecdef), 'no_security_definer');

-- ------------------------------------------------------ create, reuse, isolate
select s12s.run('seed_created', 'created', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'planner_seed', 'k1', 'qp-1', now());
select s12s.ok((select count(*) = 1 from public.market_partitions where partition_key = 'market_partition_identity_v1:k1' and id = md5('mp:k1')::uuid and identity_version = 'market_partition_identity_v1'), 'seed_creates_global_partition_via_identity');
select s12s.run('other_workspace_seed_created', 'created', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'planner_seed', 'k1', 'qp-b1', now());
select s12s.ok((select count(*) = 1 from public.market_partitions where partition_key = 'market_partition_identity_v1:k1')
  and (select count(*) = 2 and count(distinct market_partition_id) = 1 and count(distinct workspace_id) = 2 from public.market_partition_interests where partition_key = 'market_partition_identity_v1:k1'), 'same_spec_one_partition_isolated_interests');
select s12s.run('reseed_status', 'renewed', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'planner_seed', 'k1', 'qp-1b', now() + interval '1 day');
select s12s.ok((select renewal_count = 1 and query_plan_id = 'qp-1b' and provenance->>'queryPlanId' = 'qp-1b' and expires_at > now() + interval '14 days' from public.market_partition_interests
        where product_id = '30000000-0000-4000-8000-000000000001' and partition_key = 'market_partition_identity_v1:k1')
  and (select count(*) = 1 from public.market_partition_interests where product_id = '30000000-0000-4000-8000-000000000001' and partition_key = 'market_partition_identity_v1:k1'), 'reseed_renews_single_row');
select s12s.ok(s12s.active('k1') = 2, 'active_read_path_returns_both');

-- ------------------------------------------------------ provenance required and self-consistent
select s12s.expect_error($q$ insert into public.market_partition_interests (interest_version, workspace_id, product_id, market_partition_id, partition_key, source_key, origin, origin_job_run_id, query_plan_id, provenance, seed_version, renewed_at, expires_at)
  values ('market_partition_interest_v1', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', md5('mp:k1')::uuid, 'market_partition_identity_v1:k1', 'github', 'planner_seed', '50000000-0000-4000-8000-000000000003', 'qp-x', null, 'v', now(), now() + interval '1 day') $q$, '23502|not-null', 'provenance_not_null');
select s12s.expect_error($q$ insert into public.market_partition_interests (interest_version, workspace_id, product_id, market_partition_id, partition_key, source_key, origin, origin_job_run_id, query_plan_id, provenance, seed_version, renewed_at, expires_at)
  values ('market_partition_interest_v1', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', md5('mp:k1')::uuid, 'market_partition_identity_v1:k1', 'github', 'planner_seed', '50000000-0000-4000-8000-000000000003', 'qp-x',
    '{"queryPlanId":"another","source":"github","queryFamily":"pain","demandSurface":"pain_first","concepts":[],"competitorSpecific":false}', 'v', now(), now() + interval '1 day') $q$, '23514|check', 'provenance_must_name_its_query');
select s12s.expect_error($q$ insert into public.market_partition_interests (interest_version, workspace_id, product_id, market_partition_id, partition_key, source_key, origin, origin_job_run_id, query_plan_id, provenance, seed_version, renewed_at, expires_at)
  values ('market_partition_interest_v1', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', md5('mp:k1')::uuid, 'market_partition_identity_v1:k1', 'github', 'planner_seed', '50000000-0000-4000-8000-000000000003', 'qp-x',
    '{"queryPlanId":"qp-x","source":"stack-exchange","queryFamily":"pain","demandSurface":"pain_first","concepts":[],"competitorSpecific":false}', 'v', now(), now() + interval '1 day') $q$, '23514|check', 'provenance_must_name_its_source');
select s12s.expect_error($q$ insert into public.market_partition_interests (interest_version, workspace_id, product_id, market_partition_id, partition_key, source_key, origin, origin_job_run_id, query_plan_id, provenance, seed_version, renewed_at, expires_at)
  values ('market_partition_interest_v1', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', md5('mp:k1')::uuid, 'market_partition_identity_v1:k1', 'github', 'planner_seed', '50000000-0000-4000-8000-000000000003', 'qp-x',
    '{"queryPlanId":"qp-x","source":"github","demandSurface":"pain_first","concepts":[],"competitorSpecific":false}', 'v', now(), now() + interval '1 day') $q$, '23514|check', 'provenance_requires_family');
select s12s.expect_error($q$ insert into public.market_partition_interests (interest_version, workspace_id, product_id, market_partition_id, partition_key, source_key, origin, origin_job_run_id, query_plan_id, provenance, seed_version, renewed_at, expires_at)
  values ('market_partition_interest_v1', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', md5('mp:k1')::uuid, 'market_partition_identity_v1:k1', 'github', 'planner_seed', '50000000-0000-4000-8000-000000000003', 'qp-x',
    '{"queryPlanId":"qp-x","source":"github","queryFamily":"pain","demandSurface":"pain_first","concepts":[],"competitorSpecific":false}', null, now(), now() + interval '1 day') $q$, '23514|check', 'seed_requires_seed_version');

-- ------------------------------------------------------ tenancy / scope
-- The scope trigger already rejects this; disable it briefly to prove the composite FK rejects it on its own.
alter table public.market_partition_interests disable trigger market_partition_interests_scope;
select s12s.expect_error($q$ insert into public.market_partition_interests (interest_version, workspace_id, product_id, market_partition_id, partition_key, source_key, origin, origin_job_run_id, query_plan_id, provenance, seed_version, renewed_at, expires_at)
  values ('market_partition_interest_v1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', md5('mp:k1')::uuid, 'market_partition_identity_v1:k1', 'github', 'planner_seed', '50000000-0000-4000-8000-000000000002', 'qp-x',
    '{"queryPlanId":"qp-x","source":"github","queryFamily":"pain","demandSurface":"pain_first","concepts":[],"competitorSpecific":false}', 'v', now(), now() + interval '1 day') $q$, '23503|foreign key', 'composite_fk_rejects_cross_workspace_product');
alter table public.market_partition_interests enable trigger market_partition_interests_scope;
select s12s.expect_error($q$ insert into public.market_partition_interests (interest_version, workspace_id, product_id, market_partition_id, partition_key, source_key, origin, origin_job_run_id, query_plan_id, provenance, seed_version, renewed_at, expires_at)
  values ('market_partition_interest_v1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', md5('mp:k1')::uuid, 'market_partition_identity_v1:k1', 'github', 'planner_seed', '50000000-0000-4000-8000-000000000002', 'qp-x',
    '{"queryPlanId":"qp-x","source":"github","queryFamily":"pain","demandSurface":"pain_first","concepts":[],"competitorSpecific":false}', 'v', now(), now() + interval '1 day') $q$, 'job_scope_mismatch|23503', 'scope_trigger_rejects_cross_workspace');
select s12s.expect_error($q$ select s12s.seed('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 'planner_seed', 'k-scope', 'qp-s', now()) $q$, 'job_scope_mismatch', 'origin_job_must_belong_to_product');
select s12s.expect_error($q$ insert into public.market_partition_interests (interest_version, workspace_id, product_id, market_partition_id, partition_key, source_key, origin, origin_job_run_id, query_plan_id, provenance, seed_version, renewed_at, expires_at)
  values ('market_partition_interest_v1', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', md5('mp:k1')::uuid, 'market_partition_identity_v1:other', 'github', 'planner_seed', '50000000-0000-4000-8000-000000000003', 'qp-x',
    '{"queryPlanId":"qp-x","source":"github","queryFamily":"pain","demandSurface":"pain_first","concepts":[],"competitorSpecific":false}', 'v', now(), now() + interval '1 day') $q$, 'partition_mismatch', 'partition_key_must_match_partition');
select s12s.expect_error($q$ update public.market_partition_interests set workspace_id = '20000000-0000-4000-8000-000000000002' where product_id = '30000000-0000-4000-8000-000000000001' $q$, 'identity_immutable|23503', 'interest_identity_immutable');
select s12s.ok((select count(*) = 0 from public.market_partitions where partition_key = 'market_partition_identity_v1:k-scope'), 'failed_seed_leaves_no_partition');

-- ------------------------------------------------------ caps (deterministic, DB-enforced)
select s12s.run('cap_k2_created', 'created', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'planner_seed', 'k2', 'qp-2', now(), 60, 2);
select s12s.run('cap_k3_refused', 'product_cap_reached', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'planner_seed', 'k3', 'qp-3', now(), 60, 2);
select s12s.run('cap_k2_renew_allowed', 'renewed', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'planner_seed', 'k2', 'qp-2', now(), 60, 2);
select s12s.ok((select count(*) = 0 from public.market_partitions where partition_key = 'market_partition_identity_v1:k3'), 'per_product_per_source_cap');
select s12s.run('per_source_cap_is_per_source', 'created', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'planner_seed', 'se1', 'qp-se1', now(), 60, 2, 'stack-exchange');
-- global seeded partitions for github are now k1, k2 (2). Cap 2: a new partition is refused; seeding an already seeded one is not.
select s12s.run('source_cap_refuses_new_partition', 'source_cap_reached', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'planner_seed', 'k4', 'qp-b4', now(), 2);
select s12s.run('source_cap_allows_existing_seeded_partition', 'created', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'planner_seed', 'k2', 'qp-b2', now(), 2);
select s12s.ok((select count(*) = 0 from public.market_partitions where partition_key = 'market_partition_identity_v1:k4'), 'global_per_source_partition_cap');

-- ------------------------------------------------------ expiry and renewal
select s12s.run('old_seed_created', 'created', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'planner_seed', 'k-old', 'qp-old', now() - interval '20 days');
select s12s.ok(s12s.active('k-old') = 0, 'expired_interest_not_active');
select s12s.run('old_seed_renewed', 'renewed', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'planner_seed', 'k-old', 'qp-old', now());
select s12s.ok(s12s.active('k-old') = 1, 'reseed_renews_expired_interest');
select s12s.expect_error($q$ update public.market_partition_interests set expires_at = renewed_at + interval '40 days' where partition_key = 'market_partition_identity_v1:k-old' $q$, '23514|check', 'ttl_bounded');

-- ------------------------------------------------------ scan origin precedence and partition requirement
select s12s.run('scan_missing_partition', 'partition_missing', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'scan', 'k-never', 'qp-n', now());
select s12s.ok((select count(*) = 0 from public.market_partitions where partition_key = 'market_partition_identity_v1:k-never'), 'scan_interest_never_creates_partition');
select s12s.run('scan_upgrade_status', 'renewed', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'scan', 'k1', 'qp-scan1', now());
select s12s.ok((select origin = 'scan' and seed_version is null and query_plan_id = 'qp-scan1' from public.market_partition_interests where product_id = '30000000-0000-4000-8000-000000000001' and partition_key = 'market_partition_identity_v1:k1'), 'scan_upgrades_seed');
select s12s.run('seed_after_scan_status', 'renewed', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'planner_seed', 'k1', 'qp-seed-again', now());
select s12s.ok((select origin = 'scan' and query_plan_id = 'qp-scan1' and provenance->>'queryPlanId' = 'qp-scan1' from public.market_partition_interests where product_id = '30000000-0000-4000-8000-000000000001' and partition_key = 'market_partition_identity_v1:k1'), 'seed_never_downgrades_scan');

-- ------------------------------------------------------ inactive product lifecycle
select s12s.run('seed_for_active_product', 'created', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003', 'planner_seed', 'k-arch', 'qp-arch', now());
select s12s.ok(s12s.active('k-arch') = 1, 'seed_for_active_product_active');
update public.products set status = 'archived' where id = '30000000-0000-4000-8000-000000000003';
select s12s.ok((select deactivated_reason = 'product_inactive' and deactivated_at is not null from public.market_partition_interests where product_id = '30000000-0000-4000-8000-000000000003')
  and s12s.active('k-arch') = 0, 'archiving_deactivates_interests');
select s12s.run('archived_seed_status', 'product_inactive', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003', 'planner_seed', 'k-arch', 'qp-arch', now());
select s12s.ok((select renewal_count = 0 from public.market_partition_interests where product_id = '30000000-0000-4000-8000-000000000003'), 'archived_product_does_not_renew');
select s12s.expect_error($q$ update public.market_partition_interests set renewed_at = now() + interval '1 hour', expires_at = now() + interval '2 days', deactivated_at = null, deactivated_reason = null where product_id = '30000000-0000-4000-8000-000000000003' $q$, 'product_inactive', 'direct_renew_of_inactive_product_rejected');
update public.products set status = 'active' where id = '30000000-0000-4000-8000-000000000003';
select s12s.ok(s12s.active('k-arch') = 0, 'reactivation_alone_does_not_revive_interest');
select s12s.run('reactivated_reseed_status', 'renewed', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003', 'planner_seed', 'k-arch', 'qp-arch', now());
select s12s.ok(s12s.active('k-arch') = 1, 'reactivated_product_reseed_renews');

-- ------------------------------------------------------ scheduler visibility
insert into public.market_partition_refresh_state (partition_id, source_key, next_due_at)
  select id, source_key, now() - interval '1 hour' from public.market_partitions where partition_key like 'market_partition_identity_v1:%' on conflict do nothing;
select s12s.ok((select count(*) = 4 from public.market_partition_refresh_state s join public.market_partitions mp on mp.id = s.partition_id where mp.partition_key like 'market_partition_identity_v1:k%' and s.enabled), 'seeded_partitions_get_normal_state_rows');

-- ------------------------------------------------------ conservative retirement
select s12s.expect_error($q$ update public.market_partition_refresh_state set retired_at = now(), retired_reason = 'seed_zero_yield' where partition_id = md5('mp:k2')::uuid $q$, '23514|check', 'retired_requires_disabled');
update public.market_partition_refresh_state set consecutive_zero_new = 8 where partition_id in (md5('mp:k2')::uuid, md5('mp:k-old')::uuid, md5('mp:k1')::uuid);
select s12s.ok(public.retire_exhausted_seed_partitions(now(), 6, 30, 20) = 0, 'no_retirement_without_telemetry');
insert into public.job_runs (id, job_type, idempotency_key, trace_id, workspace_id, product_id, status)
  select ('60000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'refresh-market-partition', 'rf' || g, 't', null, null, 'succeeded' from generate_series(1, 18) g;
create or replace function s12s.fact(p_job int, p_key text, p_new int, p_age interval) returns void language sql as $$
  insert into public.supply_refresh_facts (telemetry_version, job_run_id, market_partition_id, partition_key, source_key, refresh_status, execution_status, refresh_started_at, refresh_finished_at,
    raw_count, raw_new_count, normalized_count, unique_conversation_count, provider_cost_unit)
  values ('signal_supply_telemetry_v1', ('60000000-0000-4000-8000-0000000000' || lpad(p_job::text, 2, '0'))::uuid, md5('mp:' || p_key)::uuid, 'market_partition_identity_v1:' || p_key, 'github', 'succeeded', 'completed_zero_results',
    now() - p_age - interval '1 minute', now() - p_age, 3, p_new, 3, 3, 'unknown')
$$;
-- k2 (seed-only): only 5 facts -> still not enough evidence to retire.
select s12s.fact(g, 'k2', 0, (g || ' hours')::interval) from generate_series(1, 5) g;
select s12s.ok(public.retire_exhausted_seed_partitions(now(), 6, 30, 20) = 0, 'no_retirement_with_partial_telemetry');
select s12s.fact(6, 'k2', 0, '6 hours');
-- k-old (seed-only): six zero-new refreshes but one product fact shows qualified evidence -> keep.
select s12s.fact(g, 'k-old', 0, ((g - 6) || ' hours')::interval) from generate_series(7, 12) g;
insert into public.job_runs (id, job_type, idempotency_key, trace_id, workspace_id, product_id, status) values
  ('60000000-0000-4000-8000-000000000099', 'match-product-incremental', 'mq', 't', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'succeeded');
insert into public.product_supply_facts (telemetry_version, workspace_id, product_id, job_run_id, refresh_job_run_id, market_partition_id, partition_key, source_key,
  refresh_conversation_count, already_matched_count, candidate_count, overflow_count, selected_count, evaluated_count, weak_count, rejected_count, qualified_count, materialized_count,
  demand_rebuilt, reasoning_cost_unit, started_at, finished_at)
values ('signal_supply_telemetry_v1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000099', '60000000-0000-4000-8000-000000000007',
  md5('mp:k-old')::uuid, 'market_partition_identity_v1:k-old', 'github', 3, 0, 3, 0, 3, 3, 0, 2, 1, 1, false, 'unknown', now() - interval '1 hour', now() - interval '1 hour');
-- k1 has a live scan-origin interest -> never retired by seeding rules.
select s12s.fact(g, 'k1', 0, ((g - 12) || ' hours')::interval) from generate_series(13, 18) g;
create temp table s12_retired as select public.retire_exhausted_seed_partitions(now(), 6, 30, 20) n;
select s12s.ok((select n = 1 from s12_retired), 'retires_exactly_one');
select s12s.ok((select enabled = false and disabled_reason = 'retired' and retired_reason = 'seed_zero_yield' and retired_at is not null from public.market_partition_refresh_state where partition_id = md5('mp:k2')::uuid)
  and (select enabled and retired_at is null from public.market_partition_refresh_state where partition_id = md5('mp:k-old')::uuid)
  and (select enabled and retired_at is null from public.market_partition_refresh_state where partition_id = md5('mp:k1')::uuid), 'retires_only_fully_evidenced_seed_only_zero_yield');
select s12s.ok(public.retire_exhausted_seed_partitions(now(), 6, 30, 20) = 0, 'retirement_idempotent');
select s12s.run('retired_partition_not_reseeded', 'retired', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'planner_seed', 'k2', 'qp-2', now(), 60, 6);
insert into public.query_yield_artifacts (workspace_id, product_id, job_run_id, query_plan_id, source_key, query_family, demand_surface, pages_requested, pages_completed, continuation_stopped_reason, execution_status, market_partition_key)
  values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'qp-2', 'github', 'pain', 'pain_first', 1, 1, 'no_cursor', 'completed_with_results', 'market_partition_identity_v1:k2');
select s12s.run('scan_on_retired_status', 'renewed', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'scan', 'k2', 'qp-2', now());
select s12s.ok((select enabled and retired_at is null and disabled_reason is null and consecutive_zero_new = 0 from public.market_partition_refresh_state where partition_id = md5('mp:k2')::uuid), 'scan_execution_reactivates_retired_partition');

-- ------------------------------------------------------ RLS as real roles
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select s12s.ok((select count(*) > 0 and bool_and(workspace_id = '20000000-0000-4000-8000-000000000001') from public.market_partition_interests), 'rls_member_reads_own_workspace_only');
select s12s.expect_error($q$ update public.market_partition_interests set expires_at = now() + interval '1 day' $q$, '42501|permission denied', 'authenticated_cannot_update');
select s12s.expect_error($q$ delete from public.market_partition_interests $q$, '42501|permission denied', 'authenticated_cannot_delete');
select s12s.expect_error($q$ select public.active_market_partition_interests(array['market_partition_identity_v1:k1'], now()) $q$, '42501|permission denied', 'authenticated_cannot_read_global_path');
select s12s.expect_error($q$ select s12s.seed('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'planner_seed', 'k9', 'qp-9', now()) $q$, '42501|permission denied', 'authenticated_cannot_seed');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
select s12s.ok((select count(*) > 0 and bool_and(workspace_id = '20000000-0000-4000-8000-000000000002') from public.market_partition_interests), 'rls_other_member_isolated');
reset role;
set role anon;
select s12s.expect_error($q$ select count(*) from public.market_partition_interests $q$, '42501|permission denied', 'anon_cannot_read');
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
set role service_role;
select s12s.run('service_role_seeds', 'created', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'planner_seed', 'k-sr', 'qp-sr', now());
select s12s.ok(s12s.active('k-sr') = 1, 'service_role_seeds_and_reads');
reset role;

select 'ALL_CHECKS_PASSED';
