grant select, insert on public.query_yield_artifacts to service_role;

alter table public.query_yield_artifacts drop constraint if exists query_yield_artifacts_execution_status_check;
alter table public.query_yield_artifacts add constraint query_yield_artifacts_execution_status_check check (execution_status in ('completed_with_results','completed_zero_results','rate_limited','provider_error','budget_limited','execution_suppressed','disabled','unavailable','degraded'));
