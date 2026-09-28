-- Layer 13A.6: durable launch/access policy and shared admission seam.
-- Forward-only. The safe initial mode is invite_only; this migration never
-- opens the product and never creates an admission, invite, or cohort row.

create table if not exists public.product_access_mode (
  singleton_key text primary key default 'primary' check (singleton_key = 'primary'),
  mode text not null check (mode in ('waitlist', 'invite_only', 'open')),
  changed_at timestamptz not null default timezone('utc', now()),
  changed_by uuid references auth.users(id) on delete set null,
  reason text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.product_access_mode_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('product_access_mode_initialized', 'product_access_mode_changed')),
  from_mode text check (from_mode is null or from_mode in ('waitlist', 'invite_only', 'open')),
  to_mode text not null check (to_mode in ('waitlist', 'invite_only', 'open')),
  changed_at timestamptz not null default timezone('utc', now()),
  changed_by uuid references auth.users(id) on delete set null,
  actor_kind text not null check (actor_kind in ('service', 'internal')),
  reason text,
  version bigint not null check (version > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create index if not exists product_access_mode_events_changed_idx
  on public.product_access_mode_events (changed_at desc, version desc);

insert into public.product_access_mode (singleton_key, mode, reason, version)
values ('primary', 'invite_only', '13a6_safe_default_preserves_current_invite_admission_operations', 1)
on conflict (singleton_key) do nothing;

insert into public.product_access_mode_events (
  event_type, from_mode, to_mode, changed_by, actor_kind, reason, version, metadata
)
select
  'product_access_mode_initialized', null, mode, changed_by, 'service', reason, version,
  jsonb_build_object('singleton_key', singleton_key)
from public.product_access_mode as access
where access.singleton_key = 'primary'
  and not exists (
    select 1 from public.product_access_mode_events as event
    where event.event_type = 'product_access_mode_initialized'
      and event.version = access.version
  );

alter table public.product_access_mode enable row level security;
alter table public.product_access_mode_events enable row level security;
revoke all on public.product_access_mode from public, anon, authenticated;
revoke all on public.product_access_mode_events from public, anon, authenticated;
grant all on public.product_access_mode to service_role;
grant all on public.product_access_mode_events to service_role;

create or replace function public.get_product_access_policy()
returns table (
  mode text,
  waitlist_requests_allowed boolean,
  referral_system_active boolean,
  invite_issuance_allowed boolean,
  invite_acceptance_allowed boolean,
  public_signup_allowed boolean,
  invite_required_for_admission boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    access.mode,
    access.mode in ('waitlist', 'invite_only'),
    access.mode in ('waitlist', 'invite_only'),
    access.mode = 'invite_only',
    true,
    access.mode = 'open',
    access.mode <> 'open'
  from public.product_access_mode as access
  where access.singleton_key = 'primary';
$$;

create or replace function public.get_product_access_state()
returns table (
  mode text,
  can_request_access boolean,
  can_sign_up boolean,
  invite_required boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select policy.mode,
    policy.waitlist_requests_allowed,
    policy.public_signup_allowed,
    policy.invite_required_for_admission
  from public.get_product_access_policy() as policy;
$$;

create or replace function public.set_product_access_mode(
  p_to_mode text,
  p_reason text,
  p_actor_user_id uuid default null
)
returns table (mode text, changed boolean, version bigint)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_current public.product_access_mode;
  v_from_mode text;
  v_now timestamptz := timezone('utc', now());
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'product_access_mode_service_role_required';
  end if;
  if p_to_mode not in ('waitlist', 'invite_only', 'open') then
    raise exception using errcode = '22023', message = 'product_access_mode_invalid';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 240 then
    raise exception using errcode = '22023', message = 'product_access_mode_reason_invalid';
  end if;

  select * into v_current
  from public.product_access_mode as access
  where access.singleton_key = 'primary'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'product_access_mode_not_initialized';
  end if;

  if v_current.mode = p_to_mode then
    return query select v_current.mode, false, v_current.version;
    return;
  end if;
  if not (
    (v_current.mode = 'waitlist' and p_to_mode = 'invite_only')
    or (v_current.mode = 'invite_only' and p_to_mode in ('waitlist', 'open'))
    or (v_current.mode = 'open' and p_to_mode = 'invite_only')
  ) then
    raise exception using errcode = '22023', message = 'product_access_mode_transition_not_allowed';
  end if;
  v_from_mode := v_current.mode;

  update public.product_access_mode as access
     set mode = p_to_mode,
         changed_at = v_now,
         changed_by = p_actor_user_id,
         reason = left(trim(p_reason), 240),
         version = access.version + 1,
         updated_at = v_now
   where access.singleton_key = 'primary'
   returning * into v_current;

  insert into public.product_access_mode_events (
    event_type, from_mode, to_mode, changed_at, changed_by, actor_kind, reason, version, metadata
  ) values (
    'product_access_mode_changed', v_from_mode, p_to_mode, v_now, p_actor_user_id,
    'service', left(trim(p_reason), 240), v_current.version,
    jsonb_build_object('singleton_key', 'primary')
  );

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_kind, action, target_type, target_id, metadata
  ) values (
    null, p_actor_user_id, 'service', 'product_access_mode_changed', 'product_access_mode', null,
    jsonb_build_object('from', v_from_mode, 'to', p_to_mode, 'reason', left(trim(p_reason), 240), 'version', v_current.version)
  );

  return query select v_current.mode, true, v_current.version;
end;
$$;

create or replace function public.accept_waitlist_admission_invite(
  p_token_hash text,
  p_user_id uuid,
  p_trace_id text default null
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
  v_invite public.waitlist_admission_invites;
  v_application public.waitlist_applications;
  v_admission public.workspace_admissions;
  v_user_email text;
  v_invite_allowed boolean;
  v_result record;
  v_slug_base text;
  v_workspace_slug text;
  v_now timestamptz := timezone('utc', now());
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'waitlist_admission_service_role_required';
  end if;
  select policy.invite_acceptance_allowed into v_invite_allowed
  from public.get_product_access_policy() as policy;
  if not coalesce(v_invite_allowed, false) then
    raise exception using errcode = '42501', message = 'waitlist_invite_acceptance_disabled_by_access_mode';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_user_id is null then
    raise exception using errcode = '22023', message = 'waitlist_admission_input_invalid';
  end if;

  select lower(trim(u.email)) into v_user_email
  from auth.users as u
  where u.id = p_user_id;
  if v_user_email is null then
    raise exception using errcode = 'P0002', message = 'auth_user_not_found';
  end if;

  select invite.* into v_invite
  from public.waitlist_admission_invites as invite
  where invite.token_hash = p_token_hash
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'waitlist_admission_invite_invalid';
  end if;
  select application.* into v_application
  from public.waitlist_applications as application
  where application.id = v_invite.waitlist_application_id
  for update;
  if lower(trim(v_application.normalized_email)) <> v_user_email then
    raise exception using errcode = '42501', message = 'waitlist_admission_email_mismatch';
  end if;

  if v_invite.status = 'accepted' then
    select admission.* into v_admission
    from public.workspace_admissions as admission
    where admission.id = v_invite.admission_id;
    if v_admission.user_id <> p_user_id then
      raise exception using errcode = '42501', message = 'waitlist_admission_user_mismatch';
    end if;
    return query
    select v_admission.id, v_invite.id, v_admission.waitlist_application_id, v_admission.user_id,
      v_admission.workspace_id, membership.cohort, membership.cohort_number,
      case when membership.cohort = 'founding_25' then 25 when membership.cohort = 'early_100' then 100 else null end,
      benefit.policy_key, benefit.status, (profile.id is not null), v_admission.onboarding_status,
      v_admission.admitted_at, true
    from public.workspace_admissions as admission
    left join public.workspace_cohort_memberships as membership
      on membership.workspace_id = admission.workspace_id and membership.id = admission.cohort_membership_id
    left join public.workspace_cohort_benefit_entitlements as benefit
      on benefit.workspace_id = admission.workspace_id
    left join public.workspace_public_cohort_profiles as profile
      on profile.workspace_id = admission.workspace_id
    where admission.id = v_admission.id;
    return;
  end if;
  if v_invite.status <> 'issued' then
    raise exception using errcode = '22023', message = 'waitlist_admission_invite_unusable';
  end if;
  if v_invite.expires_at <= v_now then
    update public.waitlist_admission_invites as invite
       set status = 'expired'
     where invite.id = v_invite.id;
    insert into public.waitlist_admission_events (
      waitlist_application_id, invite_id, event_type, actor_kind, metadata
    ) values (
      v_application.id, v_invite.id, 'invite_expired', 'system',
      jsonb_build_object('expired_at', v_invite.expires_at)
    );
    raise exception using errcode = '22023', message = 'waitlist_admission_invite_expired';
  end if;
  if v_application.email_verification_status <> 'verified'
     or v_application.status <> 'approved_for_invite' then
    raise exception using errcode = '22023', message = 'waitlist_application_not_approved_for_invite';
  end if;

  v_slug_base := trim(both '-' from regexp_replace(lower(trim(v_application.company_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base = '' then v_slug_base := 'workspace'; end if;
  v_workspace_slug := left(v_slug_base, 70) || '-' || substr(replace(v_application.id::text, '-', ''), 1, 8);

  select * into v_result
  from public.provision_workspace_admission(
    p_user_id,
    'waitlist_invite',
    left(trim(v_application.company_name), 120),
    v_workspace_slug,
    'waitlist-invite:' || v_invite.id::text,
    v_application.id,
    v_invite.id,
    p_trace_id
  );

  update public.waitlist_admission_invites as invite
     set status = 'accepted', accepted_at = v_now, accepted_by_user_id = p_user_id, admission_id = v_result.admission_id
   where invite.id = v_invite.id
   returning * into v_invite;

  update public.waitlist_applications as application
     set converted_user_id = p_user_id, converted_workspace_id = v_result.workspace_id
   where application.id = v_application.id;

  insert into public.waitlist_admission_events (
    waitlist_application_id, invite_id, admission_id, event_type, actor_kind, actor_user_id, metadata
  ) values
    (v_application.id, v_invite.id, v_result.admission_id, 'invite_accepted', 'user', p_user_id, '{}'::jsonb),
    (v_application.id, v_invite.id, v_result.admission_id, 'admission_completed', 'system', p_user_id,
      jsonb_build_object('workspace_id', v_result.workspace_id, 'cohort', v_result.cohort, 'cohort_number', v_result.cohort_number));

  return query select v_result.admission_id, v_invite.id, v_application.id, p_user_id,
    v_result.workspace_id, v_result.cohort, v_result.cohort_number, v_result.cohort_limit,
    v_result.benefit_policy_key, v_result.benefit_status, v_result.profile_initialized,
    v_result.onboarding_status, v_result.admitted_at, false;
end;
$$;

create or replace function public.prevent_product_access_mode_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception using errcode = '55000', message = 'product_access_mode_events_append_only';
end;
$$;

drop trigger if exists product_access_mode_events_append_only on public.product_access_mode_events;
create trigger product_access_mode_events_append_only
before update or delete on public.product_access_mode_events
for each row execute function public.prevent_product_access_mode_event_mutation();


create or replace function public.create_workspace(
  p_name text,
  p_slug text,
  p_trace_id text default null
)
returns public.workspaces
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_access_mode text;
  v_has_workspace boolean;
  v_open_workspace_id uuid;
  v_workspace public.workspaces;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select access.mode into v_access_mode
  from public.product_access_mode as access
  where access.singleton_key = 'primary'
  for share;
  select exists (
    select 1 from public.workspace_members as member
    where member.user_id = v_user_id and member.status = 'active'
  ) into v_has_workspace;

  if not v_has_workspace then
    if v_access_mode <> 'open' then
      raise exception using errcode = '42501', message = 'public_signup_not_allowed';
    end if;
    select admission.workspace_id into v_open_workspace_id
    from public.provision_workspace_admission(
      v_user_id,
      'open_signup',
      p_name,
      p_slug,
      'open-signup:' || v_user_id::text,
      null,
      null,
      p_trace_id
    ) as admission;
    select * into v_workspace
    from public.workspaces as workspace
    where workspace.id = v_open_workspace_id;
    return v_workspace;
  end if;

  insert into public.workspaces (name, slug, created_by)
  values (trim(p_name), lower(trim(p_slug)), v_user_id)
  returning * into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (v_workspace.id, v_user_id, 'owner', 'active');

  perform public.initialize_workspace_entitlements(v_workspace.id, null, v_user_id, p_trace_id);

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_kind, action, target_type, target_id, trace_id, metadata
  ) values (
    v_workspace.id, v_user_id,
    case when public.is_service_role() then 'service' else 'user' end,
    'workspace.created', 'workspace', v_workspace.id, p_trace_id,
    jsonb_build_object('slug', v_workspace.slug)
  );
  return v_workspace;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'workspace_slug_already_exists';
end;
$$;

create or replace function public.issue_waitlist_admission_invite(
  p_waitlist_application_id uuid,
  p_token_hash text,
  p_actor_user_id uuid default null
)
returns table (
  invite_id uuid,
  waitlist_application_id uuid,
  recipient_email text,
  first_name text,
  company_name text,
  status text,
  issued_at timestamptz,
  expires_at timestamptz,
  reissued boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_application public.waitlist_applications;
  v_current public.waitlist_admission_invites;
  v_invite public.waitlist_admission_invites;
  v_invite_allowed boolean;
  v_now timestamptz := timezone('utc', now());
  v_reissued boolean := false;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'waitlist_admission_service_role_required';
  end if;
  select policy.invite_issuance_allowed into v_invite_allowed
  from public.get_product_access_policy() as policy;
  if not coalesce(v_invite_allowed, false) then
    raise exception using errcode = '42501', message = 'waitlist_invite_issuance_disabled_by_access_mode';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'waitlist_admission_token_hash_invalid';
  end if;

  select application.* into v_application
  from public.waitlist_applications as application
  where application.id = p_waitlist_application_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'waitlist_application_not_found';
  end if;
  if v_application.email_verification_status <> 'verified'
     or v_application.status <> 'approved_for_invite' then
    raise exception using errcode = '22023', message = 'waitlist_application_not_approved_for_invite';
  end if;
  if exists (
    select 1 from public.workspace_admissions as admission
    where admission.waitlist_application_id = v_application.id
  ) then
    raise exception using errcode = '23505', message = 'waitlist_application_already_admitted';
  end if;

  select invite.* into v_current
  from public.waitlist_admission_invites as invite
  where invite.waitlist_application_id = v_application.id
    and invite.status = 'issued'
  for update;
  if found then
    update public.waitlist_admission_invites as invite
       set status = 'revoked', revoked_at = v_now
     where invite.id = v_current.id;
    insert into public.waitlist_admission_events (
      waitlist_application_id, invite_id, event_type, actor_kind, actor_user_id, metadata
    ) values (
      v_application.id, v_current.id, 'invite_revoked', 'internal', p_actor_user_id,
      jsonb_build_object('reason', 'reissued')
    );
    v_reissued := true;
  end if;

  insert into public.waitlist_admission_invites (
    waitlist_application_id, token_hash, status, issued_at, expires_at
  ) values (
    v_application.id, p_token_hash, 'issued', v_now, v_now + interval '7 days'
  ) returning * into v_invite;

  insert into public.waitlist_admission_events (
    waitlist_application_id, invite_id, event_type, actor_kind, actor_user_id, metadata
  ) values (
    v_application.id, v_invite.id,
    case when v_reissued then 'invite_reissued' else 'invite_issued' end,
    'internal', p_actor_user_id,
    jsonb_build_object('expires_at', v_invite.expires_at)
  );

  return query select v_invite.id, v_invite.waitlist_application_id, v_application.email,
    v_application.first_name, v_application.company_name, v_invite.status,
    v_invite.issued_at, v_invite.expires_at, v_reissued;
end;
$$;

alter table public.workspace_admissions
  alter column waitlist_application_id drop not null,
  alter column invite_id drop not null;

alter table public.workspace_admissions drop constraint if exists workspace_admissions_source_check;
alter table public.workspace_admissions add constraint workspace_admissions_source_check check (
  (source = 'waitlist_invite' and waitlist_application_id is not null and invite_id is not null)
  or (source = 'open_signup' and waitlist_application_id is null and invite_id is null)
);

alter table public.workspace_admissions add column if not exists idempotency_key text;
update public.workspace_admissions
   set idempotency_key = case
     when source = 'waitlist_invite' then 'waitlist-invite:' || invite_id::text
     else 'legacy-admission:' || id::text
   end
 where idempotency_key is null;
alter table public.workspace_admissions alter column idempotency_key set not null;
create unique index if not exists workspace_admissions_idempotency_key_idx
  on public.workspace_admissions (idempotency_key);
create index if not exists workspace_admissions_source_idx
  on public.workspace_admissions (source, admitted_at desc);

comment on table public.product_access_mode is 'Server-authoritative launch policy singleton; public callers use get_product_access_state.';
comment on table public.product_access_mode_events is 'Append-only launch mode transition history.';
comment on column public.workspace_admissions.idempotency_key is 'Server-derived admission idempotency identity; open signup uses the authenticated user.';

create or replace function public.provision_workspace_admission(
  p_user_id uuid,
  p_source text,
  p_workspace_name text,
  p_workspace_slug text,
  p_idempotency_key text,
  p_waitlist_application_id uuid default null,
  p_invite_id uuid default null,
  p_trace_id text default null
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
  v_access_mode text;
  v_expected_key text;
  v_user_email text;
  v_email_confirmed_at timestamptz;
  v_existing public.workspace_admissions;
  v_application public.waitlist_applications;
  v_invite public.waitlist_admission_invites;
  v_workspace public.workspaces;
  v_assignment record;
  v_admission public.workspace_admissions;
  v_profile_initialized boolean := false;
  v_workspace_name text;
  v_workspace_slug text;
  v_now timestamptz := timezone('utc', now());
begin
  if p_user_id is null or p_source not in ('waitlist_invite', 'open_signup') then
    raise exception using errcode = '22023', message = 'workspace_admission_input_invalid';
  end if;
  if p_source = 'waitlist_invite' and not public.is_service_role() then
    raise exception using errcode = '42501', message = 'workspace_admission_service_role_required';
  end if;
  if p_source = 'open_signup'
     and not public.is_service_role()
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception using errcode = '42501', message = 'open_signup_user_mismatch';
  end if;

  select access.mode into v_access_mode
  from public.product_access_mode as access
  where access.singleton_key = 'primary'
  for share;
  if v_access_mode is null then
    raise exception using errcode = 'P0002', message = 'product_access_mode_not_initialized';
  end if;
  if p_source = 'open_signup' and v_access_mode <> 'open' then
    raise exception using errcode = '42501', message = 'public_signup_not_allowed';
  end if;

  select lower(trim(u.email)), u.email_confirmed_at
    into v_user_email, v_email_confirmed_at
  from auth.users as u
  where u.id = p_user_id;
  if v_user_email is null then
    raise exception using errcode = 'P0002', message = 'auth_user_not_found';
  end if;
  if p_source = 'open_signup' and v_email_confirmed_at is null then
    raise exception using errcode = '42501', message = 'open_signup_email_not_verified';
  end if;

  v_expected_key := case
    when p_source = 'open_signup' then 'open-signup:' || p_user_id::text
    else 'waitlist-invite:' || p_invite_id::text
  end;
  if p_idempotency_key is null or p_idempotency_key <> v_expected_key then
    raise exception using errcode = '22023', message = 'workspace_admission_idempotency_key_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_expected_key, 0));

  select admission.* into v_existing
  from public.workspace_admissions as admission
  where admission.idempotency_key = v_expected_key
  for update;
  if found then
    return query
    select existing.id, existing.invite_id, existing.waitlist_application_id, existing.user_id,
      existing.workspace_id, membership.cohort, membership.cohort_number,
      case when membership.cohort = 'founding_25' then 25 when membership.cohort = 'early_100' then 100 else null end,
      benefit.policy_key, benefit.status, (profile.id is not null), existing.onboarding_status,
      existing.admitted_at, true
    from public.workspace_admissions as existing
    left join public.workspace_cohort_memberships as membership
      on membership.workspace_id = existing.workspace_id and membership.id = existing.cohort_membership_id
    left join public.workspace_cohort_benefit_entitlements as benefit
      on benefit.workspace_id = existing.workspace_id
    left join public.workspace_public_cohort_profiles as profile
      on profile.workspace_id = existing.workspace_id
    where existing.id = v_existing.id;
    return;
  end if;

  if p_source = 'open_signup' then
    if p_waitlist_application_id is not null or p_invite_id is not null then
      raise exception using errcode = '22023', message = 'open_signup_legacy_identity_forbidden';
    end if;
    if exists (
      select 1 from public.workspace_members as member
      where member.user_id = p_user_id and member.status = 'active'
    ) then
      raise exception using errcode = '23505', message = 'open_signup_user_already_admitted';
    end if;
  else
    if p_waitlist_application_id is null or p_invite_id is null then
      raise exception using errcode = '22023', message = 'waitlist_invite_identity_required';
    end if;
    select application.* into v_application
    from public.waitlist_applications as application
    where application.id = p_waitlist_application_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'waitlist_application_not_found';
    end if;
    select invite.* into v_invite
    from public.waitlist_admission_invites as invite
    where invite.id = p_invite_id
      and invite.waitlist_application_id = p_waitlist_application_id
    for update;
    if not found or v_invite.status <> 'issued' then
      raise exception using errcode = '22023', message = 'waitlist_admission_invite_unusable';
    end if;
    if exists (
      select 1 from public.workspace_admissions as admission
      where admission.waitlist_application_id = p_waitlist_application_id
    ) then
      raise exception using errcode = '23505', message = 'waitlist_application_admission_conflict';
    end if;
  end if;

  v_workspace_name := left(trim(p_workspace_name), 120);
  v_workspace_slug := lower(trim(p_workspace_slug));
  if v_workspace_name = '' or char_length(v_workspace_slug) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'workspace_admission_workspace_invalid';
  end if;

  if p_source = 'waitlist_invite' then
    insert into public.waitlist_admission_events (
      waitlist_application_id, invite_id, event_type, actor_kind, actor_user_id, metadata
    ) values (
      p_waitlist_application_id, p_invite_id, 'admission_started', 'system', p_user_id,
      jsonb_build_object('trace_id', p_trace_id, 'source', p_source)
    );
  end if;

  insert into public.workspaces (name, slug, created_by)
  values (v_workspace_name, v_workspace_slug, p_user_id)
  returning * into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (v_workspace.id, p_user_id, 'owner', 'active');

  perform public.initialize_workspace_entitlements(v_workspace.id, null, p_user_id, p_trace_id);

  select * into v_assignment
  from public.assign_workspace_cohort_membership_with_benefit(
    v_workspace.id,
    p_waitlist_application_id,
    p_user_id,
    'admission',
    'workspace_cohort_membership_v1'
  );

  if v_assignment.membership_id is not null then
    perform public.initialize_workspace_public_cohort_profile(v_workspace.id, v_workspace.slug, p_trace_id);
    v_profile_initialized := true;
  end if;

  insert into public.workspace_admissions (
    waitlist_application_id, invite_id, user_id, workspace_id, cohort_membership_id,
    onboarding_status, admitted_at, source, idempotency_key
  ) values (
    p_waitlist_application_id, p_invite_id, p_user_id, v_workspace.id, v_assignment.membership_id,
    'required', v_now, p_source, v_expected_key
  ) returning * into v_admission;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_kind, action, target_type, target_id, trace_id, metadata
  ) values (
    v_workspace.id, p_user_id, case when p_source = 'open_signup' then 'user' else 'service' end,
    'workspace.admission_completed', 'workspace_admission', v_admission.id, p_trace_id,
    jsonb_build_object(
      'source', p_source,
      'waitlist_application_id', p_waitlist_application_id,
      'invite_id', p_invite_id,
      'cohort', v_assignment.cohort,
      'cohort_number', v_assignment.cohort_number
    )
  );

  return query
  select v_admission.id, v_admission.invite_id, v_admission.waitlist_application_id, v_admission.user_id,
    v_admission.workspace_id, v_assignment.cohort, v_assignment.cohort_number,
    case when v_assignment.cohort = 'founding_25' then 25 when v_assignment.cohort = 'early_100' then 100 else null end,
    v_assignment.benefit_policy_key, v_assignment.benefit_status, v_profile_initialized,
    v_admission.onboarding_status, v_admission.admitted_at, false;
end;
$$;

revoke all on function public.get_product_access_policy() from public, anon, authenticated;
grant execute on function public.get_product_access_policy() to service_role;
revoke all on function public.get_product_access_state() from public, anon, authenticated;
grant execute on function public.get_product_access_state() to anon, authenticated, service_role;
revoke all on function public.set_product_access_mode(text, text, uuid) from public, anon, authenticated;
grant execute on function public.set_product_access_mode(text, text, uuid) to service_role;
revoke all on function public.provision_workspace_admission(uuid, text, text, text, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.provision_workspace_admission(uuid, text, text, text, text, uuid, uuid, text) to service_role;
revoke all on function public.issue_waitlist_admission_invite(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.issue_waitlist_admission_invite(uuid, text, uuid) to service_role;
revoke all on function public.accept_waitlist_admission_invite(text, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_waitlist_admission_invite(text, uuid, text) to service_role;

comment on function public.provision_workspace_admission(uuid, text, text, text, text, uuid, uuid, text)
  is 'Canonical idempotent workspace admission for waitlist invites and verified open signup; access policy is checked in the same transaction.';
comment on function public.set_product_access_mode(text, text, uuid)
  is 'Service/internal launch mode transition with explicit graph validation and append-only audit.';
