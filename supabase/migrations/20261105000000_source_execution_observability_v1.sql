-- Source execution provenance and operations telemetry, v1.
-- Stores stable row identifiers, bounded query dimensions and execution counts only.
-- Provider queries, cursors, author data and raw payloads are intentionally excluded.

create table public.source_query_executions (
  id uuid primary key,
  execution_key text not null unique check (execution_key ~ '^[0-9a-f]{64}$'),
  parent_job_run_id uuid references public.job_runs(id) on delete set null,
  -- Planner IDs include normalized search text; persist only a stable fingerprint.
  query_plan_fingerprint text not null check (query_plan_fingerprint ~ '^[0-9a-f]{64}$'),
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  query_family text not null check (char_length(query_family) between 1 and 80),
  demand_surface text not null check (char_length(demand_surface) between 1 and 80),
  pages_requested smallint not null check (pages_requested between 1 and 3),
  pages_completed smallint not null check (pages_completed between 0 and 3),
  continuation_count smallint not null default 0 check (continuation_count between 0 and 2),
  stop_reason text not null check (stop_reason in ('no_cursor', 'page_cap_reached', 'provider_limit', 'zero_results', 'error')),
  execution_status text not null check (execution_status in ('completed_with_results', 'completed_zero_results', 'rate_limited', 'provider_error', 'budget_limited', 'execution_suppressed', 'disabled', 'unavailable', 'degraded')),
  provider_results_returned integer not null default 0 check (provider_results_returned >= 0),
  raw_snapshots_accepted integer not null default 0 check (raw_snapshots_accepted >= 0),
  raw_snapshots_inserted integer not null default 0 check (raw_snapshots_inserted >= 0),
  raw_snapshots_duplicate integer not null default 0 check (raw_snapshots_duplicate >= 0),
  unique_provider_items integer not null default 0 check (unique_provider_items >= 0),
  duplicate_provider_items integer not null default 0 check (duplicate_provider_items >= 0),
  normalized_items integer not null default 0 check (normalized_items >= 0),
  unique_roots integer not null default 0 check (unique_roots >= 0),
  duplicate_roots integer not null default 0 check (duplicate_roots >= 0),
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_-]{1,80}$'),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  check (completed_at >= started_at),
  check (pages_completed <= pages_requested),
  check (provider_results_returned >= raw_snapshots_accepted),
  check (raw_snapshots_accepted >= unique_provider_items),
  check (unique_provider_items + duplicate_provider_items <= raw_snapshots_accepted),
  check (normalized_items >= unique_roots)
);

create index source_query_executions_parent_created_idx
  on public.source_query_executions (parent_job_run_id, created_at desc);
create index source_query_executions_source_created_idx
  on public.source_query_executions (source_key, created_at desc);

create table public.source_query_execution_pages (
  id uuid primary key,
  execution_id uuid not null references public.source_query_executions(id) on delete cascade,
  page_number smallint not null check (page_number between 1 and 3),
  source_job_run_id uuid references public.job_runs(id) on delete set null,
  cursor_requested boolean not null,
  provider_results_returned integer not null default 0 check (provider_results_returned >= 0),
  raw_snapshots_accepted integer not null default 0 check (raw_snapshots_accepted >= 0),
  raw_snapshots_inserted integer not null default 0 check (raw_snapshots_inserted >= 0),
  raw_snapshots_duplicate integer not null default 0 check (raw_snapshots_duplicate >= 0),
  normalized_items integer not null default 0 check (normalized_items >= 0),
  unique_provider_items integer not null default 0 check (unique_provider_items >= 0),
  duplicate_provider_items integer not null default 0 check (duplicate_provider_items >= 0),
  unique_roots integer not null default 0 check (unique_roots >= 0),
  duplicate_roots integer not null default 0 check (duplicate_roots >= 0),
  continuation_available boolean not null,
  continuation_followed boolean not null,
  stop_reason text not null check (stop_reason in ('continuation_followed', 'no_cursor', 'page_cap_reached', 'provider_limit', 'zero_results', 'error')),
  rate_limit_remaining integer check (rate_limit_remaining is null or rate_limit_remaining >= 0),
  retry_after_ms integer check (retry_after_ms is null or retry_after_ms >= 0),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  duration_ms integer not null check (duration_ms >= 0),
  observed_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (execution_id, page_number),
  check (not continuation_followed or continuation_available),
  check (provider_results_returned >= raw_snapshots_accepted),
  check (raw_snapshots_accepted >= unique_provider_items),
  check (unique_provider_items + duplicate_provider_items <= raw_snapshots_accepted),
  check (normalized_items >= unique_roots)
);

create index source_query_execution_pages_execution_idx
  on public.source_query_execution_pages (execution_id, page_number);
create index source_query_execution_pages_job_idx
  on public.source_query_execution_pages (source_job_run_id);

create table public.source_query_result_attributions (
  id uuid primary key,
  page_id uuid not null references public.source_query_execution_pages(id) on delete cascade,
  result_ordinal integer not null check (result_ordinal between 1 and 500),
  raw_source_item_id uuid references public.raw_source_items(id) on delete set null,
  source_item_id uuid references public.source_items(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  raw_snapshot_inserted boolean,
  first_provider_item_in_execution boolean not null,
  first_root_in_execution boolean not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (page_id, result_ordinal),
  unique (id, conversation_id)
);

create index source_query_result_attributions_page_idx
  on public.source_query_result_attributions (page_id, result_ordinal);
create index source_query_result_attributions_conversation_idx
  on public.source_query_result_attributions (conversation_id) where conversation_id is not null;

create table public.product_query_result_outcomes (
  id uuid primary key,
  source_query_result_attribution_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  match_job_run_id uuid not null references public.job_runs(id) on delete restrict,
  attempt_number integer not null check (attempt_number >= 1),
  selected boolean not null,
  evaluated boolean not null,
  qualification_status text check (qualification_status is null or qualification_status in ('qualified', 'weak_candidate', 'rejected')),
  product_match_evaluation_id uuid,
  signal_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (source_query_result_attribution_id, conversation_id)
    references public.source_query_result_attributions(id, conversation_id) on delete cascade,
  foreign key (workspace_id, product_id)
    references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, product_match_evaluation_id)
    references public.product_match_evaluations(workspace_id, id) on delete set null (product_match_evaluation_id),
  foreign key (workspace_id, signal_id)
    references public.signals(workspace_id, id) on delete set null (signal_id),
  unique (workspace_id, product_id, match_job_run_id, attempt_number, source_query_result_attribution_id),
  check (evaluated or qualification_status is null),
  check (evaluated or product_match_evaluation_id is null),
  check (product_match_evaluation_id is null or evaluated)
);

create index product_query_result_outcomes_product_idx
  on public.product_query_result_outcomes (workspace_id, product_id, created_at desc);
create index product_query_result_outcomes_match_job_idx
  on public.product_query_result_outcomes (match_job_run_id, attempt_number);

comment on table public.source_query_executions is
  'Server-only aggregate telemetry for one bounded provider query execution; contains no query text, cursor, author data, or provider payload.';
comment on table public.source_query_execution_pages is
  'Server-only per-page counts, cursor-presence flags, stop reason, rate-limit remainder, retries and runtime; cursor contents are never stored.';
comment on table public.source_query_result_attributions is
  'Server-only stable-ID links from query page results to raw snapshot, normalized item and canonical conversation; no content or author fields.';
comment on table public.product_query_result_outcomes is
  'Server-only, workspace-scoped links from query result attribution through match job, qualification evaluation and materialized signal.';

alter table public.source_query_executions enable row level security;
alter table public.source_query_execution_pages enable row level security;
alter table public.source_query_result_attributions enable row level security;
alter table public.product_query_result_outcomes enable row level security;

revoke all on public.source_query_executions, public.source_query_execution_pages,
  public.source_query_result_attributions, public.product_query_result_outcomes
  from public, anon, authenticated, service_role;
grant select, insert, update on public.source_query_executions,
  public.source_query_execution_pages, public.source_query_result_attributions,
  public.product_query_result_outcomes to service_role;
