create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in (
    'discover-source',
    'normalize-source-items',
    'dedupe-conversations'
  )),
  workspace_id uuid references public.workspaces(id) on delete set null,
  product_id uuid,
  input_reference jsonb not null default '{}'::jsonb,
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 1 and 240),
  trigger_run_id text,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  trace_id text not null check (char_length(trim(trace_id)) between 1 and 120),
  error_code text,
  error_details jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (job_type, idempotency_key),
  check (completed_at is null or started_at is null or completed_at >= started_at)
);

create index if not exists job_runs_status_created_idx
  on public.job_runs (status, created_at);

create index if not exists job_runs_trace_idx
  on public.job_runs (trace_id);

create table if not exists public.evidence_nodes (
  id uuid primary key default gen_random_uuid(),
  node_type text not null check (node_type in ('raw_source_item', 'source_item', 'conversation')),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  entity_table text not null check (entity_table in ('raw_source_items', 'source_items', 'conversations')),
  entity_id uuid not null,
  content_hash text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (entity_table, entity_id)
);

create index if not exists evidence_nodes_type_idx
  on public.evidence_nodes (node_type, created_at);

create table if not exists public.raw_source_items (
  id uuid primary key default gen_random_uuid(),
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  external_id text not null check (char_length(trim(external_id)) between 1 and 500),
  fetched_at timestamptz not null,
  payload_json jsonb,
  payload_uri text,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  fetch_job_run_id uuid references public.job_runs(id) on delete set null,
  request_metadata jsonb not null default '{}'::jsonb,
  cursor_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (source_key, external_id, payload_hash),
  check (payload_json is not null or payload_uri is not null)
);

create index if not exists raw_source_items_source_fetched_idx
  on public.raw_source_items (source_key, fetched_at desc);

create index if not exists raw_source_items_external_idx
  on public.raw_source_items (source_key, external_id, fetched_at desc);

create table if not exists public.source_items (
  id uuid primary key default gen_random_uuid(),
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  external_id text not null check (char_length(trim(external_id)) between 1 and 500),
  external_conversation_id text,
  canonical_url text,
  author_external_id text,
  author_display_name text,
  author_profile_url text,
  title text,
  body text not null,
  published_at timestamptz,
  captured_at timestamptz not null,
  language text,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  latest_raw_source_item_id uuid not null references public.raw_source_items(id) on delete restrict,
  normalization_version text not null check (char_length(trim(normalization_version)) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'removed', 'unavailable')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source_key, external_id)
);

create index if not exists source_items_conversation_idx
  on public.source_items (source_key, external_conversation_id);

create index if not exists source_items_content_hash_idx
  on public.source_items (content_hash);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  conversation_key text not null unique check (char_length(trim(conversation_key)) between 1 and 500),
  primary_source_item_id uuid not null references public.source_items(id) on delete restrict,
  canonical_url text,
  author_external_id text,
  author_display_name text,
  author_profile_url text,
  title text,
  body text not null,
  published_at timestamptz,
  last_activity_at timestamptz,
  captured_at timestamptz not null,
  language text,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  canonicalization_version text not null check (char_length(trim(canonicalization_version)) between 1 and 120),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (last_activity_at is null or published_at is null or last_activity_at >= published_at)
);

create index if not exists conversations_activity_idx
  on public.conversations (last_activity_at desc nulls last, created_at desc);

create table if not exists public.conversation_source_items (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  source_item_id uuid not null references public.source_items(id) on delete restrict,
  relation_type text not null check (relation_type in ('provider_thread', 'canonical_url', 'content_hash', 'manual')),
  is_primary boolean not null default false,
  dedupe_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (conversation_id, source_item_id)
);

create unique index if not exists conversation_source_items_one_primary_idx
  on public.conversation_source_items (conversation_id)
  where is_primary;

create index if not exists conversation_source_items_source_idx
  on public.conversation_source_items (source_item_id);

create table if not exists public.source_health (
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  environment text not null check (environment in ('development', 'test', 'production')),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_latency_ms integer check (last_latency_ms is null or last_latency_ms >= 0),
  rate_limit_state jsonb not null default '{}'::jsonb,
  degradation_state text not null default 'healthy' check (degradation_state in ('healthy', 'degraded', 'blocked')),
  latest_error_code text,
  latest_error_summary text check (latest_error_summary is null or char_length(latest_error_summary) <= 1000),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (source_key, environment)
);

create or replace function public.prevent_raw_source_item_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception using errcode = '55000', message = 'raw_source_items_are_append_only';
end;
$$;

drop trigger if exists raw_source_items_append_only on public.raw_source_items;
create trigger raw_source_items_append_only
  before update or delete on public.raw_source_items
  for each row execute function public.prevent_raw_source_item_mutation();

drop trigger if exists job_runs_updated_at on public.job_runs;
create trigger job_runs_updated_at
  before update on public.job_runs
  for each row execute function public.updated_at_trigger();

drop trigger if exists source_items_updated_at on public.source_items;
create trigger source_items_updated_at
  before update on public.source_items
  for each row execute function public.updated_at_trigger();

drop trigger if exists conversations_updated_at on public.conversations;
create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function public.updated_at_trigger();

drop trigger if exists source_health_updated_at on public.source_health;
create trigger source_health_updated_at
  before update on public.source_health
  for each row execute function public.updated_at_trigger();

create table if not exists public.evidence_provenance (
  id uuid primary key default gen_random_uuid(),
  derived_evidence_node_id uuid not null references public.evidence_nodes(id) on delete cascade,
  source_evidence_node_id uuid not null references public.evidence_nodes(id) on delete restrict,
  relation_type text not null check (char_length(trim(relation_type)) between 1 and 120),
  weight numeric check (weight is null or weight >= 0),
  ordinal integer check (ordinal is null or ordinal >= 0),
  span jsonb,
  measurement jsonb,
  engine_version_id uuid references public.engine_versions(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  unique (derived_evidence_node_id, source_evidence_node_id, relation_type, ordinal),
  check (derived_evidence_node_id <> source_evidence_node_id)
);

create index if not exists evidence_provenance_source_idx
  on public.evidence_provenance (source_evidence_node_id, created_at);

create index if not exists evidence_provenance_derived_idx
  on public.evidence_provenance (derived_evidence_node_id, ordinal);

alter table public.job_runs enable row level security;
alter table public.evidence_nodes enable row level security;
alter table public.raw_source_items enable row level security;
alter table public.source_items enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_source_items enable row level security;
alter table public.source_health enable row level security;
alter table public.evidence_provenance enable row level security;

revoke all on public.job_runs from anon, authenticated;
revoke all on public.evidence_nodes from anon, authenticated;
revoke all on public.raw_source_items from anon, authenticated;
revoke all on public.source_items from anon, authenticated;
revoke all on public.conversations from anon, authenticated;
revoke all on public.conversation_source_items from anon, authenticated;
revoke all on public.source_health from anon, authenticated;
revoke all on public.evidence_provenance from anon, authenticated;

grant all on public.job_runs to service_role;
grant all on public.evidence_nodes to service_role;
grant all on public.raw_source_items to service_role;
grant all on public.source_items to service_role;
grant all on public.conversations to service_role;
grant all on public.conversation_source_items to service_role;
grant all on public.source_health to service_role;
grant all on public.evidence_provenance to service_role;
