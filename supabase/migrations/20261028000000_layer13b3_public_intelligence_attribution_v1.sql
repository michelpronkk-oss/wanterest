-- Layer 13B.3: public intelligence destinations and attribution-ready DTOs.
-- NOT RUNTIME VALIDATED: intentionally not applied by this implementation task.
-- The existing /share/[slug] route remains the single canonical destination.

drop function if exists public.get_public_share_card(text);

create or replace function public.get_public_share_card(p_public_slug text)
returns table (
  public_slug text, variant text, display_name text, headline text, identity_label text, identity_number integer,
  tone text, is_permanent boolean, card_kind text, claim_type text, claim text, evidence text, interpretation text,
  evidence_strength text, context_label text, freshness_label text, observation_period text, uncertainty text,
  source_label text, source_url text, published_at timestamptz,
  access_mode text, cta_label text, cta_href text
)
language sql stable security definer set search_path = public
as $$
  select publication.public_slug, publication.variant,
    nullif(coalesce(publication.snapshot ->> 'displayName', publication.snapshot ->> 'display_name'), ''),
    nullif(coalesce(publication.snapshot ->> 'headline', publication.snapshot ->> 'headline'), ''),
    coalesce(publication.snapshot ->> 'identityLabel', publication.snapshot ->> 'identity_label'),
    case when coalesce(publication.snapshot ->> 'identityNumber', publication.snapshot ->> 'identity_number', '') ~ '^[0-9]+$' then (coalesce(publication.snapshot ->> 'identityNumber', publication.snapshot ->> 'identity_number'))::integer else null end,
    coalesce(publication.snapshot ->> 'tone', 'neutral'),
    coalesce((coalesce(publication.snapshot ->> 'isPermanent', publication.snapshot ->> 'is_permanent'))::boolean, false),
    coalesce(publication.snapshot ->> 'cardKind', publication.snapshot ->> 'card_kind', 'identity'),
    coalesce(publication.snapshot ->> 'claimType', publication.snapshot ->> 'claim_type', 'observation'),
    nullif(coalesce(publication.snapshot ->> 'claim', ''), ''),
    nullif(coalesce(publication.snapshot ->> 'evidence', ''), ''),
    nullif(coalesce(publication.snapshot ->> 'interpretation', ''), ''),
    nullif(coalesce(publication.snapshot ->> 'evidenceStrength', publication.snapshot ->> 'evidence_strength', ''), ''),
    nullif(coalesce(publication.snapshot ->> 'contextLabel', publication.snapshot ->> 'context_label', ''), ''),
    nullif(coalesce(publication.snapshot ->> 'freshnessLabel', publication.snapshot ->> 'freshness_label', ''), ''),
    nullif(coalesce(publication.snapshot ->> 'observationPeriod', publication.snapshot ->> 'observation_period', ''), ''),
    nullif(coalesce(publication.snapshot ->> 'uncertainty', ''), ''),
    nullif(coalesce(publication.snapshot ->> 'sourceLabel', publication.snapshot ->> 'source_label', ''), ''),
    case when coalesce(publication.snapshot ->> 'sourceUrl', publication.snapshot ->> 'source_url', '') ~ '^https?://' then nullif(coalesce(publication.snapshot ->> 'sourceUrl', publication.snapshot ->> 'source_url', ''), '') else null end,
    publication.published_at, access.mode,
    case when access.mode = 'open' then 'Start free' else 'Request access' end,
    case when access.mode = 'open' then '/signup?source=share_card'
         when referral.public_code is not null then '/r/' || referral.public_code || '?source=share_card'
         else '/waitlist?source=share_card' end
  from public.share_card_publications as publication
  cross join public.product_access_mode as access
  left join public.waitlist_priority_access as priority
    on priority.waitlist_application_id = publication.waitlist_application_id and priority.status = 'granted'
  left join public.waitlist_referral_identities as referral
    on referral.waitlist_application_id = publication.waitlist_application_id
  left join public.workspace_public_cohort_profiles as profile
    on profile.workspace_id = publication.workspace_id and profile.pass_visible = true
  left join public.products as product
    on product.workspace_id = publication.workspace_id and product.id = publication.product_id and product.status = 'active'
  left join public.signals as signal
    on publication.variant = 'SIGNAL'
   and signal.id = publication.source_id and signal.workspace_id = publication.workspace_id
   and signal.product_id = publication.product_id and signal.lifecycle_status in ('active', 'saved')
   and signal.evidence_node_id = publication.source_evidence_node_id
  left join public.demand_gaps as gap
    on publication.variant = 'DEMAND_GAP'
   and gap.id = publication.source_id and gap.workspace_id = publication.workspace_id
   and gap.product_id = publication.product_id and gap.evidence_node_id = publication.source_evidence_node_id
  left join public.demand_drifts as drift
    on publication.variant = 'DEMAND_DRIFT'
   and drift.id = publication.source_id and drift.workspace_id = publication.workspace_id
   and drift.product_id = publication.product_id and drift.evidence_node_id = publication.source_evidence_node_id
  where publication.public_slug = p_public_slug
    and publication.publication_state = 'published'
    and (publication.variant <> 'PRIORITY_ACCESS' or priority.id is not null)
    and (
      publication.variant in ('EARLY_ACCESS', 'PRIORITY_ACCESS')
      or (publication.variant in ('FOUNDING_25', 'EARLY_100') and profile.id is not null)
      or (publication.variant = 'SIGNAL' and product.id is not null and signal.id is not null)
      or (publication.variant = 'DEMAND_GAP' and product.id is not null and gap.id is not null)
      or (publication.variant = 'DEMAND_DRIFT' and product.id is not null and drift.id is not null)
    );
$$;

revoke all on function public.get_public_share_card(text) from public, anon, authenticated;
grant execute on function public.get_public_share_card(text) to anon, authenticated, service_role;

comment on function public.get_public_share_card(text) is 'Narrow, noindex public share DTO for explicitly published identities and intelligence; revalidates consent, lifecycle, product, evidence, and current access-mode CTA on every request.';
