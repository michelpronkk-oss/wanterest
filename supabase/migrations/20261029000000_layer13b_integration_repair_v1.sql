-- Layer 13B targeted integration repair: applicant publication authority and
-- first-party OPEN signup attribution.
-- Forward-only additive repair after the already-pushed 13B.3 migration.
-- NOT RUNTIME VALIDATED: intentionally not applied by this implementation task.

-- P1-A: a public applicant card must be revalidated against the current
-- application authority on every read. Permanent cohort cards deliberately do
-- not carry waitlist_application_id and therefore remain governed by their
-- cohort profile/pass authority instead.
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
  left join public.waitlist_applications as application
    on application.id = publication.waitlist_application_id
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
    and (
      publication.waitlist_application_id is null
      or (
        application.id is not null
        and application.email_verification_status = 'verified'
        and application.status not in ('declined', 'withdrawn')
      )
    )
    and (publication.variant <> 'PRIORITY_ACCESS' or priority.id is not null)
    and (
      publication.variant in ('EARLY_ACCESS', 'PRIORITY_ACCESS')
      or (publication.variant in ('FOUNDING_25', 'EARLY_100') and profile.id is not null)
      or (publication.variant = 'SIGNAL' and product.id is not null and signal.id is not null)
      or (publication.variant = 'DEMAND_GAP' and product.id is not null and gap.id is not null)
      or (publication.variant = 'DEMAND_DRIFT' and product.id is not null and drift.id is not null)
    );
$$;

-- Keep distribution analytics append-only, but distinguish server-proven
-- signup/admission milestones from browser-observed engagement. These events
-- remain non-authoritative analytics and never grant referral or access credit.
alter table public.share_card_events drop constraint if exists share_card_events_event_type_check;
alter table public.share_card_events add constraint share_card_events_event_type_check check (
  event_type in ('published', 'revoked', 'opened', 'cta_clicked', 'shared', 'downloaded', 'signup_started', 'signup_completed', 'verified_conversion')
);

create or replace function public.record_share_card_event(
  p_public_slug text,
  p_event_type text,
  p_source text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_publication_id uuid;
begin
  if p_event_type not in ('opened', 'cta_clicked', 'shared', 'downloaded', 'signup_started', 'signup_completed', 'verified_conversion') then
    raise exception using errcode = '22023', message = 'share_card_event_invalid';
  end if;
  if p_source is not null and p_source not in ('page', 'x', 'linkedin', 'copy', 'download', 'cta') then
    raise exception using errcode = '22023', message = 'share_card_event_source_invalid';
  end if;
  select id into v_publication_id
    from public.share_card_publications
   where public_slug = p_public_slug and publication_state = 'published';
  if v_publication_id is not null then
    insert into public.share_card_events (publication_id, event_type, source)
    values (v_publication_id, p_event_type, p_source);
  end if;
end;
$$;

-- Persist only the opaque publication identity on an admitted workspace. The
-- signed server cookie is the handoff credential; this column is provenance,
-- never an authorization input.
alter table public.workspace_admissions
  add column if not exists share_card_publication_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.workspace_admissions'::regclass
       and conname = 'workspace_admissions_share_card_publication_fkey'
  ) then
    alter table public.workspace_admissions
      add constraint workspace_admissions_share_card_publication_fkey
      foreign key (share_card_publication_id)
      references public.share_card_publications(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists workspace_admissions_share_card_publication_idx
  on public.workspace_admissions (share_card_publication_id)
  where share_card_publication_id is not null;

create or replace function public.provision_workspace_admission(
  p_user_id uuid,
  p_source text,
  p_workspace_name text,
  p_workspace_slug text,
  p_idempotency_key text,
  p_waitlist_application_id uuid,
  p_invite_id uuid,
  p_trace_id text,
  p_share_card_public_slug text
)
returns table (
  admission_id uuid,
  invite_id uuid,
  waitlist_application_id uuid,
  user_id uuid,
  workspace_id uuid,
  cohort text,
  cohort_number integer,
  cohort_limit integer,
  benefit_policy_key text,
  benefit_status text,
  profile_initialized boolean,
  onboarding_status text,
  admitted_at timestamptz,
  idempotent boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_publication_id uuid;
  v_result record;
begin
  if p_share_card_public_slug is not null then
    if p_source <> 'open_signup' or p_share_card_public_slug !~ '^[A-Za-z0-9_-]{32,96}$' then
      raise exception using errcode = '22023', message = 'share_card_attribution_invalid';
    end if;
    select publication.id into v_publication_id
      from public.share_card_publications as publication
      left join public.waitlist_applications as application
        on application.id = publication.waitlist_application_id
     where publication.public_slug = p_share_card_public_slug
       and publication.publication_state = 'published'
       and (
         publication.waitlist_application_id is null
         or (
           application.email_verification_status = 'verified'
           and application.status not in ('declined', 'withdrawn')
         )
       );
    if v_publication_id is null then
      raise exception using errcode = '22023', message = 'share_card_attribution_unavailable';
    end if;
  end if;

  -- Exact eight-argument resolution intentionally delegates all admission
  -- policy, access-mode and idempotency rules to the 13A.6 authority.
  select admission.* into v_result
    from public.provision_workspace_admission(
      p_user_id, p_source, p_workspace_name, p_workspace_slug,
      p_idempotency_key, p_waitlist_application_id, p_invite_id, p_trace_id
    ) as admission;

  if v_publication_id is not null then
    update public.workspace_admissions
       set share_card_publication_id = v_publication_id
     where id = v_result.admission_id;

    insert into public.share_card_events (publication_id, event_type, source, metadata)
    values (
      v_publication_id,
      'verified_conversion',
      'cta',
      jsonb_build_object('admission_id', v_result.admission_id, 'workspace_id', v_result.workspace_id)
    );
  end if;

  return query select
    v_result.admission_id, v_result.invite_id, v_result.waitlist_application_id,
    v_result.user_id, v_result.workspace_id, v_result.cohort, v_result.cohort_number,
    v_result.cohort_limit, v_result.benefit_policy_key, v_result.benefit_status,
    v_result.profile_initialized, v_result.onboarding_status, v_result.admitted_at,
    v_result.idempotent;
end;
$$;

revoke all on function public.get_public_share_card(text) from public, anon, authenticated;
grant execute on function public.get_public_share_card(text) to anon, authenticated, service_role;
revoke all on function public.record_share_card_event(text, text, text) from public, anon, authenticated;
grant execute on function public.record_share_card_event(text, text, text) to anon, authenticated, service_role;
revoke all on function public.provision_workspace_admission(uuid, text, text, text, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.provision_workspace_admission(uuid, text, text, text, text, uuid, uuid, text, text) to service_role;

comment on column public.workspace_admissions.share_card_publication_id is 'Optional first-party share provenance for a qualifying open signup; never an authorization credential.';
comment on function public.provision_workspace_admission(uuid, text, text, text, text, uuid, uuid, text, text) is '13B integration repair wrapper: delegates canonical admission to 13A.6 and records a validated share publication provenance link for open signup.';
