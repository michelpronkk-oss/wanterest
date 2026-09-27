-- Layer 13A.2 forward repair: qualify SQL columns that collide with
-- RETURNS TABLE output variables in the assignment RPC.

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
  if not exists (
    select 1
      from public.workspaces as w
     where w.id = p_workspace_id
  ) then
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
      from public.waitlist_applications as wa
     where wa.id = p_source_waitlist_application_id
       and wa.email_verification_status = 'verified'
  ) then
    raise exception using errcode = '22023', message = 'workspace_cohort_waitlist_application_not_verified';
  end if;

  -- Lock both authoritative state rows in a fixed order. All special-cohort
  -- assignment decisions therefore serialize without MAX()+1 or seat gaps.
  select s.* into v_founding
    from public.workspace_cohort_allocation_state as s
   where s.cohort = 'founding_25'
   for update;
  select s.* into v_early
    from public.workspace_cohort_allocation_state as s
   where s.cohort = 'early_100'
   for update;
  if v_founding.cohort is null or v_early.cohort is null then
    raise exception using errcode = 'P0001', message = 'workspace_cohort_allocator_uninitialized';
  end if;

  select m.* into v_existing
    from public.workspace_cohort_memberships as m
   where m.workspace_id = p_workspace_id;
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
    select 1
      from public.workspace_cohort_memberships as m
     where m.source_waitlist_application_id = p_source_waitlist_application_id
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
    update public.workspace_cohort_allocation_state as s
       set next_number = s.next_number + 1, assigned_count = s.assigned_count + 1
     where s.cohort = 'founding_25';
  else
    update public.workspace_cohort_allocation_state as s
       set next_number = s.next_number + 1, assigned_count = s.assigned_count + 1
     where s.cohort = 'early_100';
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

revoke all on function public.assign_workspace_cohort_membership(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.assign_workspace_cohort_membership(uuid, uuid, uuid, text, text) to service_role;
