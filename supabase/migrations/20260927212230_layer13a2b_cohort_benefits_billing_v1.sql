-- Layer 13A.2B: versioned cohort benefit eligibility and billing activation.
-- Forward-only. Cohort identity remains immutable and separate from this
-- time-bounded, mutable benefit state.

create table if not exists public.workspace_cohort_benefit_entitlements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cohort_membership_id uuid not null,
  policy_key text not null check (char_length(trim(policy_key)) between 1 and 120),
  discount_percent smallint not null check (discount_percent between 1 and 100),
  duration_months smallint not null check (duration_months between 1 and 120),
  status text not null default 'eligible' check (status in ('eligible', 'active', 'expired', 'revoked')),
  granted_at timestamptz not null default timezone('utc', now()),
  activated_at timestamptz,
  expires_at timestamptz,
  activation_subscription_id uuid,
  external_discount_reference text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id),
  unique (workspace_id, id),
  foreign key (workspace_id, cohort_membership_id)
    references public.workspace_cohort_memberships (workspace_id, id) on delete restrict,
  foreign key (workspace_id, activation_subscription_id)
    references public.subscriptions (workspace_id, id) on delete set null,
  check (expires_at is null or activated_at is not null),
  check (expires_at is null or expires_at > activated_at),
  check (status = 'eligible' or activated_at is not null),
  check (status = 'eligible' or expires_at is not null)
);

create index if not exists workspace_cohort_benefit_entitlements_status_idx
  on public.workspace_cohort_benefit_entitlements (workspace_id, status, expires_at);

create table if not exists public.workspace_cohort_benefit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  entitlement_id uuid not null,
  event_key text not null check (char_length(trim(event_key)) between 1 and 300),
  event_type text not null check (event_type in (
    'benefit_granted', 'benefit_activated', 'benefit_expired', 'benefit_revoked',
    'provider_discount_applied', 'provider_discount_removed'
  )),
  actor_kind text not null check (actor_kind in ('service', 'system', 'admin')),
  actor_user_id uuid,
  provider_event_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (event_key),
  unique (workspace_id, id),
  foreign key (workspace_id, entitlement_id)
    references public.workspace_cohort_benefit_entitlements (workspace_id, id) on delete restrict
);

create index if not exists workspace_cohort_benefit_events_entitlement_idx
  on public.workspace_cohort_benefit_events (workspace_id, entitlement_id, created_at);

create or replace function public.prevent_workspace_cohort_benefit_identity_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.workspace_id <> old.workspace_id
     or new.cohort_membership_id <> old.cohort_membership_id
     or new.policy_key <> old.policy_key
     or new.discount_percent <> old.discount_percent
     or new.duration_months <> old.duration_months
     or new.granted_at <> old.granted_at then
    raise exception using errcode = '23514', message = 'workspace_cohort_benefit_identity_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_cohort_benefit_identity_immutable on public.workspace_cohort_benefit_entitlements;
create trigger workspace_cohort_benefit_identity_immutable
before update on public.workspace_cohort_benefit_entitlements
for each row execute function public.prevent_workspace_cohort_benefit_identity_mutation();

create or replace function public.prevent_workspace_cohort_benefit_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception using errcode = '23514', message = 'workspace_cohort_benefit_events_append_only';
end;
$$;

drop trigger if exists workspace_cohort_benefit_events_append_only on public.workspace_cohort_benefit_events;
create trigger workspace_cohort_benefit_events_append_only
before update or delete on public.workspace_cohort_benefit_events
for each row execute function public.prevent_workspace_cohort_benefit_event_mutation();

drop trigger if exists workspace_cohort_benefit_entitlements_updated_at on public.workspace_cohort_benefit_entitlements;
create trigger workspace_cohort_benefit_entitlements_updated_at
before update on public.workspace_cohort_benefit_entitlements
for each row execute function public.updated_at_trigger();

create or replace function public.grant_workspace_cohort_benefit(
  p_workspace_id uuid,
  p_cohort_membership_id uuid,
  p_policy_key text,
  p_discount_percent integer,
  p_duration_months integer,
  p_actor_user_id uuid default null
)
returns table (
  entitlement_id uuid,
  created boolean,
  status text,
  policy_key text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_entitlement public.workspace_cohort_benefit_entitlements;
  v_created boolean := false;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'workspace_cohort_benefit_service_role_required';
  end if;
  if p_workspace_id is null or p_cohort_membership_id is null then
    raise exception using errcode = '22023', message = 'workspace_cohort_benefit_identity_required';
  end if;
  if not exists (
    select 1 from public.workspace_cohort_memberships as m
     where m.workspace_id = p_workspace_id and m.id = p_cohort_membership_id
  ) then
    raise exception using errcode = 'P0002', message = 'workspace_cohort_membership_not_found';
  end if;
  if p_policy_key is null or char_length(trim(p_policy_key)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'workspace_cohort_benefit_policy_invalid';
  end if;
  if p_discount_percent not between 1 and 100 or p_duration_months not between 1 and 120 then
    raise exception using errcode = '22023', message = 'workspace_cohort_benefit_terms_invalid';
  end if;

  insert into public.workspace_cohort_benefit_entitlements (
    workspace_id, cohort_membership_id, policy_key, discount_percent, duration_months
  ) values (
    p_workspace_id, p_cohort_membership_id, trim(p_policy_key), p_discount_percent, p_duration_months
  )
  on conflict (workspace_id) do nothing
  returning * into v_entitlement;

  if v_entitlement.id is not null then
    v_created := true;
    insert into public.workspace_cohort_benefit_events (
      workspace_id, entitlement_id, event_key, event_type, actor_kind, actor_user_id, metadata
    ) values (
      v_entitlement.workspace_id, v_entitlement.id,
      'benefit-granted:' || v_entitlement.id::text, 'benefit_granted', 'service', p_actor_user_id,
      jsonb_build_object(
        'policy_key', v_entitlement.policy_key,
        'discount_percent', v_entitlement.discount_percent,
        'duration_months', v_entitlement.duration_months,
        'cohort_membership_id', v_entitlement.cohort_membership_id
      )
    ) on conflict (event_key) do nothing;
  else
    select e.* into v_entitlement
      from public.workspace_cohort_benefit_entitlements as e
     where e.workspace_id = p_workspace_id
     for update;
  end if;

  return query select v_entitlement.id, v_created, v_entitlement.status, v_entitlement.policy_key;
end;
$$;

create or replace function public.activate_workspace_cohort_benefit(
  p_workspace_id uuid,
  p_activation_subscription_id uuid,
  p_activated_at timestamptz,
  p_provider_event_id text,
  p_actor_user_id uuid default null
)
returns table (
  entitlement_id uuid,
  activation_status text,
  activated_at timestamptz,
  expires_at timestamptz,
  changed boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_entitlement public.workspace_cohort_benefit_entitlements;
  v_changed boolean := false;
  v_event_key text;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'workspace_cohort_benefit_service_role_required';
  end if;
  if p_workspace_id is null or p_activation_subscription_id is null or p_activated_at is null then
    raise exception using errcode = '22023', message = 'workspace_cohort_benefit_activation_required';
  end if;
  if p_provider_event_id is null or char_length(trim(p_provider_event_id)) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'workspace_cohort_benefit_provider_event_required';
  end if;

  select e.* into v_entitlement
    from public.workspace_cohort_benefit_entitlements as e
   where e.workspace_id = p_workspace_id
   for update;
  if v_entitlement.id is null then
    raise exception using errcode = 'P0002', message = 'workspace_cohort_benefit_not_granted';
  end if;

  if v_entitlement.status = 'eligible' then
    update public.workspace_cohort_benefit_entitlements as e
       set status = 'active',
           activated_at = p_activated_at,
           expires_at = p_activated_at + make_interval(months => v_entitlement.duration_months),
           activation_subscription_id = p_activation_subscription_id
     where e.id = v_entitlement.id
     returning * into v_entitlement;
    v_changed := true;
    v_event_key := 'benefit-activated:' || v_entitlement.id::text || ':' || trim(p_provider_event_id);
    insert into public.workspace_cohort_benefit_events (
      workspace_id, entitlement_id, event_key, event_type, actor_kind, actor_user_id,
      provider_event_id, metadata
    ) values (
      v_entitlement.workspace_id, v_entitlement.id, v_event_key, 'benefit_activated', 'service',
      p_actor_user_id, trim(p_provider_event_id),
      jsonb_build_object('activated_at', v_entitlement.activated_at, 'expires_at', v_entitlement.expires_at)
    ) on conflict (event_key) do nothing;
  elsif v_entitlement.status = 'active' and v_entitlement.expires_at <= timezone('utc', now()) then
    update public.workspace_cohort_benefit_entitlements as e
       set status = 'expired'
     where e.id = v_entitlement.id
     returning * into v_entitlement;
    v_changed := true;
    insert into public.workspace_cohort_benefit_events (
      workspace_id, entitlement_id, event_key, event_type, actor_kind, actor_user_id, metadata
    ) values (
      v_entitlement.workspace_id, v_entitlement.id,
      'benefit-expired:' || v_entitlement.id::text || ':' || to_char(v_entitlement.expires_at at time zone 'utc', 'YYYYMMDD"T"HH24MISS.MS"Z"'),
      'benefit_expired', 'system', p_actor_user_id,
      jsonb_build_object('expired_at', v_entitlement.expires_at)
    ) on conflict (event_key) do nothing;
  end if;

  return query select v_entitlement.id, v_entitlement.status, v_entitlement.activated_at, v_entitlement.expires_at, v_changed;
end;
$$;

create or replace function public.revoke_workspace_cohort_benefit(
  p_workspace_id uuid,
  p_reason text,
  p_actor_user_id uuid default null
)
returns table (entitlement_id uuid, revocation_status text, changed boolean)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_entitlement public.workspace_cohort_benefit_entitlements;
  v_changed boolean := false;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'workspace_cohort_benefit_service_role_required';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 240 then
    raise exception using errcode = '22023', message = 'workspace_cohort_benefit_revocation_reason_invalid';
  end if;
  select e.* into v_entitlement
    from public.workspace_cohort_benefit_entitlements as e
   where e.workspace_id = p_workspace_id
   for update;
  if v_entitlement.id is null then
    raise exception using errcode = 'P0002', message = 'workspace_cohort_benefit_not_granted';
  end if;
  if v_entitlement.status <> 'revoked' then
    update public.workspace_cohort_benefit_entitlements as e
       set status = 'revoked'
     where e.id = v_entitlement.id
     returning * into v_entitlement;
    v_changed := true;
    insert into public.workspace_cohort_benefit_events (
      workspace_id, entitlement_id, event_key, event_type, actor_kind, actor_user_id, metadata
    ) values (
      v_entitlement.workspace_id, v_entitlement.id,
      'benefit-revoked:' || v_entitlement.id::text || ':' || encode(digest(trim(p_reason), 'sha256'), 'hex'),
      'benefit_revoked', 'admin', p_actor_user_id,
      jsonb_build_object('reason_digest', encode(digest(trim(p_reason), 'sha256'), 'hex'))
    ) on conflict (event_key) do nothing;
  end if;
  return query select v_entitlement.id, v_entitlement.status, v_changed;
end;
$$;

create or replace function public.get_workspace_cohort_benefit(p_workspace_id uuid)
returns table (
  workspace_id uuid,
  membership_id uuid,
  cohort text,
  cohort_number integer,
  cohort_limit integer,
  display_identity text,
  policy_key text,
  discount_percent smallint,
  duration_months smallint,
  status text,
  activated_at timestamptz,
  expires_at timestamptz,
  granted_at timestamptz,
  external_discount_reference text,
  activation_subscription_id uuid
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_service_role() and not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_cohort_benefit_access_denied';
  end if;
  return query
  select w.id,
    m.id,
    coalesce(m.cohort, 'none'),
    m.cohort_number,
    case m.cohort when 'founding_25' then 25 when 'early_100' then 100 else null end,
    case m.cohort when 'founding_25' then 'Founding 25' when 'early_100' then 'Early 100' else null end,
    e.policy_key,
    e.discount_percent,
    e.duration_months,
    case when e.status = 'active' and e.expires_at <= timezone('utc', now()) then 'expired' else e.status end,
    e.activated_at,
    e.expires_at,
    e.granted_at,
    e.external_discount_reference,
    e.activation_subscription_id
    from public.workspaces as w
    left join public.workspace_cohort_memberships as m on m.workspace_id = w.id
    left join public.workspace_cohort_benefit_entitlements as e on e.workspace_id = w.id
   where w.id = p_workspace_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;
end;
$$;

-- Admission is kept atomic: the existing identity allocator runs first, then
-- the versioned policy is granted in the same transaction. No current rows are
-- backfilled; future assignment calls use this wrapper explicitly.
create or replace function public.assign_workspace_cohort_membership_with_benefit(
  p_workspace_id uuid,
  p_source_waitlist_application_id uuid default null,
  p_admission_principal_user_id uuid default null,
  p_assignment_reason text default 'admission',
  p_assignment_version text default 'workspace_cohort_membership_v1'
)
returns table (
  assignment_status text,
  membership_id uuid,
  workspace_id uuid,
  cohort text,
  cohort_number integer,
  assigned_at timestamptz,
  source_waitlist_application_id uuid,
  admission_principal_user_id uuid,
  assignment_reason text,
  assignment_version text,
  benefit_policy_key text,
  benefit_status text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_assignment record;
  v_grant record;
  v_policy_key text;
  v_discount_percent integer;
  v_duration_months integer;
  v_benefit_policy_key text;
  v_benefit_status text;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'workspace_cohort_benefit_service_role_required';
  end if;

  select * into v_assignment
    from public.assign_workspace_cohort_membership(
      p_workspace_id, p_source_waitlist_application_id, p_admission_principal_user_id,
      p_assignment_reason, p_assignment_version
    );

  if v_assignment.cohort = 'founding_25' then
    v_policy_key := 'founding_25_v1';
    v_discount_percent := 30;
    v_duration_months := 24;
  elsif v_assignment.cohort = 'early_100' then
    v_policy_key := 'early_100_v1';
    v_discount_percent := 15;
    v_duration_months := 12;
  end if;

  if v_assignment.membership_id is not null then
    select * into v_grant from public.grant_workspace_cohort_benefit(
      v_assignment.workspace_id, v_assignment.membership_id, v_policy_key,
      v_discount_percent, v_duration_months, p_admission_principal_user_id
    );
    v_benefit_policy_key := v_grant.policy_key;
    v_benefit_status := v_grant.status;
  end if;

  return query select
    v_assignment.assignment_status, v_assignment.membership_id, v_assignment.workspace_id,
    v_assignment.cohort, v_assignment.cohort_number, v_assignment.assigned_at,
    v_assignment.source_waitlist_application_id, v_assignment.admission_principal_user_id,
    v_assignment.assignment_reason, v_assignment.assignment_version,
    v_benefit_policy_key, v_benefit_status;
end;
$$;

alter table public.workspace_cohort_benefit_entitlements enable row level security;
alter table public.workspace_cohort_benefit_events enable row level security;

revoke all on public.workspace_cohort_benefit_entitlements from public, anon, authenticated;
revoke all on public.workspace_cohort_benefit_events from public, anon, authenticated;
grant select on public.workspace_cohort_benefit_entitlements to authenticated;
grant all on public.workspace_cohort_benefit_entitlements to service_role;
grant all on public.workspace_cohort_benefit_events to service_role;

drop policy if exists workspace_cohort_benefit_entitlements_member_select on public.workspace_cohort_benefit_entitlements;
create policy workspace_cohort_benefit_entitlements_member_select
on public.workspace_cohort_benefit_entitlements
for select to authenticated
using (public.is_workspace_member(workspace_id));

revoke all on function public.grant_workspace_cohort_benefit(uuid, uuid, text, integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.activate_workspace_cohort_benefit(uuid, uuid, timestamptz, text, uuid) from public, anon, authenticated;
revoke all on function public.revoke_workspace_cohort_benefit(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.get_workspace_cohort_benefit(uuid) from public, anon;
revoke all on function public.assign_workspace_cohort_membership_with_benefit(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.grant_workspace_cohort_benefit(uuid, uuid, text, integer, integer, uuid) to service_role;
grant execute on function public.activate_workspace_cohort_benefit(uuid, uuid, timestamptz, text, uuid) to service_role;
grant execute on function public.revoke_workspace_cohort_benefit(uuid, text, uuid) to service_role;
grant execute on function public.get_workspace_cohort_benefit(uuid) to authenticated, service_role;
grant execute on function public.assign_workspace_cohort_membership_with_benefit(uuid, uuid, uuid, text, text) to service_role;

comment on table public.workspace_cohort_benefit_entitlements is 'Versioned cohort benefit state; separate from immutable cohort identity and normalized plan entitlements.';
comment on table public.workspace_cohort_benefit_events is 'Append-only benefit grant, activation, expiry, revocation, and provider synchronization audit.';
comment on column public.workspace_cohort_benefit_entitlements.policy_key is 'Code-backed policy identity; policy terms are snapshotted for grandfathering.';
comment on column public.workspace_cohort_benefit_entitlements.expires_at is 'Calendar-month expiry from the authoritative first paid activation timestamp.';
