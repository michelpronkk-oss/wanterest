create table if not exists public.query_yield_artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  query_plan_id text not null check (char_length(trim(query_plan_id)) between 1 and 180),
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  query_family text not null,
  demand_surface text not null,
  concept_keys jsonb not null default '[]'::jsonb,
  competitor_specific boolean not null default false,
  retrieval_window jsonb not null default '{}'::jsonb,
  pages_requested integer not null check (pages_requested between 1 and 3),
  pages_completed integer not null check (pages_completed between 0 and 3),
  cursor_continuation_count integer not null default 0 check (cursor_continuation_count between 0 and 2),
  continuation_stopped_reason text not null check (continuation_stopped_reason in ('no_cursor','page_cap_reached','provider_limit','zero_results','error')),
  execution_status text not null check (execution_status in ('completed_with_results','completed_zero_results','rate_limited','provider_error','budget_limited','degraded')),
  raw_items integer not null default 0 check (raw_items >= 0),
  normalized_items integer not null default 0 check (normalized_items >= 0),
  unique_conversations integer not null default 0 check (unique_conversations >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  source_budget_suppressed_count integer not null default 0 check (source_budget_suppressed_count >= 0),
  candidate_budget_suppressed_count integer not null default 0 check (candidate_budget_suppressed_count >= 0),
  evaluation_cap_suppressed_count integer not null default 0 check (evaluation_cap_suppressed_count >= 0),
  selected_count integer not null default 0 check (selected_count >= 0),
  evaluated_count integer not null default 0 check (evaluated_count >= 0),
  qualified_influenced_count integer not null default 0 check (qualified_influenced_count >= 0),
  weak_influenced_count integer not null default 0 check (weak_influenced_count >= 0),
  rejected_influenced_count integer not null default 0 check (rejected_influenced_count >= 0),
  estimated_cost_usd numeric check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, product_id, job_run_id, query_plan_id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade
);
create index if not exists query_yield_artifacts_product_source_surface_idx on public.query_yield_artifacts (workspace_id, product_id, source_key, demand_surface, created_at desc);
alter table public.query_yield_artifacts enable row level security;
create policy query_yield_artifacts_member_select on public.query_yield_artifacts for select to authenticated using (public.is_workspace_member(workspace_id));
revoke insert, update, delete on public.query_yield_artifacts from anon, authenticated;
