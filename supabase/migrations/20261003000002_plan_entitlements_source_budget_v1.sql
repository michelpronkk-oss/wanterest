-- Plan Entitlements + Source Budget Matrix v1.
-- Forward-only; Wanterest's normalized catalog remains the capability authority.

insert into public.plan_entitlements (plan_catalog_id, capability_key, value_type, value_json)
select pc.id, v.capability_key, v.value_type, v.value_json::jsonb
from public.plan_catalog pc
cross join (values
  ('products_max', 'integer', '1'), ('manual_scans_monthly', 'integer', '3'),
  ('demand_drift_days', 'integer', '0'), ('experiments_max', 'integer', '0'),
  ('team_members', 'integer', '1'), ('monitoring_enabled', 'boolean', 'false'),
  ('intelligence_cycles_per_day', 'integer', '0'), ('intelligence_cycle_interval_minutes', 'integer', '0'),
  ('deep_refreshes_per_week', 'integer', '0'), ('intelligence_cycle_max_sources', 'integer', '0'),
  ('intelligence_cycle_query_budget', 'integer', '0'), ('intelligence_cycle_candidate_budget', 'integer', '0'),
  ('deep_refresh_max_sources', 'integer', '0'), ('deep_refresh_query_budget', 'integer', '0'),
  ('deep_refresh_candidate_budget', 'integer', '0'), ('x_max_requests_per_cycle', 'integer', '0'),
  ('x_max_billable_posts_per_cycle', 'integer', '0'), ('x_max_requests_per_deep_refresh', 'integer', '0'),
  ('x_max_billable_posts_per_deep_refresh', 'integer', '0'), ('x_daily_budget_usd', 'decimal', '0'),
  ('digest_enabled', 'boolean', 'false'), ('priority_alerts_enabled', 'boolean', 'false')
) as v(capability_key, value_type, value_json)
where pc.plan_code = 'free' and pc.version = 1
on conflict (plan_catalog_id, capability_key) do update
set value_type = excluded.value_type, value_json = excluded.value_json;

insert into public.plan_entitlements (plan_catalog_id, capability_key, value_type, value_json)
select pc.id, v.capability_key, v.value_type, v.value_json::jsonb
from public.plan_catalog pc
cross join (values
  ('products_max', 'integer', '3'), ('manual_scans_monthly', 'integer', '30'),
  ('demand_drift_days', 'integer', '30'), ('experiments_max', 'integer', '2'),
  ('team_members', 'integer', '1'), ('monitoring_enabled', 'boolean', 'true'),
  ('intelligence_cycles_per_day', 'integer', '4'), ('intelligence_cycle_interval_minutes', 'integer', '360'),
  ('deep_refreshes_per_week', 'integer', '1'), ('intelligence_cycle_max_sources', 'integer', '4'),
  ('intelligence_cycle_query_budget', 'integer', '5'), ('intelligence_cycle_candidate_budget', 'integer', '30'),
  ('deep_refresh_max_sources', 'integer', '6'), ('deep_refresh_query_budget', 'integer', '10'),
  ('deep_refresh_candidate_budget', 'integer', '60'), ('x_max_requests_per_cycle', 'integer', '1'),
  ('x_max_billable_posts_per_cycle', 'integer', '10'), ('x_max_requests_per_deep_refresh', 'integer', '2'),
  ('x_max_billable_posts_per_deep_refresh', 'integer', '20'), ('x_daily_budget_usd', 'decimal', '0.5'),
  ('digest_enabled', 'boolean', 'true'), ('priority_alerts_enabled', 'boolean', 'false')
) as v(capability_key, value_type, value_json)
where pc.plan_code = 'pro' and pc.version = 1
on conflict (plan_catalog_id, capability_key) do update
set value_type = excluded.value_type, value_json = excluded.value_json;

insert into public.plan_entitlements (plan_catalog_id, capability_key, value_type, value_json)
select pc.id, v.capability_key, v.value_type, v.value_json::jsonb
from public.plan_catalog pc
cross join (values
  ('products_max', 'integer', '10'), ('manual_scans_monthly', 'integer', '100'),
  ('demand_drift_days', 'integer', '90'), ('experiments_max', 'integer', '10'),
  ('team_members', 'integer', '3'), ('monitoring_enabled', 'boolean', 'true'),
  ('intelligence_cycles_per_day', 'integer', '12'), ('intelligence_cycle_interval_minutes', 'integer', '120'),
  ('deep_refreshes_per_week', 'integer', '3'), ('intelligence_cycle_max_sources', 'integer', '6'),
  ('intelligence_cycle_query_budget', 'integer', '8'), ('intelligence_cycle_candidate_budget', 'integer', '50'),
  ('deep_refresh_max_sources', 'integer', '8'), ('deep_refresh_query_budget', 'integer', '12'),
  ('deep_refresh_candidate_budget', 'integer', '100'), ('x_max_requests_per_cycle', 'integer', '2'),
  ('x_max_billable_posts_per_cycle', 'integer', '20'), ('x_max_requests_per_deep_refresh', 'integer', '4'),
  ('x_max_billable_posts_per_deep_refresh', 'integer', '40'), ('x_daily_budget_usd', 'decimal', '2'),
  ('digest_enabled', 'boolean', 'true'), ('priority_alerts_enabled', 'boolean', 'true')
) as v(capability_key, value_type, value_json)
where pc.plan_code = 'growth' and pc.version = 1
on conflict (plan_catalog_id, capability_key) do update
set value_type = excluded.value_type, value_json = excluded.value_json;

-- Materialize the converged catalog into current workspace revisions.
do $$
declare
  v_workspace record;
  v_revision integer;
  v_now timestamptz := timezone('utc', now());
begin
  for v_workspace in
    select distinct on (workspace_id) workspace_id, plan_catalog_id, source_subscription_id
      from public.workspace_entitlements
     where effective_to is null
     order by workspace_id, revision desc
  loop
    select coalesce(max(revision), 0) + 1 into v_revision
      from public.workspace_entitlements
     where workspace_id = v_workspace.workspace_id;
    update public.workspace_entitlements
       set effective_to = v_now
     where workspace_id = v_workspace.workspace_id and effective_to is null;
    insert into public.workspace_entitlements (
      workspace_id, plan_catalog_id, capability_key, value_type, value_json,
      revision, effective_from, source_subscription_id, metadata
    )
    select v_workspace.workspace_id, pe.plan_catalog_id, pe.capability_key,
           pe.value_type, pe.value_json, v_revision, v_now, v_workspace.source_subscription_id, pe.metadata
      from public.plan_entitlements pe
     where pe.plan_catalog_id = v_workspace.plan_catalog_id;
  end loop;
end;
$$;
