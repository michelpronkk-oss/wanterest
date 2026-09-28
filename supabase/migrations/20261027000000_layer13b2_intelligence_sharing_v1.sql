-- Layer 13B.2: evidence-backed intelligence sharing.
-- NOT RUNTIME VALIDATED: this migration is intentionally not applied by this task.
-- It extends the 13B.1 publication engine; it does not alter P2.2B or production.

alter table public.share_card_publications
  add column if not exists product_id uuid,
  add column if not exists source_id uuid,
  add column if not exists source_evidence_node_id uuid references public.evidence_nodes(id) on delete restrict;

alter table public.share_card_publications
  drop constraint if exists share_card_publications_variant_check,
  add constraint share_card_publications_variant_check check (variant in ('EARLY_ACCESS', 'PRIORITY_ACCESS', 'FOUNDING_25', 'EARLY_100', 'SIGNAL', 'DEMAND_GAP', 'DEMAND_DRIFT')),
  add constraint share_card_publications_product_fk foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  add constraint share_card_publications_intelligence_shape_check check (
    (variant in ('SIGNAL', 'DEMAND_GAP', 'DEMAND_DRIFT')) = (product_id is not null and source_id is not null and source_evidence_node_id is not null)
  ),
  add constraint share_card_publications_applicant_identity_check check (
    waitlist_application_id is null or variant in ('EARLY_ACCESS', 'PRIORITY_ACCESS')
  );

drop index if exists public.share_card_publications_workspace_variant_idx;
create unique index if not exists share_card_publications_workspace_identity_variant_idx
  on public.share_card_publications (workspace_id, variant)
  where workspace_id is not null and variant in ('FOUNDING_25', 'EARLY_100');
create unique index if not exists share_card_publications_workspace_intelligence_source_idx
  on public.share_card_publications (workspace_id, product_id, variant, source_id)
  where workspace_id is not null and variant in ('SIGNAL', 'DEMAND_GAP', 'DEMAND_DRIFT');

drop function if exists public.publish_share_card(uuid, uuid, text, text, jsonb, uuid);
drop function if exists public.revoke_share_card(uuid, uuid, text, uuid);
drop function if exists public.get_share_card_publications(uuid, uuid);

create or replace function public.publish_share_card(
  p_workspace_id uuid,
  p_waitlist_application_id uuid,
  p_variant text,
  p_public_slug text,
  p_snapshot jsonb,
  p_actor_user_id uuid default null,
  p_product_id uuid default null,
  p_source_id uuid default null,
  p_source_evidence_node_id uuid default null
)
returns public.share_card_publications
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_existing public.share_card_publications;
  v_application public.waitlist_applications;
  v_priority public.waitlist_priority_access;
  v_membership public.workspace_cohort_memberships;
  v_profile public.workspace_public_cohort_profiles;
  v_product public.products;
  v_signal public.signals;
  v_gap public.demand_gaps;
  v_drift public.demand_drifts;
  v_row public.share_card_publications;
begin
  if not public.is_service_role() then raise exception using errcode = '42501', message = 'share_card_service_role_required'; end if;
  if ((p_workspace_id is not null)::integer + (p_waitlist_application_id is not null)::integer) <> 1 then raise exception using errcode = '22023', message = 'share_card_owner_required'; end if;
  if p_variant not in ('EARLY_ACCESS', 'PRIORITY_ACCESS', 'FOUNDING_25', 'EARLY_100', 'SIGNAL', 'DEMAND_GAP', 'DEMAND_DRIFT') then raise exception using errcode = '22023', message = 'share_card_variant_invalid'; end if;
  if p_public_slug is null or p_public_slug !~ '^[A-Za-z0-9_-]{32,96}$' then raise exception using errcode = '22023', message = 'share_card_slug_invalid'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then raise exception using errcode = '22023', message = 'share_card_snapshot_invalid'; end if;
  if (p_variant in ('SIGNAL', 'DEMAND_GAP', 'DEMAND_DRIFT')) and p_workspace_id is null then raise exception using errcode = '42501', message = 'share_card_intelligence_workspace_required'; end if;

  if p_waitlist_application_id is not null then
    if p_variant not in ('EARLY_ACCESS', 'PRIORITY_ACCESS') or p_product_id is not null or p_source_id is not null or p_source_evidence_node_id is not null then raise exception using errcode = '42501', message = 'share_card_applicant_identity_only'; end if;
    select * into v_application from public.waitlist_applications where id = p_waitlist_application_id and email_verification_status = 'verified' and early_access_number is not null;
    if not found then raise exception using errcode = '42501', message = 'share_card_verified_applicant_required'; end if;
    if p_variant = 'PRIORITY_ACCESS' then
      select * into v_priority from public.waitlist_priority_access where waitlist_application_id = p_waitlist_application_id and status = 'granted';
      if not found then raise exception using errcode = '42501', message = 'share_card_priority_not_active'; end if;
    end if;
  elsif p_variant in ('FOUNDING_25', 'EARLY_100') then
    select * into v_membership from public.workspace_cohort_memberships where workspace_id = p_workspace_id;
    if not found or (p_variant = 'FOUNDING_25' and v_membership.cohort <> 'founding_25') or (p_variant = 'EARLY_100' and v_membership.cohort <> 'early_100') then raise exception using errcode = '42501', message = 'share_card_authoritative_membership_required'; end if;
    select * into v_profile from public.workspace_public_cohort_profiles where workspace_id = p_workspace_id and cohort_membership_id = v_membership.id and pass_visible = true;
    if not found then raise exception using errcode = '42501', message = 'share_card_public_pass_opt_in_required'; end if;
  else
    if p_product_id is null or p_source_id is null or p_source_evidence_node_id is null then raise exception using errcode = '22023', message = 'share_card_intelligence_source_required'; end if;
    select * into v_product from public.products where workspace_id = p_workspace_id and id = p_product_id and status = 'active';
    if not found then raise exception using errcode = '42501', message = 'share_card_active_product_required'; end if;
    if p_variant = 'SIGNAL' then
      select * into v_signal from public.signals where workspace_id = p_workspace_id and product_id = p_product_id and id = p_source_id and lifecycle_status in ('active', 'saved') and evidence_node_id = p_source_evidence_node_id;
      if not found then raise exception using errcode = '42501', message = 'share_card_current_signal_required'; end if;
    elsif p_variant = 'DEMAND_GAP' then
      select * into v_gap from public.demand_gaps where workspace_id = p_workspace_id and product_id = p_product_id and id = p_source_id and evidence_node_id = p_source_evidence_node_id;
      if not found then raise exception using errcode = '42501', message = 'share_card_demand_gap_required'; end if;
    else
      select * into v_drift from public.demand_drifts where workspace_id = p_workspace_id and product_id = p_product_id and id = p_source_id and evidence_node_id = p_source_evidence_node_id;
      if not found then raise exception using errcode = '42501', message = 'share_card_demand_drift_required'; end if;
    end if;
  end if;

  if p_workspace_id is not null and p_variant in ('FOUNDING_25', 'EARLY_100') then
    select * into v_existing from public.share_card_publications where workspace_id = p_workspace_id and variant = p_variant for update;
  elsif p_workspace_id is not null then
    select * into v_existing from public.share_card_publications where workspace_id = p_workspace_id and product_id = p_product_id and variant = p_variant and source_id = p_source_id for update;
  else
    select * into v_existing from public.share_card_publications where waitlist_application_id = p_waitlist_application_id and variant = p_variant for update;
  end if;
  if found and v_existing.publication_state = 'published' then return v_existing; end if;

  if found then
    update public.share_card_publications set public_slug = p_public_slug, publication_state = 'published', snapshot = p_snapshot, product_id = p_product_id, source_id = p_source_id, source_evidence_node_id = p_source_evidence_node_id, published_at = timezone('utc', now()), revoked_at = null, updated_by_user_id = p_actor_user_id where id = v_existing.id returning * into v_row;
  else
    insert into public.share_card_publications (workspace_id, waitlist_application_id, variant, public_slug, publication_state, snapshot, product_id, source_id, source_evidence_node_id, published_at, created_by_user_id, updated_by_user_id)
    values (p_workspace_id, p_waitlist_application_id, p_variant, p_public_slug, 'published', p_snapshot, p_product_id, p_source_id, p_source_evidence_node_id, timezone('utc', now()), p_actor_user_id, p_actor_user_id) returning * into v_row;
  end if;
  insert into public.share_card_events (publication_id, event_type, actor_user_id, metadata) values (v_row.id, 'published', p_actor_user_id, jsonb_build_object('variant', p_variant, 'card_kind', case when p_variant in ('SIGNAL', 'DEMAND_GAP', 'DEMAND_DRIFT') then 'intelligence' else 'identity' end));
  return v_row;
end;
$$;

create or replace function public.revoke_share_card(
  p_workspace_id uuid,
  p_waitlist_application_id uuid,
  p_variant text,
  p_actor_user_id uuid default null,
  p_product_id uuid default null,
  p_source_id uuid default null
)
returns public.share_card_publications
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_row public.share_card_publications;
begin
  if not public.is_service_role() then raise exception using errcode = '42501', message = 'share_card_service_role_required'; end if;
  if ((p_workspace_id is not null)::integer + (p_waitlist_application_id is not null)::integer) <> 1 then raise exception using errcode = '22023', message = 'share_card_owner_required'; end if;
  if p_workspace_id is not null and p_variant in ('FOUNDING_25', 'EARLY_100') then
    select * into v_row from public.share_card_publications where workspace_id = p_workspace_id and variant = p_variant for update;
  elsif p_workspace_id is not null then
    select * into v_row from public.share_card_publications where workspace_id = p_workspace_id and product_id = p_product_id and variant = p_variant and source_id = p_source_id for update;
  else
    select * into v_row from public.share_card_publications where waitlist_application_id = p_waitlist_application_id and variant = p_variant for update;
  end if;
  if not found or v_row.publication_state = 'revoked' then return v_row; end if;
  update public.share_card_publications set publication_state = 'revoked', revoked_at = timezone('utc', now()), updated_by_user_id = p_actor_user_id where id = v_row.id returning * into v_row;
  insert into public.share_card_events (publication_id, event_type, actor_user_id, metadata) values (v_row.id, 'revoked', p_actor_user_id, jsonb_build_object('variant', p_variant));
  return v_row;
end;
$$;

create or replace function public.get_share_card_publications(p_workspace_id uuid, p_waitlist_application_id uuid, p_product_id uuid default null)
returns setof public.share_card_publications
language sql
security definer
set search_path = public, auth
as $$
  select publication.* from public.share_card_publications as publication
   where ((p_workspace_id is not null and publication.workspace_id = p_workspace_id)
       or (p_waitlist_application_id is not null and publication.waitlist_application_id = p_waitlist_application_id))
     and (p_product_id is null or publication.product_id = p_product_id)
   order by publication.variant, publication.source_id nulls first;
$$;

drop function if exists public.get_public_share_card(text);
create or replace function public.get_public_share_card(p_public_slug text)
returns table (
  public_slug text, variant text, display_name text, headline text, identity_label text, identity_number integer,
  tone text, is_permanent boolean, card_kind text, claim text, evidence text, evidence_strength text,
  context_label text, freshness_label text, source_label text, published_at timestamptz,
  access_mode text, cta_label text, cta_href text
)
language sql stable security definer set search_path = public
as $$
  select publication.public_slug, publication.variant,
    nullif(coalesce(publication.snapshot ->> 'displayName', publication.snapshot ->> 'display_name'), ''),
    nullif(coalesce(publication.snapshot ->> 'headline', publication.snapshot ->> 'headline'), ''),
    coalesce(publication.snapshot ->> 'identityLabel', publication.snapshot ->> 'identity_label'),
    case when coalesce(publication.snapshot ->> 'identityNumber', publication.snapshot ->> 'identity_number', '') ~ '^[0-9]+$' then (coalesce(publication.snapshot ->> 'identityNumber', publication.snapshot ->> 'identity_number'))::integer else null end,
    coalesce(publication.snapshot ->> 'tone', 'neutral'), coalesce((coalesce(publication.snapshot ->> 'isPermanent', publication.snapshot ->> 'is_permanent'))::boolean, false),
    coalesce(publication.snapshot ->> 'cardKind', publication.snapshot ->> 'card_kind', 'identity'),
    nullif(coalesce(publication.snapshot ->> 'claim', ''), ''), nullif(coalesce(publication.snapshot ->> 'evidence', ''), ''), nullif(coalesce(publication.snapshot ->> 'evidenceStrength', publication.snapshot ->> 'evidence_strength', ''), ''),
    nullif(coalesce(publication.snapshot ->> 'contextLabel', publication.snapshot ->> 'context_label', ''), ''), nullif(coalesce(publication.snapshot ->> 'freshnessLabel', publication.snapshot ->> 'freshness_label', ''), ''), nullif(coalesce(publication.snapshot ->> 'sourceLabel', publication.snapshot ->> 'source_label', ''), ''),
    publication.published_at, access.mode,
    case when access.mode = 'open' then 'Start free' else 'Request access' end,
    case when access.mode = 'open' then '/signup?source=share_card' when referral.public_code is not null then '/r/' || referral.public_code || '?source=share_card' else '/waitlist?source=share_card' end
  from public.share_card_publications as publication
  cross join public.product_access_mode as access
  left join public.waitlist_priority_access as priority on priority.waitlist_application_id = publication.waitlist_application_id and priority.status = 'granted'
  left join public.waitlist_referral_identities as referral on referral.waitlist_application_id = publication.waitlist_application_id
  left join public.workspace_public_cohort_profiles as profile on profile.workspace_id = publication.workspace_id and profile.pass_visible = true
  left join public.products as product on product.workspace_id = publication.workspace_id and product.id = publication.product_id and product.status = 'active'
  left join public.signals as signal on publication.variant = 'SIGNAL' and signal.id = publication.source_id and signal.workspace_id = publication.workspace_id and signal.product_id = publication.product_id and signal.lifecycle_status in ('active', 'saved') and signal.evidence_node_id = publication.source_evidence_node_id
  left join public.demand_gaps as gap on publication.variant = 'DEMAND_GAP' and gap.id = publication.source_id and gap.workspace_id = publication.workspace_id and gap.product_id = publication.product_id and gap.evidence_node_id = publication.source_evidence_node_id
  left join public.demand_drifts as drift on publication.variant = 'DEMAND_DRIFT' and drift.id = publication.source_id and drift.workspace_id = publication.workspace_id and drift.product_id = publication.product_id and drift.evidence_node_id = publication.source_evidence_node_id
  where publication.public_slug = p_public_slug and publication.publication_state = 'published'
    and (publication.variant <> 'PRIORITY_ACCESS' or priority.id is not null)
    and (publication.variant in ('EARLY_ACCESS', 'PRIORITY_ACCESS') or (publication.variant in ('FOUNDING_25', 'EARLY_100') and profile.id is not null) or (publication.variant = 'SIGNAL' and product.id is not null and signal.id is not null) or (publication.variant = 'DEMAND_GAP' and product.id is not null and gap.id is not null) or (publication.variant = 'DEMAND_DRIFT' and product.id is not null and drift.id is not null));
$$;

revoke all on function public.publish_share_card(uuid, uuid, text, text, jsonb, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.revoke_share_card(uuid, uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_share_card_publications(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_public_share_card(text) from public, anon, authenticated;
grant execute on function public.publish_share_card(uuid, uuid, text, text, jsonb, uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.revoke_share_card(uuid, uuid, text, uuid, uuid, uuid) to service_role;
grant execute on function public.get_share_card_publications(uuid, uuid, uuid) to service_role;
grant execute on function public.get_public_share_card(text) to anon, authenticated, service_role;

comment on table public.share_card_publications is 'Explicit, revocable public share-card consent for authoritative identities or evidence-backed intelligence; intelligence publication is revalidated against live source rows.';
comment on function public.get_public_share_card(text) is 'Narrow non-indexable public DTO; rechecks consent, product/source lifecycle, evidence identity, and current access-mode CTA.';
