-- Wanterest 12A.4: bounded cross-product routing shadow state.
-- Additive only. No backfill, provider call, evaluation, signal, or lifecycle
-- mutation is performed by this migration.

create table if not exists public.product_routing_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  routing_version text not null check (routing_version = 'cross_product_routing_v1'),
  profile_version text not null check (profile_version = 'product_routing_profile_v1'),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  profile_fingerprint text not null check (profile_fingerprint ~ '^[0-9a-f]{64}$'),
  route_fingerprint text not null check (route_fingerprint ~ '^[0-9a-f]{64}$'),
  route_type text not null check (route_type in ('direct', 'category', 'competitor')),
  route_status text not null check (route_status in ('eligible', 'reused', 'capped', 'skipped')),
  route_score numeric(5,4) not null check (route_score >= 0 and route_score <= 1),
  route_reason jsonb not null default '{}'::jsonb check (jsonb_typeof(route_reason) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  unique (workspace_id, product_id, conversation_id, routing_version, profile_version, evidence_fingerprint, profile_fingerprint),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade
);

create index if not exists product_routing_edges_conversation_idx
  on public.product_routing_edges (conversation_id, routing_version, updated_at desc);
create index if not exists product_routing_edges_product_idx
  on public.product_routing_edges (workspace_id, product_id, updated_at desc);
create index if not exists product_routing_edges_status_idx
  on public.product_routing_edges (workspace_id, route_status, updated_at desc);

drop trigger if exists product_routing_edges_updated_at on public.product_routing_edges;
create trigger product_routing_edges_updated_at
  before update on public.product_routing_edges
  for each row execute function public.updated_at_trigger();

alter table public.product_routing_edges enable row level security;
revoke all on public.product_routing_edges from public, anon, authenticated;
grant select on public.product_routing_edges to authenticated;
grant select, insert, update, delete on public.product_routing_edges to service_role;

drop policy if exists product_routing_edges_member_select on public.product_routing_edges;
create policy product_routing_edges_member_select on public.product_routing_edges
  for select to authenticated using (public.is_workspace_member(workspace_id));
