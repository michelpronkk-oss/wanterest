-- Layer 13A.2: permanent workspace-level launch provenance.
-- This migration intentionally creates no membership rows and consumes no seats.

create table if not exists public.workspace_cohort_allocation_state (
  cohort text primary key check (cohort in ('founding_25', 'early_100')),
  next_number integer not null,
  capacity integer not null,
  assigned_count integer not null default 0,
  check (capacity > 0),
  check (next_number between 1 and capacity + 1),
  check (assigned_count between 0 and capacity),
  check (next_number = assigned_count + 1)
);

-- Seed only allocator state. Existing workspaces never consume a seat on migration.
select set_config('wanterest.cohort_allocator_mutation', 'migration_seed', true);
insert into public.workspace_cohort_allocation_state (cohort, next_number, capacity, assigned_count)
values
  ('founding_25', 1, 25, 0),
  ('early_100', 1, 100, 0)
on conflict (cohort) do nothing;
select set_config('wanterest.cohort_allocator_mutation', '', true);

create table if not exists public.workspace_cohort_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  cohort text not null check (cohort in ('founding_25', 'early_100')),
  cohort_number integer not null,
  assigned_at timestamptz not null default timezone('utc', now()),
  source_waitlist_application_id uuid references public.waitlist_applications(id) on delete set null,
  admission_principal_user_id uuid references auth.users(id) on delete set null,
  assignment_reason text not null default 'admission'
    check (char_length(trim(assignment_reason)) between 1 and 120),
  assignment_version text not null default 'workspace_cohort_membership_v1'
    check (char_length(trim(assignment_version)) between 1 and 120),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id),
  unique (workspace_id, id),
  check (
    (cohort = 'founding_25' and cohort_number between 1 and 25)
    or (cohort = 'early_100' and cohort_number between 1 and 100)
  ),
  unique (cohort, cohort_number)
);

create unique index if not exists workspace_cohort_memberships_source_waitlist_idx
  on public.workspace_cohort_memberships (source_waitlist_application_id)
  where source_waitlist_application_id is not null;

create index if not exists workspace_cohort_memberships_cohort_idx
  on public.workspace_cohort_memberships (cohort, cohort_number);

create table if not exists public.workspace_cohort_membership_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  membership_id uuid not null,
  event_type text not null check (event_type in ('membership_assigned')),
  actor_kind text not null check (actor_kind in ('service', 'system')),
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  foreign key (workspace_id, membership_id)
    references public.workspace_cohort_memberships (workspace_id, id)
    on delete restrict
);

create index if not exists workspace_cohort_membership_events_membership_idx
  on public.workspace_cohort_membership_events (workspace_id, membership_id, created_at);

create or replace function public.prevent_workspace_cohort_membership_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'workspace_cohort_membership_delete_forbidden';
  end if;
  raise exception using errcode = '55000', message = 'workspace_cohort_membership_immutable';
end;
$$;

drop trigger if exists workspace_cohort_memberships_immutable on public.workspace_cohort_memberships;
create trigger workspace_cohort_memberships_immutable
before update or delete on public.workspace_cohort_memberships
for each row execute function public.prevent_workspace_cohort_membership_mutation();

create or replace function public.prevent_workspace_cohort_membership_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception using errcode = '55000', message = 'workspace_cohort_membership_events_append_only';
end;
$$;

drop trigger if exists workspace_cohort_membership_events_append_only on public.workspace_cohort_membership_events;
create trigger workspace_cohort_membership_events_append_only
before update or delete on public.workspace_cohort_membership_events
for each row execute function public.prevent_workspace_cohort_membership_event_mutation();

create or replace function public.prevent_workspace_cohort_allocation_state_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('wanterest.cohort_allocator_mutation', true), '') not in ('assign', 'migration_seed') then
    raise exception using errcode = '55000', message = 'workspace_cohort_allocation_state_mutation_forbidden';
  end if;
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'workspace_cohort_allocation_state_delete_forbidden';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_cohort_allocation_state_guard on public.workspace_cohort_allocation_state;
create trigger workspace_cohort_allocation_state_guard
before insert or update or delete on public.workspace_cohort_allocation_state
for each row execute function public.prevent_workspace_cohort_allocation_state_mutation();

create or replace function public.assign_workspace_cohort_membership(
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
  assignment_version text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_existing public.workspace_cohort_memberships;
  v_founding public.workspace_cohort_allocation_state;
  v_early public.workspace_cohort_allocation_state;
  v_membership public.workspace_cohort_memberships;
  v_cohort text;
  v_number integer;
  v_now timestamptz := timezone('utc', now());
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'workspace_cohort_service_role_required';
  end if;
  if p_workspace_id is null then
    raise exception using errcode = '22023', message = 'workspace_cohort_workspace_required';
  end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;
  if p_assignment_reason is null or char_length(trim(p_assignment_reason)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'workspace_cohort_assignment_reason_invalid';
  end if;
  if p_assignment_version is null or char_length(trim(p_assignment_version)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'workspace_cohort_assignment_version_invalid';
  end if;
  if p_source_waitlist_application_id is not null and not exists (
    select 1
      from public.waitlist_applications
     where id = p_source_waitlist_application_id
       and email_verification_status = 'verified'
  ) then
    raise exception using errcode = '22023', message = 'workspace_cohort_waitlist_application_not_verified';
  end if;

  -- Lock both authoritative state rows in a fixed order. All special-cohort
  -- assignment decisions therefore serialize without MAX()+1 or seat gaps.
  select * into v_founding
    from public.workspace_cohort_allocation_state
   where cohort = 'founding_25'
   for update;
  select * into v_early
    from public.workspace_cohort_allocation_state
   where cohort = 'early_100'
   for update;
  if v_founding.cohort is null or v_early.cohort is null then
    raise exception using errcode = 'P0001', message = 'workspace_cohort_allocator_uninitialized';
  end if;

  select * into v_existing
    from public.workspace_cohort_memberships
   where workspace_id = p_workspace_id;
  if found then
    if p_source_waitlist_application_id is not null
       and v_existing.source_waitlist_application_id is distinct from p_source_waitlist_application_id then
      raise exception using errcode = '23505', message = 'workspace_cohort_source_conflict';
    end if;
    return query
    select 'existing', v_existing.id, v_existing.workspace_id, v_existing.cohort,
      v_existing.cohort_number, v_existing.assigned_at, v_existing.source_waitlist_application_id,
      v_existing.admission_principal_user_id, v_existing.assignment_reason, v_existing.assignment_version;
    return;
  end if;

  if p_source_waitlist_application_id is not null and exists (
    select 1 from public.workspace_cohort_memberships
     where source_waitlist_application_id = p_source_waitlist_application_id
  ) then
    raise exception using errcode = '23505', message = 'workspace_cohort_source_already_assigned';
  end if;

  if v_founding.next_number <= v_founding.capacity then
    v_cohort := 'founding_25';
    v_number := v_founding.next_number;
  elsif v_early.next_number <= v_early.capacity then
    v_cohort := 'early_100';
    v_number := v_early.next_number;
  else
    return query
    select 'no_special_cohort', null::uuid, p_workspace_id, null::text, null::integer,
      null::timestamptz, p_source_waitlist_application_id, p_admission_principal_user_id,
      trim(p_assignment_reason), trim(p_assignment_version);
    return;
  end if;

  perform set_config('wanterest.cohort_allocator_mutation', 'assign', true);
  insert into public.workspace_cohort_memberships (
    workspace_id, cohort, cohort_number, assigned_at, source_waitlist_application_id,
    admission_principal_user_id, assignment_reason, assignment_version
  ) values (
    p_workspace_id, v_cohort, v_number, v_now, p_source_waitlist_application_id,
    p_admission_principal_user_id, trim(p_assignment_reason), trim(p_assignment_version)
  ) returning * into v_membership;

  if v_cohort = 'founding_25' then
    update public.workspace_cohort_allocation_state
       set next_number = next_number + 1, assigned_count = assigned_count + 1
     where cohort = 'founding_25';
  else
    update public.workspace_cohort_allocation_state
       set next_number = next_number + 1, assigned_count = assigned_count + 1
     where cohort = 'early_100';
  end if;

  insert into public.workspace_cohort_membership_events (
    workspace_id, membership_id, event_type, actor_kind, actor_user_id, metadata
  ) values (
    v_membership.workspace_id, v_membership.id, 'membership_assigned', 'service',
    p_admission_principal_user_id,
    jsonb_build_object(
      'assignment_reason', v_membership.assignment_reason,
      'assignment_version', v_membership.assignment_version,
      'cohort', v_membership.cohort,
      'cohort_number', v_membership.cohort_number
    )
  );

  return query
  select 'assigned', v_membership.id, v_membership.workspace_id, v_membership.cohort,
    v_membership.cohort_number, v_membership.assigned_at, v_membership.source_waitlist_application_id,
    v_membership.admission_principal_user_id, v_membership.assignment_reason, v_membership.assignment_version;
end;
$$;

create or replace function public.get_workspace_cohort_identity(p_workspace_id uuid)
returns table (
  workspace_id uuid,
  cohort text,
  cohort_number integer,
  assigned_at timestamptz,
  cohort_limit integer,
  display_identity text,
  workspace_status text
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_cohort_access_denied';
  end if;
  return query
  select w.id,
    coalesce(m.cohort, 'none'),
    m.cohort_number,
    m.assigned_at,
    case when m.cohort = 'founding_25' then 25 when m.cohort = 'early_100' then 100 else null end,
    case when m.cohort = 'founding_25' then 'Founding 25'
         when m.cohort = 'early_100' then 'Early 100'
         else null end,
    w.status
  from public.workspaces w
  left join public.workspace_cohort_memberships m on m.workspace_id = w.id
  where w.id = p_workspace_id;
end;
$$;

alter table public.workspace_cohort_allocation_state enable row level security;
alter table public.workspace_cohort_memberships enable row level security;
alter table public.workspace_cohort_membership_events enable row level security;

revoke all on public.workspace_cohort_allocation_state from public, anon, authenticated;
revoke all on public.workspace_cohort_memberships from public, anon, authenticated;
revoke all on public.workspace_cohort_membership_events from public, anon, authenticated;
grant all on public.workspace_cohort_allocation_state to service_role;
grant all on public.workspace_cohort_memberships to service_role;
grant all on public.workspace_cohort_membership_events to service_role;

revoke all on function public.assign_workspace_cohort_membership(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_workspace_cohort_identity(uuid) from public, anon, authenticated;
grant execute on function public.assign_workspace_cohort_membership(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.get_workspace_cohort_identity(uuid) to authenticated, service_role;

comment on table public.workspace_cohort_memberships is 'Permanent workspace-level launch provenance; separate from waitlist Early Access identity and commercial benefits.';
comment on table public.workspace_cohort_membership_events is 'Append-only provenance events for permanent workspace cohort assignments; contains no secrets.';
comment on table public.workspace_cohort_allocation_state is 'Locked transactional seat state for the Founding 25 and Early 100 namespaces.';
comment on column public.workspace_cohort_memberships.cohort_number is 'Immutable namespace-local historical identity; never reused or renumbered.';
