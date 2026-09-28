-- P2.2B: select the exact newest comparable drift pair in PostgreSQL.
-- This preserves the legacy selector's semantics without loading all history
-- into the application. The function is read-only and service-role-only.
create or replace function public.find_latest_comparable_drift_pair(
  p_workspace_id uuid,
  p_product_id uuid,
  p_window_type text
)
returns table(current_snapshot_id uuid, previous_snapshot_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select
    current_snapshot.id as current_snapshot_id,
    previous_snapshot.id as previous_snapshot_id
  from public.demand_drifts as drift
  join public.demand_snapshots as current_snapshot
    on current_snapshot.workspace_id = drift.workspace_id
   and current_snapshot.id = drift.current_snapshot_id
   and current_snapshot.product_id = drift.product_id
  join public.demand_snapshots as previous_snapshot
    on previous_snapshot.workspace_id = drift.workspace_id
   and previous_snapshot.id = drift.previous_snapshot_id
   and previous_snapshot.product_id = drift.product_id
  where drift.workspace_id = p_workspace_id
    and drift.product_id = p_product_id
    and current_snapshot.window_type = p_window_type
    and previous_snapshot.window_type = current_snapshot.window_type
    and abs(extract(epoch from (current_snapshot.period_end - current_snapshot.period_start))
      - extract(epoch from (previous_snapshot.period_end - previous_snapshot.period_start))) <= 60
    and abs(extract(epoch from (previous_snapshot.period_end - current_snapshot.period_start))) <= 60
  group by
    current_snapshot.id,
    previous_snapshot.id,
    current_snapshot.period_end,
    current_snapshot.created_at,
    previous_snapshot.period_end,
    previous_snapshot.created_at
  order by
    current_snapshot.period_end desc,
    current_snapshot.created_at desc,
    previous_snapshot.period_end desc,
    previous_snapshot.created_at desc
  limit 1;
$$;

revoke all on function public.find_latest_comparable_drift_pair(uuid, uuid, text) from public;
revoke all on function public.find_latest_comparable_drift_pair(uuid, uuid, text) from anon, authenticated;
grant execute on function public.find_latest_comparable_drift_pair(uuid, uuid, text) to service_role;
