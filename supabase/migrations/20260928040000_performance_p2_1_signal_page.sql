-- P2.1: bounded, ranked Signals read model.
-- This is intentionally route-specific: it replaces the Signals list's
-- application-side ranking/N+1 reads without becoming a dashboard RPC.
create or replace function public.list_signal_page(
  p_workspace_id uuid,
  p_product_id uuid default null,
  p_lifecycle_status text default null,
  p_intent_type text default null,
  p_source_key text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_minimum_score numeric default null,
  p_query text default null,
  p_limit integer default 26,
  p_offset integer default 0
)
returns table (
  id uuid,
  workspace_id uuid,
  product_id uuid,
  product_match_id uuid,
  product_match_evaluation_id uuid,
  conversation_id uuid,
  source_key text,
  canonical_url text,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  intent_type text,
  excerpt text,
  why_it_matters text,
  tags jsonb,
  buyer_language jsonb,
  pain_themes jsonb,
  lifecycle_status text,
  evidence_node_id uuid,
  match_ranking_id uuid,
  opportunity_score numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id,
    s.workspace_id,
    s.product_id,
    s.product_match_id,
    s.product_match_evaluation_id,
    s.conversation_id,
    s.source_key,
    s.canonical_url,
    s.published_at,
    s.created_at,
    s.updated_at,
    s.intent_type,
    s.excerpt,
    s.why_it_matters,
    s.tags,
    s.buyer_language,
    s.pain_themes,
    s.lifecycle_status,
    s.evidence_node_id,
    s.match_ranking_id,
    r.opportunity_score
  from public.signals s
  join public.match_rankings r
    on r.workspace_id = s.workspace_id
   and r.id = s.match_ranking_id
  where s.workspace_id = p_workspace_id
    and (p_product_id is null or s.product_id = p_product_id)
    and (p_lifecycle_status is null and s.lifecycle_status in ('active', 'saved') or s.lifecycle_status = p_lifecycle_status)
    and (p_intent_type is null or s.intent_type = p_intent_type)
    and (p_source_key is null or s.source_key = p_source_key)
    and (p_from is null or coalesce(s.published_at, s.created_at) >= p_from)
    and (p_to is null or coalesce(s.published_at, s.created_at) <= p_to)
    and (p_minimum_score is null or r.opportunity_score >= p_minimum_score)
    and (
      nullif(trim(p_query), '') is null
      or s.excerpt ilike '%' || trim(p_query) || '%'
      or s.why_it_matters ilike '%' || trim(p_query) || '%'
    )
  order by r.opportunity_score desc, s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 26), 101))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_signal_page(uuid, uuid, text, text, text, timestamptz, timestamptz, numeric, text, integer, integer) from public;
grant execute on function public.list_signal_page(uuid, uuid, text, text, text, timestamptz, timestamptz, numeric, text, integer, integer) to service_role;
