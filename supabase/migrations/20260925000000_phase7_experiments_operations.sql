-- Phase 7: action experiments, outcome measurement, and operational hardening.
-- Forward-only. Earlier migrations remain unchanged.

alter table public.job_runs drop constraint if exists job_runs_job_type_check;
alter table public.job_runs add constraint job_runs_job_type_check check (job_type in (
  'discover-source', 'normalize-source-items', 'dedupe-conversations',
  'analyze-conversations', 'match-product', 'rank-matches',
  'aggregate-demand', 'calculate-demand-gap', 'calculate-demand-drift',
  'backfill-demand-snapshots', 'generate-actions', 'build-digest',
  'process-billing-webhook', 'reconcile-billing-subscription',
  'aggregate-experiment-results', 'finalize-experiment', 'backfill-experiment-results'
));
alter table public.job_runs add column if not exists retry_after_at timestamptz;
alter table public.job_runs add column if not exists terminal_at timestamptz;
alter table public.job_runs drop constraint if exists job_runs_status_check;
alter table public.job_runs add constraint job_runs_status_check check (status in ('pending', 'running', 'succeeded', 'failed', 'failed_terminal', 'cancelled'));

alter table public.evidence_nodes drop constraint if exists evidence_nodes_node_type_check;
alter table public.evidence_nodes add constraint evidence_nodes_node_type_check check (node_type in (
  'raw_source_item', 'source_item', 'conversation', 'product', 'product_snapshot',
  'demand_profile', 'conversation_analysis', 'match', 'match_evaluation', 'ranking',
  'signal', 'demand_observation', 'demand_theme', 'theme_membership',
  'demand_snapshot', 'demand_snapshot_theme', 'demand_snapshot_phrase',
  'demand_snapshot_alternative', 'demand_snapshot_intent', 'demand_gap',
  'demand_drift', 'demand_drift_phrase', 'demand_drift_alternative',
  'action', 'action_variant', 'digest', 'digest_item', 'experiment',
  'experiment_variant', 'experiment_result'
));

alter table public.evidence_nodes drop constraint if exists evidence_nodes_entity_table_check;
alter table public.evidence_nodes add constraint evidence_nodes_entity_table_check check (entity_table in (
  'raw_source_items', 'source_items', 'conversations', 'products', 'product_snapshots',
  'demand_profiles', 'conversation_analysis', 'product_matches',
  'product_match_evaluations', 'match_rankings', 'signals', 'demand_observations',
  'demand_themes', 'theme_memberships', 'demand_snapshots', 'demand_snapshot_themes',
  'demand_snapshot_phrases', 'demand_snapshot_alternatives', 'demand_snapshot_intents',
  'demand_gaps', 'demand_drifts', 'demand_drift_phrases', 'demand_drift_alternatives',
  'actions', 'action_variants', 'digests', 'digest_items', 'experiments',
  'experiment_variants', 'experiment_results'
));

create table if not exists public.experiments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  action_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  experiment_type text not null check (experiment_type in (
    'messaging_test', 'cta_test', 'landing_page_test', 'positioning_test',
    'offer_test', 'onboarding_test'
  )),
  name text not null check (char_length(trim(name)) between 1 and 200),
  hypothesis text not null check (char_length(trim(hypothesis)) between 1 and 2_000),
  primary_metric text not null check (primary_metric in (
    'cta_click', 'signup_started', 'signup_completed', 'demo_requested',
    'checkout_started', 'purchase_completed'
  )),
  status text not null default 'draft' check (status in ('draft', 'ready', 'running', 'paused', 'completed', 'canceled')),
  traffic_allocation jsonb not null default '{}'::jsonb,
  target_page_path text check (target_page_path is null or char_length(trim(target_page_path)) between 1 and 500),
  target_key text check (target_key is null or char_length(trim(target_key)) between 1 and 200),
  assignment_method text not null default 'deterministic_hash_v1' check (assignment_method = 'deterministic_hash_v1'),
  min_sample_size integer not null default 100 check (min_sample_size between 1 and 1_000_000),
  created_by uuid not null references auth.users(id) on delete restrict,
  engine_version_id uuid references public.engine_versions(id) on delete restrict,
  current_result_id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, action_id) references public.actions(workspace_id, id) on delete restrict,
  check ((status in ('running', 'paused', 'completed') and started_at is not null) or status in ('draft', 'ready', 'canceled') or started_at is not null),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);

create index if not exists experiments_workspace_status_idx
  on public.experiments (workspace_id, status, created_at desc);

create table if not exists public.experiment_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  experiment_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  source_action_variant_id uuid,
  variant_key text not null check (variant_key ~ '^[a-z][a-z0-9_-]{0,80}$'),
  label text not null check (char_length(trim(label)) between 1 and 200),
  content jsonb not null,
  target jsonb not null default '{}'::jsonb,
  allocation_weight integer not null check (allocation_weight between 1 and 10000),
  is_control boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, experiment_id, id),
  unique (workspace_id, experiment_id, variant_key),
  foreign key (workspace_id, experiment_id) references public.experiments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, source_action_variant_id) references public.action_variants(workspace_id, id) on delete restrict
);

create index if not exists experiment_variants_experiment_idx
  on public.experiment_variants (workspace_id, experiment_id, allocation_weight desc);

create table if not exists public.experiment_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  experiment_id uuid not null,
  variant_id uuid not null,
  subject_key_hash text not null check (subject_key_hash ~ '^[0-9a-f]{64}$'),
  assignment_method text not null default 'deterministic_hash_v1' check (assignment_method = 'deterministic_hash_v1'),
  assigned_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, experiment_id, id),
  unique (experiment_id, subject_key_hash),
  foreign key (workspace_id, experiment_id) references public.experiments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, experiment_id, variant_id) references public.experiment_variants(workspace_id, experiment_id, id) on delete restrict
);

create index if not exists experiment_assignments_variant_idx
  on public.experiment_assignments (workspace_id, experiment_id, variant_id, assigned_at);

create table if not exists public.experiment_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  experiment_id uuid not null,
  variant_id uuid not null,
  assignment_id uuid not null,
  external_event_id text not null check (char_length(trim(external_event_id)) between 1 and 240),
  event_type text not null check (event_type in (
    'exposure', 'cta_click', 'signup_started', 'signup_completed',
    'demo_requested', 'checkout_started', 'purchase_completed'
  )),
  subject_key_hash text not null check (subject_key_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null,
  received_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, experiment_id, id),
  unique (experiment_id, external_event_id),
  foreign key (workspace_id, experiment_id) references public.experiments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, experiment_id, variant_id) references public.experiment_variants(workspace_id, experiment_id, id) on delete restrict,
  foreign key (workspace_id, experiment_id, assignment_id) references public.experiment_assignments(workspace_id, experiment_id, id) on delete restrict
);

create unique index if not exists experiment_exposures_subject_idx
  on public.experiment_events (experiment_id, subject_key_hash)
  where event_type = 'exposure';
create index if not exists experiment_events_result_idx
  on public.experiment_events (experiment_id, event_type, occurred_at);

create table if not exists public.experiment_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  experiment_id uuid not null,
  evidence_node_id uuid not null unique references public.evidence_nodes(id) on delete restrict,
  revision integer not null check (revision >= 1),
  calculation_version text not null check (char_length(trim(calculation_version)) between 1 and 120),
  primary_metric text not null,
  result_state text not null check (result_state in ('insufficient_data', 'collecting', 'directional', 'completed')),
  min_sample_size integer not null check (min_sample_size >= 1),
  total_assignments integer not null check (total_assignments >= 0),
  total_exposed_subjects integer not null check (total_exposed_subjects >= 0),
  variant_results jsonb not null,
  calculated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, experiment_id, revision),
  foreign key (workspace_id, experiment_id) references public.experiments(workspace_id, id) on delete cascade
);

alter table public.experiments drop constraint if exists experiments_current_result_fkey;
alter table public.experiments add constraint experiments_current_result_fkey
  foreign key (workspace_id, current_result_id)
  references public.experiment_results(workspace_id, id) on delete set null;

create table if not exists public.experiment_public_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  experiment_id uuid not null,
  public_key text not null check (public_key ~ '^[A-Za-z0-9_-]{20,160}$'),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  last_used_at timestamptz,
  unique (workspace_id, id),
  unique (public_key),
  unique (token_hash),
  foreign key (workspace_id, experiment_id) references public.experiments(workspace_id, id) on delete cascade
);

create unique index if not exists experiment_public_tokens_one_active_idx
  on public.experiment_public_tokens (experiment_id)
  where status = 'active';

create table if not exists public.source_controls (
  source_key text primary key check (source_key ~ '^[a-z][a-z0-9_-]*$'),
  state text not null default 'enabled' check (state in ('enabled', 'paused', 'disabled')),
  reason text,
  next_retry_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.rate_limit_buckets (
  bucket_key text primary key check (char_length(trim(bucket_key)) between 1 and 300),
  window_started_at timestamptz not null,
  hit_count integer not null check (hit_count >= 0),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.source_controls (source_key, state, reason)
values
  ('fixture', 'enabled', null),
  ('hacker-news', 'enabled', null),
  ('bluesky', 'enabled', null),
  ('reddit', 'disabled', 'approval_pending_or_credentials_missing')
on conflict (source_key) do nothing;

create or replace function public.prevent_phase7_append_only_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '55000', message = 'phase7_append_only_record';
end;
$$;

drop trigger if exists experiment_variants_append_only on public.experiment_variants;
create trigger experiment_variants_append_only before update or delete on public.experiment_variants
for each row execute function public.prevent_phase7_append_only_mutation();
drop trigger if exists experiment_assignments_append_only on public.experiment_assignments;
create trigger experiment_assignments_append_only before update or delete on public.experiment_assignments
for each row execute function public.prevent_phase7_append_only_mutation();
drop trigger if exists experiment_events_append_only on public.experiment_events;
create trigger experiment_events_append_only before update or delete on public.experiment_events
for each row execute function public.prevent_phase7_append_only_mutation();
drop trigger if exists experiment_results_append_only on public.experiment_results;
create trigger experiment_results_append_only before update or delete on public.experiment_results
for each row execute function public.prevent_phase7_append_only_mutation();

create or replace function public.validate_experiment_transition()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> old.status and not (
    (old.status = 'draft' and new.status in ('ready', 'canceled')) or
    (old.status = 'ready' and new.status in ('running', 'canceled')) or
    (old.status = 'running' and new.status in ('paused', 'completed', 'canceled')) or
    (old.status = 'paused' and new.status in ('running', 'completed', 'canceled')) or
    (old.status in ('completed', 'canceled') and false)
  ) then
    raise exception using errcode = '22023', message = 'invalid_experiment_transition';
  end if;
  if new.status = 'completed' and old.status not in ('running', 'paused') then
    raise exception using errcode = '22023', message = 'experiment_must_run_before_completion';
  end if;
  return new;
end;
$$;

drop trigger if exists experiments_validate_transition on public.experiments;
create trigger experiments_validate_transition before update on public.experiments
for each row execute function public.validate_experiment_transition();

drop trigger if exists experiments_updated_at on public.experiments;
create trigger experiments_updated_at before update on public.experiments
for each row execute function public.updated_at_trigger();
drop trigger if exists source_controls_updated_at on public.source_controls;
create trigger source_controls_updated_at before update on public.source_controls
for each row execute function public.updated_at_trigger();

create or replace function public.consume_phase7_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_row public.rate_limit_buckets;
  v_elapsed integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_parameters';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_bucket_key, 0));
  select * into v_row from public.rate_limit_buckets where bucket_key = p_bucket_key for update;
  if v_row.bucket_key is null or extract(epoch from (v_now - v_row.window_started_at)) >= p_window_seconds then
    insert into public.rate_limit_buckets(bucket_key, window_started_at, hit_count, updated_at)
    values (p_bucket_key, v_now, 1, v_now)
    on conflict (bucket_key) do update set window_started_at = v_now, hit_count = 1, updated_at = v_now;
    return query select true, p_limit - 1, 0;
    return;
  end if;
  v_elapsed := greatest(0, p_window_seconds - extract(epoch from (v_now - v_row.window_started_at))::integer);
  if v_row.hit_count >= p_limit then
    return query select false, 0, v_elapsed;
    return;
  end if;
  update public.rate_limit_buckets set hit_count = hit_count + 1, updated_at = v_now where bucket_key = p_bucket_key;
  return query select true, p_limit - v_row.hit_count - 1, 0;
end;
$$;

alter table public.experiments enable row level security;
alter table public.experiment_variants enable row level security;
alter table public.experiment_assignments enable row level security;
alter table public.experiment_events enable row level security;
alter table public.experiment_results enable row level security;
alter table public.experiment_public_tokens enable row level security;
alter table public.source_controls enable row level security;
alter table public.rate_limit_buckets enable row level security;

revoke all on public.experiment_assignments from anon, authenticated;
revoke all on public.experiment_events from anon, authenticated;
revoke all on public.experiment_public_tokens from anon, authenticated;
revoke all on public.source_controls from anon, authenticated;
revoke all on public.rate_limit_buckets from anon, authenticated;
revoke all on public.experiment_variants from anon, authenticated;
revoke all on public.experiment_results from anon, authenticated;
grant select on public.experiments to authenticated;
grant select on public.experiment_variants to authenticated;
grant select on public.experiment_results to authenticated;
grant all on public.experiments to service_role;
grant all on public.experiment_variants to service_role;
grant all on public.experiment_assignments to service_role;
grant all on public.experiment_events to service_role;
grant all on public.experiment_results to service_role;
grant all on public.experiment_public_tokens to service_role;
grant all on public.source_controls to service_role;
grant all on public.rate_limit_buckets to service_role;
revoke all on function public.consume_phase7_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_phase7_rate_limit(text, integer, integer) to service_role;

drop policy if exists experiments_member_select on public.experiments;
create policy experiments_member_select on public.experiments for select to authenticated
using (public.is_workspace_member(workspace_id));
drop policy if exists experiment_variants_member_select on public.experiment_variants;
create policy experiment_variants_member_select on public.experiment_variants for select to authenticated
using (public.is_workspace_member(workspace_id));
drop policy if exists experiment_results_member_select on public.experiment_results;
create policy experiment_results_member_select on public.experiment_results for select to authenticated
using (public.is_workspace_member(workspace_id));

comment on table public.experiments is 'Approved-action experiments with explicit lifecycle and immutable result snapshots.';
comment on table public.experiment_events is 'Append-only, idempotent public exposure and outcome events; raw subject identity is never persisted.';
comment on table public.experiment_public_tokens is 'Rotatable hashed public event-ingestion credentials; token secrets are never stored.';
comment on table public.source_controls is 'Operational source enable/pause/disable and lightweight circuit-breaker state.';
