-- Separate immutable execution attempts from reusable semantic identity.
-- Preserve all rows while ensuring only reusable artifacts occupy the cache slot.
alter table public.semantic_shadow_reasoning
  drop constraint if exists semantic_shadow_reasoning_workspace_id_product_id_conversation_id_fingerprint_key;

drop index if exists public.semantic_shadow_reasoning_success_fingerprint_key;

create unique index semantic_shadow_reasoning_reusable_fingerprint_key
  on public.semantic_shadow_reasoning (workspace_id, product_id, conversation_id, fingerprint)
  where execution_status in ('success', 'cache_hit');

-- This is an execution guard, not a job table. It is mutable lease state kept
-- separate from immutable semantic-shadow artifacts.
create table if not exists public.semantic_shadow_reasoning_claims (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  lease_token uuid not null default gen_random_uuid(),
  claimed_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  primary key (workspace_id, product_id, conversation_id, fingerprint),
  unique (lease_token),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade
);

create index if not exists semantic_shadow_reasoning_claims_expiry_idx
  on public.semantic_shadow_reasoning_claims (expires_at);

alter table public.semantic_shadow_reasoning_claims enable row level security;
revoke all on public.semantic_shadow_reasoning_claims from public, anon, authenticated, service_role;

create or replace function public.claim_semantic_shadow_reasoning(
  p_workspace_id uuid,
  p_product_id uuid,
  p_conversation_id uuid,
  p_fingerprint text,
  p_lease_token uuid,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed integer;
begin
  if p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception using errcode = '22023', message = 'invalid_semantic_shadow_lease_seconds';
  end if;

  insert into public.semantic_shadow_reasoning_claims (
    workspace_id, product_id, conversation_id, fingerprint, lease_token, claimed_at, expires_at
  ) values (
    p_workspace_id, p_product_id, p_conversation_id, p_fingerprint, p_lease_token,
    timezone('utc', now()), timezone('utc', now()) + make_interval(secs => p_lease_seconds)
  )
  on conflict (workspace_id, product_id, conversation_id, fingerprint) do update
    set lease_token = excluded.lease_token,
        claimed_at = excluded.claimed_at,
        expires_at = excluded.expires_at
    where semantic_shadow_reasoning_claims.expires_at <= timezone('utc', now())
  returning 1 into v_claimed;

  return coalesce(v_claimed = 1, false);
end;
$$;

create or replace function public.release_semantic_shadow_reasoning(
  p_workspace_id uuid,
  p_product_id uuid,
  p_conversation_id uuid,
  p_fingerprint text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.semantic_shadow_reasoning_claims
   where workspace_id = p_workspace_id
     and product_id = p_product_id
     and conversation_id = p_conversation_id
     and fingerprint = p_fingerprint
     and lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.claim_semantic_shadow_reasoning(uuid, uuid, uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_semantic_shadow_reasoning(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_semantic_shadow_reasoning(uuid, uuid, uuid, text, uuid, integer) to service_role;
grant execute on function public.release_semantic_shadow_reasoning(uuid, uuid, uuid, text, uuid) to service_role;
