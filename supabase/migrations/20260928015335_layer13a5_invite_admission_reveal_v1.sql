-- Layer 13A.5: invite, admission, and server-authoritative reveal.
-- Forward-only. Approval remains a waitlist state; admission is the only
-- operation that creates a durable workspace/product relationship.

create table if not exists public.waitlist_admission_invites (
  id uuid primary key default gen_random_uuid(),
  waitlist_application_id uuid not null references public.waitlist_applications(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'issued' check (status in ('issued', 'accepted', 'expired', 'revoked')),
  issued_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  accepted_by_user_id uuid references auth.users(id) on delete set null,
  admission_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (expires_at > issued_at),
  check ((status = 'accepted') = (accepted_at is not null)),
  check ((status = 'revoked') = (revoked_at is not null)),
  check (status <> 'accepted' or accepted_by_user_id is not null),
  check (status <> 'accepted' or admission_id is not null)
);

create unique index if not exists waitlist_admission_invites_one_issued_idx
  on public.waitlist_admission_invites (waitlist_application_id)
  where status = 'issued';
create index if not exists waitlist_admission_invites_application_idx
  on public.waitlist_admission_invites (waitlist_application_id, issued_at desc);

create table if not exists public.workspace_admissions (
  id uuid primary key default gen_random_uuid(),
  waitlist_application_id uuid not null unique references public.waitlist_applications(id) on delete restrict,
  invite_id uuid not null unique references public.waitlist_admission_invites(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  workspace_id uuid not null unique references public.workspaces(id) on delete restrict,
  cohort_membership_id uuid,
  onboarding_status text not null default 'required' check (onboarding_status in ('required', 'completed')),
  admitted_at timestamptz not null default timezone('utc', now()),
  source text not null default 'waitlist_invite' check (source = 'waitlist_invite'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (workspace_id, cohort_membership_id)
    references public.workspace_cohort_memberships(workspace_id, id) on delete restrict
);

alter table public.waitlist_admission_invites
  drop constraint if exists waitlist_admission_invites_admission_id_fkey;
alter table public.waitlist_admission_invites
  add constraint waitlist_admission_invites_admission_id_fkey
  foreign key (admission_id) references public.workspace_admissions(id) on delete restrict;

create index if not exists workspace_admissions_user_idx
  on public.workspace_admissions (user_id, admitted_at desc);
create index if not exists workspace_admissions_workspace_idx
  on public.workspace_admissions (workspace_id, admitted_at desc);

create table if not exists public.waitlist_admission_events (
  id uuid primary key default gen_random_uuid(),
  waitlist_application_id uuid not null references public.waitlist_applications(id) on delete restrict,
  invite_id uuid references public.waitlist_admission_invites(id) on delete restrict,
  admission_id uuid references public.workspace_admissions(id) on delete restrict,
  event_type text not null check (event_type in (
    'invite_issued', 'invite_revoked', 'invite_expired', 'invite_reissued',
    'invite_accepted', 'admission_started', 'admission_completed', 'admission_failed'
  )),
  actor_kind text not null check (actor_kind in ('system', 'internal', 'user')),
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists waitlist_admission_events_application_idx
  on public.waitlist_admission_events (waitlist_application_id, created_at desc);
create index if not exists waitlist_admission_events_invite_idx
  on public.waitlist_admission_events (invite_id, created_at desc);

create or replace function public.waitlist_admission_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists waitlist_admission_invites_updated_at on public.waitlist_admission_invites;
create trigger waitlist_admission_invites_updated_at
before update on public.waitlist_admission_invites
for each row execute function public.waitlist_admission_updated_at();

drop trigger if exists workspace_admissions_updated_at on public.workspace_admissions;
create trigger workspace_admissions_updated_at
before update on public.workspace_admissions
for each row execute function public.waitlist_admission_updated_at();

create or replace function public.prevent_waitlist_admission_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception using errcode = '55000', message = 'waitlist_admission_events_append_only';
end;
$$;

drop trigger if exists waitlist_admission_events_append_only on public.waitlist_admission_events;
create trigger waitlist_admission_events_append_only
before update or delete on public.waitlist_admission_events
for each row execute function public.prevent_waitlist_admission_event_mutation();

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
  v_now timestamptz := timezone('utc', now());
  v_reissued boolean := false;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'waitlist_admission_service_role_required';
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
  if exists (select 1 from public.workspace_admissions where waitlist_application_id = v_application.id) then
    raise exception using errcode = '23505', message = 'waitlist_application_already_admitted';
  end if;

  select invite.* into v_current
    from public.waitlist_admission_invites as invite
   where invite.waitlist_application_id = v_application.id and invite.status = 'issued'
   for update;
  if found then
    update public.waitlist_admission_invites
       set status = 'revoked', revoked_at = v_now
     where id = v_current.id;
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

create or replace function public.revoke_waitlist_admission_invite(
  p_invite_id uuid,
  p_actor_user_id uuid default null,
  p_reason text default 'revoked_by_internal_operator'
)
returns table (invite_id uuid, status text, changed boolean)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_invite public.waitlist_admission_invites;
  v_changed boolean := false;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'waitlist_admission_service_role_required';
  end if;
  select * into v_invite from public.waitlist_admission_invites where id = p_invite_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'waitlist_admission_invite_not_found'; end if;
  if v_invite.status = 'accepted' then
    raise exception using errcode = '22023', message = 'waitlist_admission_invite_already_accepted';
  end if;
  if v_invite.status = 'issued' then
    update public.waitlist_admission_invites
       set status = 'revoked', revoked_at = timezone('utc', now())
     where id = v_invite.id
     returning * into v_invite;
    v_changed := true;
    insert into public.waitlist_admission_events (
      waitlist_application_id, invite_id, event_type, actor_kind, actor_user_id, metadata
    ) values (
      v_invite.waitlist_application_id, v_invite.id, 'invite_revoked', 'internal', p_actor_user_id,
      jsonb_build_object('reason', left(trim(coalesce(p_reason, 'revoked_by_internal_operator')), 240))
    );
  end if;
  return query select v_invite.id, v_invite.status, v_changed;
end;
$$;

create or replace function public.get_waitlist_admission_status_by_token(
  p_status_token_hash text
)
returns table (
  application_status text,
  invite_status text,
  invite_expires_at timestamptz,
  admission_status text,
  admission_id uuid,
  workspace_id uuid,
  cohort text,
  cohort_number integer,
  cohort_limit integer,
  display_identity text,
  benefit_policy_key text,
  benefit_discount_percent smallint,
  benefit_duration_months smallint,
  benefit_status text,
  onboarding_status text,
  admitted_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_application public.waitlist_applications;
  v_invite public.waitlist_admission_invites;
  v_admission public.workspace_admissions;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'waitlist_admission_service_role_required';
  end if;
  select * into v_application from public.waitlist_applications
   where status_token_hash = p_status_token_hash;
  if not found then raise exception using errcode = 'P0002', message = 'waitlist_status_not_found'; end if;

  select * into v_invite from public.waitlist_admission_invites
   where waitlist_application_id = v_application.id
   order by issued_at desc limit 1;
  if v_invite.id is not null and v_invite.status = 'issued' and v_invite.expires_at <= timezone('utc', now()) then
    update public.waitlist_admission_invites
       set status = 'expired', revoked_at = null
     where id = v_invite.id
     returning * into v_invite;
    insert into public.waitlist_admission_events (
      waitlist_application_id, invite_id, event_type, actor_kind, metadata
    ) values (
      v_application.id, v_invite.id, 'invite_expired', 'system',
      jsonb_build_object('expired_at', v_invite.expires_at)
    );
  end if;

  select * into v_admission from public.workspace_admissions
   where waitlist_application_id = v_application.id;

  return query
  select v_application.status,
    v_invite.status,
    v_invite.expires_at,
    case when v_admission.id is null then 'not_admitted' else 'admitted' end,
    v_admission.id,
    v_admission.workspace_id,
    m.cohort,
    m.cohort_number,
    case when m.cohort = 'founding_25' then 25 when m.cohort = 'early_100' then 100 else null end,
    case when m.cohort = 'founding_25' then 'Founding 25' when m.cohort = 'early_100' then 'Early 100' else null end,
    b.policy_key,
    b.discount_percent,
    b.duration_months,
    b.status,
    v_admission.onboarding_status,
    v_admission.admitted_at
  from (select 1) as one
  left join public.workspace_cohort_memberships m on m.id = v_admission.cohort_membership_id
  left join public.workspace_cohort_benefit_entitlements b on b.workspace_id = v_admission.workspace_id;
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
  v_workspace public.workspaces;
  v_member public.workspace_members;
  v_assignment record;
  v_profile_initialized boolean := false;
  v_slug_base text;
  v_workspace_slug text;
  v_now timestamptz := timezone('utc', now());
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'waitlist_admission_service_role_required';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_user_id is null then
    raise exception using errcode = '22023', message = 'waitlist_admission_input_invalid';
  end if;

  select lower(trim(u.email)) into v_user_email from auth.users u where u.id = p_user_id;
  if v_user_email is null then raise exception using errcode = 'P0002', message = 'auth_user_not_found'; end if;

  select * into v_invite from public.waitlist_admission_invites where token_hash = p_token_hash for update;
  if not found then raise exception using errcode = '22023', message = 'waitlist_admission_invite_invalid'; end if;
  select * into v_application from public.waitlist_applications where id = v_invite.waitlist_application_id for update;
  if lower(trim(v_application.normalized_email)) <> v_user_email then
    raise exception using errcode = '42501', message = 'waitlist_admission_email_mismatch';
  end if;
  if v_invite.status = 'accepted' then
    select * into v_admission from public.workspace_admissions where id = v_invite.admission_id;
    if v_admission.user_id <> p_user_id then
      raise exception using errcode = '42501', message = 'waitlist_admission_user_mismatch';
    end if;
    return query
    select v_admission.id, v_invite.id, v_admission.waitlist_application_id, v_admission.user_id,
      v_admission.workspace_id, m.cohort, m.cohort_number,
      case when m.cohort = 'founding_25' then 25 when m.cohort = 'early_100' then 100 else null end,
      b.policy_key, b.status, (p.id is not null), v_admission.onboarding_status, v_admission.admitted_at, true
    from public.workspace_admissions a
    left join public.workspace_cohort_memberships m on m.id = a.cohort_membership_id
    left join public.workspace_cohort_benefit_entitlements b on b.workspace_id = a.workspace_id
    left join public.workspace_public_cohort_profiles p on p.workspace_id = a.workspace_id
    where a.id = v_admission.id;
    return;
  end if;
  if v_invite.status <> 'issued' then
    raise exception using errcode = '22023', message = 'waitlist_admission_invite_unusable';
  end if;
  if v_invite.expires_at <= v_now then
    update public.waitlist_admission_invites set status = 'expired' where id = v_invite.id;
    insert into public.waitlist_admission_events (waitlist_application_id, invite_id, event_type, actor_kind, metadata)
    values (v_application.id, v_invite.id, 'invite_expired', 'system', jsonb_build_object('expired_at', v_invite.expires_at));
    raise exception using errcode = '22023', message = 'waitlist_admission_invite_expired';
  end if;
  if v_application.email_verification_status <> 'verified' or v_application.status <> 'approved_for_invite' then
    raise exception using errcode = '22023', message = 'waitlist_application_not_approved_for_invite';
  end if;
  if exists (select 1 from public.workspace_admissions where waitlist_application_id = v_application.id) then
    raise exception using errcode = '23505', message = 'waitlist_application_admission_conflict';
  end if;

  insert into public.waitlist_admission_events (waitlist_application_id, invite_id, event_type, actor_kind, actor_user_id, metadata)
  values (v_application.id, v_invite.id, 'admission_started', 'system', p_user_id, jsonb_build_object('trace_id', p_trace_id));

  v_slug_base := trim(both '-' from regexp_replace(lower(trim(v_application.company_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base = '' then v_slug_base := 'workspace'; end if;
  v_workspace_slug := left(v_slug_base, 70) || '-' || substr(replace(v_application.id::text, '-', ''), 1, 8);

  insert into public.workspaces (name, slug, created_by)
  values (left(trim(v_application.company_name), 120), v_workspace_slug, p_user_id)
  returning * into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (v_workspace.id, p_user_id, 'owner', 'active')
  returning * into v_member;

  perform public.initialize_workspace_entitlements(v_workspace.id, null, p_user_id, p_trace_id);

  select * into v_assignment
    from public.assign_workspace_cohort_membership_with_benefit(
      v_workspace.id, v_application.id, p_user_id, 'admission', 'workspace_cohort_membership_v1'
    );

  if v_assignment.membership_id is not null then
    perform public.initialize_workspace_public_cohort_profile(v_workspace.id, v_workspace.slug, p_trace_id);
    v_profile_initialized := true;
  end if;

  insert into public.workspace_admissions (
    waitlist_application_id, invite_id, user_id, workspace_id, cohort_membership_id, onboarding_status, admitted_at
  ) values (
    v_application.id, v_invite.id, p_user_id, v_workspace.id, v_assignment.membership_id, 'required', v_now
  ) returning * into v_admission;

  update public.waitlist_admission_invites
     set status = 'accepted', accepted_at = v_now, accepted_by_user_id = p_user_id, admission_id = v_admission.id
   where id = v_invite.id
   returning * into v_invite;

  update public.waitlist_applications
     set converted_user_id = p_user_id, converted_workspace_id = v_workspace.id
   where id = v_application.id;

  insert into public.waitlist_admission_events (waitlist_application_id, invite_id, admission_id, event_type, actor_kind, actor_user_id, metadata)
  values
    (v_application.id, v_invite.id, v_admission.id, 'invite_accepted', 'user', p_user_id, '{}'::jsonb),
    (v_application.id, v_invite.id, v_admission.id, 'admission_completed', 'system', p_user_id,
      jsonb_build_object('workspace_id', v_workspace.id, 'cohort', v_assignment.cohort, 'cohort_number', v_assignment.cohort_number));

  insert into public.audit_log (workspace_id, actor_user_id, actor_kind, action, target_type, target_id, trace_id, metadata)
  values (v_workspace.id, p_user_id, 'service', 'workspace.admission_completed', 'workspace_admission', v_admission.id, p_trace_id,
    jsonb_build_object('waitlist_application_id', v_application.id, 'invite_id', v_invite.id, 'cohort', v_assignment.cohort, 'cohort_number', v_assignment.cohort_number));

  return query select v_admission.id, v_invite.id, v_admission.waitlist_application_id, v_admission.user_id,
    v_admission.workspace_id, v_assignment.cohort, v_assignment.cohort_number,
    case when v_assignment.cohort = 'founding_25' then 25 when v_assignment.cohort = 'early_100' then 100 else null end,
    v_assignment.benefit_policy_key, v_assignment.benefit_status, v_profile_initialized,
    v_admission.onboarding_status, v_admission.admitted_at, false;
end;
$$;

alter table public.waitlist_admission_invites enable row level security;
alter table public.workspace_admissions enable row level security;
alter table public.waitlist_admission_events enable row level security;

revoke all on public.waitlist_admission_invites from public, anon, authenticated;
revoke all on public.workspace_admissions from public, anon, authenticated;
revoke all on public.waitlist_admission_events from public, anon, authenticated;
grant all on public.waitlist_admission_invites to service_role;
grant all on public.workspace_admissions to service_role;
grant all on public.waitlist_admission_events to service_role;

revoke all on function public.issue_waitlist_admission_invite(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.revoke_waitlist_admission_invite(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_waitlist_admission_status_by_token(text) from public, anon, authenticated;
revoke all on function public.accept_waitlist_admission_invite(text, uuid, text) from public, anon, authenticated;
grant execute on function public.issue_waitlist_admission_invite(uuid, text, uuid) to service_role;
grant execute on function public.revoke_waitlist_admission_invite(uuid, uuid, text) to service_role;
grant execute on function public.get_waitlist_admission_status_by_token(text) to service_role;
grant execute on function public.accept_waitlist_admission_invite(text, uuid, text) to service_role;

comment on table public.waitlist_admission_invites is 'Single-use hashed admission invites; approval and invite issuance never reserve cohort inventory.';
comment on table public.workspace_admissions is 'Authoritative admitted workspace relationship; one waitlist application creates at most one workspace admission.';
comment on table public.waitlist_admission_events is 'Append-only invite/admission events without raw invite tokens.';
comment on column public.workspace_admissions.onboarding_status is 'Persistent onboarding seam; admission and product access do not depend on browser state.';
