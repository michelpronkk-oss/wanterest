create table if not exists public.semantic_shadow_reasoning (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  router_version text not null,
  reasoning_version text not null,
  prompt_schema_version text not null,
  route_decision text not null check (route_decision in ('deterministic_only','reject_without_llm','llm_reasoning')),
  route_reasons jsonb not null default '[]'::jsonb,
  deterministic_reasoning jsonb not null,
  llm_reasoning jsonb,
  validated_reasoning jsonb,
  merged_shadow_reasoning jsonb,
  evidence_validation jsonb not null default '{}'::jsonb,
  actual_qualification_status text,
  actual_reason_codes jsonb not null default '[]'::jsonb,
  shadow_qualification_status text,
  shadow_reason_codes jsonb not null default '[]'::jsonb,
  shadow_impact text not null default 'no_change',
  provider text,
  model text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  estimated_cost_usd numeric check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  execution_status text not null check (execution_status in ('success','cache_hit','provider_failed','schema_failed','evidence_failed','budget_skipped')),
  error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, product_id, conversation_id, fingerprint),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade
);
create index if not exists semantic_shadow_reasoning_fingerprint_idx on public.semantic_shadow_reasoning (workspace_id, product_id, conversation_id, fingerprint);
alter table public.semantic_shadow_reasoning enable row level security;
create policy semantic_shadow_reasoning_member_select on public.semantic_shadow_reasoning for select to authenticated using (public.is_workspace_member(workspace_id));
revoke insert, update, delete on public.semantic_shadow_reasoning from anon, authenticated;
