-- Layer 13B.1: explicit, revocable public share cards for authoritative identities.
-- This migration never assigns cohorts, verifies applications, grants Priority,
-- creates admissions, or changes the access-mode policy.

create table if not exists public.share_card_publications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete restrict,
  waitlist_application_id uuid references public.waitlist_applications(id) on delete restrict,
  variant text not null check (variant in ('EARLY_ACCESS', 'PRIORITY_ACCESS', 'FOUNDING_25', 'EARLY_100')),
  public_slug text not null unique check (public_slug ~ '^[A-Za-z0-9_-]{32,96}$'),
  publication_state text not null default 'published' check (publication_state in ('published', 'revoked')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  published_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (((workspace_id is not null)::integer + (waitlist_application_id is not null)::integer) = 1),
  check ((publication_state = 'published') = (revoked_at is null)),
  check (publication_state = 'revoked' or revoked_at is null)
);

create unique index if not exists share_card_publications_workspace_variant_idx
  on public.share_card_publications (workspace_id, variant)
  where workspace_id is not null;
create unique index if not exists share_card_publications_application_variant_idx
  on public.share_card_publications (waitlist_application_id, variant)
  where waitlist_application_id is not null;
create index if not exists share_card_publications_public_state_idx
  on public.share_card_publications (public_slug, publication_state);

create table if not exists public.share_card_events (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.share_card_publications(id) on delete cascade,
  event_type text not null check (event_type in ('published', 'revoked', 'opened', 'cta_clicked', 'shared', 'downloaded')),
  source text check (source is null or source in ('page', 'x', 'linkedin', 'copy', 'download', 'cta')),
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists share_card_events_publication_created_idx
  on public.share_card_events (publication_id, created_at desc);

create or replace function public.share_card_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists share_card_publications_updated_at on public.share_card_publications;
create trigger share_card_publications_updated_at
before update on public.share_card_publications
for each row execute function public.share_card_updated_at();

create or replace function public.prevent_share_card_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception using errcode = '55000', message = 'share_card_event_append_only';
end;
$$;

drop trigger if exists share_card_events_append_only on public.share_card_events;
create trigger share_card_events_append_only
before update or delete on public.share_card_events
for each row execute function public.prevent_share_card_event_mutation();

-- A publication is consent, not a durable entitlement. If the authoritative
-- entitlement is revoked or a public-pass opt-in is withdrawn, revoke the
-- publication as well so a later re-grant/re-opt-in cannot silently republish
-- a more revealing identity without a fresh explicit publish action.
create or replace function public.revoke_share_cards_on_priority_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.share_card_publications
       set publication_state = 'revoked',
           revoked_at = coalesce(revoked_at, timezone('utc', now())),
           updated_at = timezone('utc', now())
     where waitlist_application_id = old.waitlist_application_id
       and variant = 'PRIORITY_ACCESS'
       and publication_state = 'published';
    return old;
  end if;

  if old.status = 'granted' and new.status is distinct from 'granted' then
    update public.share_card_publications
       set publication_state = 'revoked',
           revoked_at = coalesce(revoked_at, timezone('utc', now())),
           updated_at = timezone('utc', now())
     where waitlist_application_id = new.waitlist_application_id
       and variant = 'PRIORITY_ACCESS'
       and publication_state = 'published';
  end if;
  return new;
end;
$$;

drop trigger if exists share_card_priority_revocation on public.waitlist_priority_access;
create trigger share_card_priority_revocation
after update of status or delete on public.waitlist_priority_access
for each row execute function public.revoke_share_cards_on_priority_change();

create or replace function public.revoke_share_cards_on_pass_opt_out()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.pass_visible = true and new.pass_visible = false then
    update public.share_card_publications
       set publication_state = 'revoked',
           revoked_at = coalesce(revoked_at, timezone('utc', now())),
           updated_at = timezone('utc', now())
     where workspace_id = new.workspace_id
       and variant in ('FOUNDING_25', 'EARLY_100')
       and publication_state = 'published';
  end if;
  return new;
end;
$$;

drop trigger if exists share_card_pass_opt_out on public.workspace_public_cohort_profiles;
create trigger share_card_pass_opt_out
after update of pass_visible on public.workspace_public_cohort_profiles
for each row execute function public.revoke_share_cards_on_pass_opt_out();

create or replace function public.publish_share_card(
  p_workspace_id uuid,
  p_waitlist_application_id uuid,
  p_variant text,
  p_public_slug text,
  p_snapshot jsonb,
  p_actor_user_id uuid default null
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
  v_row public.share_card_publications;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'share_card_service_role_required';
  end if;
  if ((p_workspace_id is not null)::integer + (p_waitlist_application_id is not null)::integer) <> 1 then
    raise exception using errcode = '22023', message = 'share_card_owner_required';
  end if;
  if p_variant not in ('EARLY_ACCESS', 'PRIORITY_ACCESS', 'FOUNDING_25', 'EARLY_100') then
    raise exception using errcode = '22023', message = 'share_card_variant_invalid';
  end if;
  if p_public_slug is null or p_public_slug !~ '^[A-Za-z0-9_-]{32,96}$' then
    raise exception using errcode = '22023', message = 'share_card_slug_invalid';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception using errcode = '22023', message = 'share_card_snapshot_invalid';
  end if;

  if p_waitlist_application_id is not null then
    select * into v_application
      from public.waitlist_applications
     where id = p_waitlist_application_id
       and email_verification_status = 'verified'
       and early_access_number is not null;
    if not found then
      raise exception using errcode = '42501', message = 'share_card_verified_applicant_required';
    end if;
    if p_variant = 'PRIORITY_ACCESS' then
      select * into v_priority
        from public.waitlist_priority_access
       where waitlist_application_id = p_waitlist_application_id
         and status = 'granted';
      if not found then
        raise exception using errcode = '42501', message = 'share_card_priority_not_active';
      end if;
    elsif p_variant <> 'EARLY_ACCESS' then
      raise exception using errcode = '42501', message = 'share_card_cohort_owner_required';
    end if;
  else
    select * into v_membership
      from public.workspace_cohort_memberships
     where workspace_id = p_workspace_id;
    if not found or p_variant not in ('FOUNDING_25', 'EARLY_100')
       or (p_variant = 'FOUNDING_25' and v_membership.cohort <> 'founding_25')
       or (p_variant = 'EARLY_100' and v_membership.cohort <> 'early_100') then
      raise exception using errcode = '42501', message = 'share_card_authoritative_membership_required';
    end if;
    select * into v_profile
      from public.workspace_public_cohort_profiles
     where workspace_id = p_workspace_id
       and cohort_membership_id = v_membership.id
       and pass_visible = true;
    if not found then
      raise exception using errcode = '42501', message = 'share_card_public_pass_opt_in_required';
    end if;
  end if;

  if p_workspace_id is not null then
    select * into v_existing from public.share_card_publications
     where workspace_id = p_workspace_id and variant = p_variant for update;
  else
    select * into v_existing from public.share_card_publications
     where waitlist_application_id = p_waitlist_application_id and variant = p_variant for update;
  end if;

  if found and v_existing.publication_state = 'published' then
    return v_existing;
  end if;

  if found then
    update public.share_card_publications
       set public_slug = p_public_slug,
           publication_state = 'published',
           snapshot = p_snapshot,
           published_at = timezone('utc', now()),
           revoked_at = null,
           updated_by_user_id = p_actor_user_id
     where id = v_existing.id
     returning * into v_row;
  else
    insert into public.share_card_publications (
      workspace_id, waitlist_application_id, variant, public_slug, publication_state,
      snapshot, published_at, created_by_user_id, updated_by_user_id
    ) values (
      p_workspace_id, p_waitlist_application_id, p_variant, p_public_slug, 'published',
      p_snapshot, timezone('utc', now()), p_actor_user_id, p_actor_user_id
    ) returning * into v_row;
  end if;

  insert into public.share_card_events (publication_id, event_type, actor_user_id, metadata)
  values (v_row.id, 'published', p_actor_user_id, jsonb_build_object('variant', p_variant));
  return v_row;
end;
$$;

create or replace function public.revoke_share_card(
  p_workspace_id uuid,
  p_waitlist_application_id uuid,
  p_variant text,
  p_actor_user_id uuid default null
)
returns public.share_card_publications
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.share_card_publications;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'share_card_service_role_required';
  end if;
  if ((p_workspace_id is not null)::integer + (p_waitlist_application_id is not null)::integer) <> 1 then
    raise exception using errcode = '22023', message = 'share_card_owner_required';
  end if;
  if p_workspace_id is not null then
    select * into v_row from public.share_card_publications
     where workspace_id = p_workspace_id and variant = p_variant for update;
  else
    select * into v_row from public.share_card_publications
     where waitlist_application_id = p_waitlist_application_id and variant = p_variant for update;
  end if;
  if not found then
    return null;
  end if;
  if v_row.publication_state = 'revoked' then
    return v_row;
  end if;
  update public.share_card_publications
     set publication_state = 'revoked', revoked_at = timezone('utc', now()), updated_by_user_id = p_actor_user_id
   where id = v_row.id
  returning * into v_row;
  insert into public.share_card_events (publication_id, event_type, actor_user_id, metadata)
  values (v_row.id, 'revoked', p_actor_user_id, jsonb_build_object('variant', p_variant));
  return v_row;
end;
$$;

create or replace function public.get_share_card_publications(
  p_workspace_id uuid,
  p_waitlist_application_id uuid
)
returns setof public.share_card_publications
language sql
security definer
set search_path = public, auth
as $$
  select publication.*
    from public.share_card_publications as publication
   where ((p_workspace_id is not null and publication.workspace_id = p_workspace_id)
       or (p_waitlist_application_id is not null and publication.waitlist_application_id = p_waitlist_application_id))
   order by publication.variant;
$$;

create or replace function public.get_public_share_card(p_public_slug text)
returns table (
  public_slug text,
  variant text,
  display_name text,
  headline text,
  identity_label text,
  identity_number integer,
  tone text,
  is_permanent boolean,
  published_at timestamptz,
  access_mode text,
  cta_label text,
  cta_href text
)
language sql
stable
security definer
set search_path = public
as $$
  select publication.public_slug,
    publication.variant,
    nullif(publication.snapshot ->> 'display_name', ''),
    nullif(publication.snapshot ->> 'headline', ''),
    publication.snapshot ->> 'identity_label',
    case when coalesce(publication.snapshot ->> 'identity_number', '') ~ '^[0-9]+$'
      then (publication.snapshot ->> 'identity_number')::integer else null end,
    publication.snapshot ->> 'tone',
    coalesce((publication.snapshot ->> 'is_permanent')::boolean, false),
    publication.published_at,
    access.mode,
    case when access.mode = 'open' then 'Start free' else 'Request access' end,
    case when access.mode = 'open' then '/signup?source=share_card'
         when referral.public_code is not null then '/r/' || referral.public_code || '?source=share_card'
         else '/waitlist?source=share_card' end
  from public.share_card_publications as publication
  cross join public.product_access_mode as access
  left join public.waitlist_priority_access as priority
    on priority.waitlist_application_id = publication.waitlist_application_id
   and priority.status = 'granted'
  left join public.waitlist_referral_identities as referral
    on referral.waitlist_application_id = publication.waitlist_application_id
  left join public.workspace_public_cohort_profiles as profile
    on profile.workspace_id = publication.workspace_id
   and profile.pass_visible = true
  where publication.public_slug = p_public_slug
    and publication.publication_state = 'published'
    and (publication.variant <> 'PRIORITY_ACCESS' or priority.id is not null)
    and (publication.variant in ('EARLY_ACCESS', 'PRIORITY_ACCESS') or profile.id is not null);
$$;

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
  if p_event_type not in ('opened', 'cta_clicked', 'shared', 'downloaded') then
    raise exception using errcode = '22023', message = 'share_card_event_invalid';
  end if;
  if p_source is not null and p_source not in ('page', 'x', 'linkedin', 'copy', 'download', 'cta') then
    raise exception using errcode = '22023', message = 'share_card_event_source_invalid';
  end if;
  select id into v_publication_id from public.share_card_publications
   where public_slug = p_public_slug and publication_state = 'published';
  if v_publication_id is not null then
    insert into public.share_card_events (publication_id, event_type, source)
    values (v_publication_id, p_event_type, p_source);
  end if;
end;
$$;

alter table public.share_card_publications enable row level security;
alter table public.share_card_events enable row level security;
revoke all on public.share_card_publications from public, anon, authenticated;
revoke all on public.share_card_events from public, anon, authenticated;
grant all on public.share_card_publications to service_role;
grant all on public.share_card_events to service_role;

revoke all on function public.publish_share_card(uuid, uuid, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.revoke_share_card(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.get_share_card_publications(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_public_share_card(text) from public, anon, authenticated;
revoke all on function public.record_share_card_event(text, text, text) from public, anon, authenticated;
grant execute on function public.publish_share_card(uuid, uuid, text, text, jsonb, uuid) to service_role;
grant execute on function public.revoke_share_card(uuid, uuid, text, uuid) to service_role;
grant execute on function public.get_share_card_publications(uuid, uuid) to service_role;
grant execute on function public.get_public_share_card(text) to anon, authenticated, service_role;
grant execute on function public.record_share_card_event(text, text, text) to anon, authenticated, service_role;

comment on table public.share_card_publications is 'Explicit, revocable public share-card consent for authoritative Early Access, Priority, Founding 25, or Early 100 identities; no admission authority.';
comment on table public.share_card_events is 'Best-effort distribution analytics for share cards; no tokens, email, or private intelligence.';
comment on function public.get_public_share_card(text) is 'Narrow public share-card DTO; rechecks active Priority state and derives the current access-mode CTA.';
