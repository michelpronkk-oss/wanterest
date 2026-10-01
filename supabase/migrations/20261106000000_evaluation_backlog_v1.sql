-- Private, bounded continuation of post-filter scan evaluation. No source payload is copied.
create table public.evaluation_backlog (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  source_item_id uuid not null references public.source_items(id) on delete restrict,
  demand_profile_id uuid not null,
  originating_job_run_id uuid references public.job_runs(id) on delete set null,
  selection_version text not null check (char_length(selection_version) between 1 and 120),
  selection_fingerprint text not null check (selection_fingerprint ~ '^[0-9a-f]{64}$'),
  conversation_content_hash text not null check (conversation_content_hash ~ '^[0-9a-f]{64}$'),
  source_content_hash text not null check (source_content_hash ~ '^[0-9a-f]{64}$'),
  classifier_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  matcher_engine_version_id uuid not null references public.engine_versions(id) on delete restrict,
  grounding_enabled boolean not null,
  -- Internal query provenance is needed to rerun the original evidence filters; no provider content.
  selection_provenance jsonb not null default '[]'::jsonb check (jsonb_typeof(selection_provenance) = 'array'),
  priority_score numeric(5, 4) not null check (priority_score between 0 and 1),
  selection_rank integer not null check (selection_rank > 0),
  status text not null default 'pending' check (status in ('pending', 'processing', 'retryable', 'succeeded', 'skipped', 'exhausted')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  available_at timestamptz not null default timezone('utc', now()),
  first_leased_at timestamptz,
  leased_at timestamptz,
  lease_owner uuid,
  completed_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{1,80}$'),
  evaluation_id uuid,
  signal_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, conversation_id, demand_profile_id, selection_fingerprint),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, demand_profile_id) references public.demand_profiles(workspace_id, id) on delete restrict,
  foreign key (workspace_id, evaluation_id) references public.product_match_evaluations(workspace_id, id) on delete set null (evaluation_id),
  foreign key (workspace_id, signal_id) references public.signals(workspace_id, id) on delete set null (signal_id),
  check ((status = 'processing') = (leased_at is not null and lease_owner is not null)),
  check ((attempt_count = 0) = (first_leased_at is null)),
  check (status not in ('succeeded', 'skipped', 'exhausted') or completed_at is not null)
);

create index evaluation_backlog_claim_idx on public.evaluation_backlog
  (status, available_at, priority_score desc, created_at, id)
  where status in ('pending', 'retryable', 'processing');
create index evaluation_backlog_product_idx on public.evaluation_backlog
  (workspace_id, product_id, created_at desc);
create index evaluation_backlog_completed_idx on public.evaluation_backlog
  (completed_at desc) where status in ('succeeded', 'skipped', 'exhausted');

alter table public.evaluation_backlog enable row level security;
revoke all on table public.evaluation_backlog from public, anon, authenticated, service_role;
grant select, insert, update on table public.evaluation_backlog to service_role;

create function public.claim_evaluation_backlog(p_owner uuid, p_limit integer)
returns setof public.evaluation_backlog
language plpgsql security invoker set search_path = ''
as $$
begin
  if p_owner is null or p_limit is null or p_limit < 1 or p_limit > 10 then
    raise exception 'invalid_evaluation_backlog_claim';
  end if;

  update public.evaluation_backlog
     set status = 'exhausted', completed_at = timezone('utc', now()),
         last_error_code = 'STALE_LEASE_EXHAUSTED', leased_at = null,
         lease_owner = null, updated_at = timezone('utc', now())
   where status = 'processing' and attempt_count >= 3
     and leased_at < timezone('utc', now()) - interval '20 minutes';

  return query
  with claimable as (
    select b.id from public.evaluation_backlog b
     where ((b.status in ('pending', 'retryable') and b.available_at <= timezone('utc', now()))
        or (b.status = 'processing' and b.attempt_count < 3
            and b.leased_at < timezone('utc', now()) - interval '20 minutes'))
     order by b.priority_score desc, b.created_at, b.id
     limit p_limit for update skip locked
  )
  update public.evaluation_backlog b
     set status = 'processing', attempt_count = b.attempt_count + 1,
         first_leased_at = coalesce(b.first_leased_at, timezone('utc', now())),
         leased_at = timezone('utc', now()), lease_owner = p_owner,
         completed_at = null, updated_at = timezone('utc', now())
    from claimable c where b.id = c.id
  returning b.*;
end;
$$;

revoke all on function public.claim_evaluation_backlog(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_evaluation_backlog(uuid, integer) to service_role;

create function public.evaluation_backlog_summary()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'enqueued', count(*),
    'pending', count(*) filter (where b.status = 'pending'),
    'processing', count(*) filter (where b.status = 'processing'),
    'succeeded', count(*) filter (where b.status = 'succeeded'),
    'skipped', count(*) filter (where b.status = 'skipped'),
    'failed', count(*) filter (where b.status in ('retryable', 'exhausted')),
    'exhausted', count(*) filter (where b.status = 'exhausted'),
    'oldest_pending_at', min(b.created_at) filter (where b.status in ('pending', 'retryable')),
    'evaluated_24h', count(*) filter (where b.status = 'succeeded' and b.completed_at >= timezone('utc', now()) - interval '24 hours'),
    'qualified_24h', count(*) filter (where b.status = 'succeeded' and e.decision = 'qualified' and b.completed_at >= timezone('utc', now()) - interval '24 hours'),
    'evaluated_hour', count(*) filter (where b.status = 'succeeded' and b.completed_at >= timezone('utc', now()) - interval '1 hour'),
    'qualified_hour', count(*) filter (where b.status = 'succeeded' and e.decision = 'qualified' and b.completed_at >= timezone('utc', now()) - interval '1 hour'),
    'average_wait_seconds', avg(extract(epoch from b.first_leased_at - b.created_at)) filter (where b.status = 'succeeded'),
    'average_attempts', avg(b.attempt_count) filter (where b.status in ('succeeded', 'skipped', 'exhausted'))
  )
  from public.evaluation_backlog b
  left join public.product_match_evaluations e on e.workspace_id = b.workspace_id and e.id = b.evaluation_id;
$$;

revoke all on function public.evaluation_backlog_summary() from public, anon, authenticated;
grant execute on function public.evaluation_backlog_summary() to service_role;
