-- Failed shadow attempts are immutable audit records but must not block a later
-- successful retry. Only a successful artifact is a reusable cache entry.
alter table public.semantic_shadow_reasoning
  drop constraint if exists semantic_shadow_reasoning_workspace_id_product_id_conversation_id_fingerprint_key;

create unique index if not exists semantic_shadow_reasoning_success_fingerprint_key
  on public.semantic_shadow_reasoning (workspace_id, product_id, conversation_id, fingerprint)
  where execution_status = 'success';
