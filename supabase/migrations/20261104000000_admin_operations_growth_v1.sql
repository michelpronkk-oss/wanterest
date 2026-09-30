-- Admin Operations + Growth Intelligence V1.
-- Forward-only additions: preserve existing waitlist transitions, invitation
-- issuance, automatic admission and permanent cohort allocation as authority.

create unique index if not exists admin_audit_events_request_idempotency_idx
  on public.admin_audit_events (actor_user_id, action, resource_type, resource_id, request_id)
  where request_id is not null and resource_id is not null;

create or replace function public.admin_transition_waitlist_application(
  p_application_id uuid,
  p_action text,
  p_actor_user_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_before text;
  v_after text;
  v_audit public.admin_audit_events;
  v_action text;
  v_allowed boolean := true;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'admin_service_role_required';
  end if;
  if p_action is null or p_action not in ('approve', 'hold', 'reject') or p_request_id is null or p_application_id is null then
    raise exception using errcode = '22023', message = 'admin_lifecycle_input_invalid';
  end if;
  if p_action in ('hold', 'reject') and char_length(trim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'admin_lifecycle_reason_required';
  end if;
  select membership.role into v_role
    from public.admin_memberships as membership
   where membership.user_id = p_actor_user_id
     and membership.status = 'active'
     and membership.role in ('founder', 'operations_admin');
  if v_role is null then
    raise exception using errcode = '42501', message = 'admin_lifecycle_membership_required';
  end if;

  v_action := 'early_access.' || p_action;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_actor_user_id::text || ':' || v_action || ':' || p_application_id::text || ':' || p_request_id::text, 0));
  select audit.* into v_audit
    from public.admin_audit_events as audit
   where audit.actor_user_id = p_actor_user_id
     and audit.action = v_action
     and audit.resource_type = 'waitlist_application'
     and audit.resource_id = p_application_id::text
     and audit.request_id = p_request_id::text;
  if found then
    return v_audit.context || pg_catalog.jsonb_build_object('idempotent', true);
  end if;

  select application.status into v_before
    from public.waitlist_applications as application
   where application.id = p_application_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'waitlist_application_not_found';
  end if;
  v_after := v_before;

  if p_action = 'approve' then
    if v_before = 'verified' then
      perform public.transition_waitlist_application(p_application_id, 'under_review', p_actor_user_id, null);
      perform public.transition_waitlist_application(p_application_id, 'approved_for_invite', p_actor_user_id, null);
      v_after := 'approved_for_invite';
    elsif v_before = 'under_review' then
      perform public.transition_waitlist_application(p_application_id, 'approved_for_invite', p_actor_user_id, null);
      v_after := 'approved_for_invite';
    elsif v_before <> 'approved_for_invite' then
      v_allowed := false;
    end if;
  elsif p_action = 'hold' then
    if v_before = 'verified' then
      perform public.transition_waitlist_application(p_application_id, 'under_review', p_actor_user_id, trim(p_reason));
      v_after := 'under_review';
    elsif v_before <> 'under_review' then
      v_allowed := false;
    end if;
  elsif p_action = 'reject' then
    if v_before = 'verified' then
      perform public.transition_waitlist_application(p_application_id, 'under_review', p_actor_user_id, trim(p_reason));
      perform public.transition_waitlist_application(p_application_id, 'declined', p_actor_user_id, trim(p_reason));
      v_after := 'declined';
    elsif v_before = 'under_review' then
      perform public.transition_waitlist_application(p_application_id, 'declined', p_actor_user_id, trim(p_reason));
      v_after := 'declined';
    elsif v_before <> 'declined' then
      v_allowed := false;
    end if;
  end if;

  insert into public.admin_audit_events (
    actor_user_id, actor_role, action, resource_type, resource_id, reason,
    request_id, outcome, context
  ) values (
    p_actor_user_id, v_role, v_action, 'waitlist_application', p_application_id::text,
    nullif(trim(p_reason), ''), p_request_id::text,
    case when v_allowed then 'succeeded' else 'denied' end,
    pg_catalog.jsonb_build_object(
      'ok', v_allowed, 'idempotent', false, 'action', p_action,
      'previousStatus', v_before, 'status', case when v_allowed then v_after else v_before end
    )
  ) returning * into v_audit;
  return v_audit.context;
end;
$$;

create or replace function public.admin_issue_waitlist_invite(
  p_application_id uuid,
  p_action text,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_audit public.admin_audit_events;
  v_issue record;
  v_action text;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'admin_service_role_required';
  end if;
  if p_action is null or p_action not in ('send', 'resend') or p_request_id is null or p_application_id is null
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'admin_invite_input_invalid';
  end if;
  select membership.role into v_role
    from public.admin_memberships as membership
   where membership.user_id = p_actor_user_id
     and membership.status = 'active'
     and membership.role in ('founder', 'operations_admin');
  if v_role is null then
    raise exception using errcode = '42501', message = 'admin_lifecycle_membership_required';
  end if;
  v_action := 'early_access.invite_' || p_action;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_actor_user_id::text || ':' || v_action || ':' || p_application_id::text || ':' || p_request_id::text, 0));
  select audit.* into v_audit
    from public.admin_audit_events as audit
   where audit.actor_user_id = p_actor_user_id
     and audit.action = v_action
     and audit.resource_type = 'waitlist_application'
     and audit.resource_id = p_application_id::text
     and audit.request_id = p_request_id::text;
  if found then
    return v_audit.context || pg_catalog.jsonb_build_object('idempotent', true);
  end if;
  if p_action = 'send' and exists (
    select 1 from public.waitlist_admission_invites as invite
     where invite.waitlist_application_id = p_application_id and invite.status = 'issued'
  ) then
    raise exception using errcode = '22023', message = 'admin_invite_already_issued';
  end if;
  if p_action = 'resend' and not exists (
    select 1 from public.waitlist_admission_invites as invite
     where invite.waitlist_application_id = p_application_id and invite.status = 'issued'
  ) then
    raise exception using errcode = '22023', message = 'admin_invite_not_pending';
  end if;

  select issued.* into v_issue
    from public.issue_waitlist_admission_invite(p_application_id, p_token_hash, p_actor_user_id) as issued;
  insert into public.admin_audit_events (
    actor_user_id, actor_role, action, resource_type, resource_id,
    request_id, outcome, context
  ) values (
    p_actor_user_id, v_role, v_action, 'waitlist_application', p_application_id::text,
    p_request_id::text, 'succeeded',
    pg_catalog.jsonb_build_object(
      'ok', true, 'idempotent', false, 'action', p_action,
      'inviteId', v_issue.invite_id, 'issuedAt', v_issue.issued_at,
      'expiresAt', v_issue.expires_at, 'reissued', v_issue.reissued
    )
  ) returning * into v_audit;
  return v_audit.context || pg_catalog.jsonb_build_object(
    'recipientEmail', v_issue.recipient_email,
    'firstName', v_issue.first_name,
    'companyName', v_issue.company_name
  );
end;
$$;

create or replace function public.admin_revoke_waitlist_invite(
  p_invite_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_application_id uuid;
  v_audit public.admin_audit_events;
  v_result record;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'admin_service_role_required';
  end if;
  if p_invite_id is null or p_request_id is null or char_length(trim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'admin_revoke_input_invalid';
  end if;
  select membership.role into v_role
    from public.admin_memberships as membership
   where membership.user_id = p_actor_user_id
     and membership.status = 'active'
     and membership.role in ('founder', 'operations_admin');
  if v_role is null then
    raise exception using errcode = '42501', message = 'admin_lifecycle_membership_required';
  end if;
  select invite.waitlist_application_id into v_application_id
    from public.waitlist_admission_invites as invite
   where invite.id = p_invite_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'waitlist_admission_invite_not_found';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_actor_user_id::text || ':early_access.invite_revoke:' || p_invite_id::text || ':' || p_request_id::text, 0));
  select audit.* into v_audit
    from public.admin_audit_events as audit
   where audit.actor_user_id = p_actor_user_id
     and audit.action = 'early_access.invite_revoke'
     and audit.resource_type = 'waitlist_admission_invite'
     and audit.resource_id = p_invite_id::text
     and audit.request_id = p_request_id::text;
  if found then
    return v_audit.context || pg_catalog.jsonb_build_object('idempotent', true);
  end if;
  select revoked.* into v_result
    from public.revoke_waitlist_admission_invite(p_invite_id, p_actor_user_id, trim(p_reason)) as revoked;
  insert into public.admin_audit_events (
    actor_user_id, actor_role, action, resource_type, resource_id, reason,
    request_id, outcome, context
  ) values (
    p_actor_user_id, v_role, 'early_access.invite_revoke', 'waitlist_admission_invite', p_invite_id::text,
    trim(p_reason), p_request_id::text, 'succeeded',
    pg_catalog.jsonb_build_object('ok', true, 'idempotent', false, 'applicationId', v_application_id,
      'status', v_result.status, 'changed', v_result.changed)
  ) returning * into v_audit;
  return v_audit.context;
end;
$$;

create or replace function public.admin_record_invite_delivery(
  p_invite_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_delivery_state text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_invite public.waitlist_admission_invites;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'admin_service_role_required';
  end if;
  if p_invite_id is null or p_request_id is null or p_delivery_state is null
     or p_delivery_state not in ('sent', 'provider_failed', 'not_configured') then
    raise exception using errcode = '22023', message = 'admin_delivery_input_invalid';
  end if;
  select membership.role into v_role
    from public.admin_memberships as membership
   where membership.user_id = p_actor_user_id
     and membership.status = 'active'
     and membership.role in ('founder', 'operations_admin');
  if v_role is null then
    raise exception using errcode = '42501', message = 'admin_lifecycle_membership_required';
  end if;
  select invite.* into v_invite from public.waitlist_admission_invites as invite where invite.id = p_invite_id;
  if not found then raise exception using errcode = 'P0002', message = 'waitlist_admission_invite_not_found'; end if;
  insert into public.admin_audit_events (
    actor_user_id, actor_role, action, resource_type, resource_id,
    request_id, outcome, context
  ) values (
    p_actor_user_id, v_role, 'early_access.invite_delivery', 'waitlist_admission_invite', p_invite_id::text,
    p_request_id::text, case when p_delivery_state = 'sent' then 'succeeded' else 'failed' end,
    pg_catalog.jsonb_build_object('deliveryState', p_delivery_state, 'applicationId', v_invite.waitlist_application_id)
  );
end;
$$;

create or replace function public.admin_growth_daily_metrics(p_start_date date, p_end_date date)
returns table (
  metric_date date,
  applications_submitted bigint,
  applications_verified bigint,
  priority_earned bigint,
  invitations_approved bigint,
  invitations_sent bigint,
  invitations_accepted bigint,
  workspaces_admitted bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'admin_service_role_required';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date
     or p_end_date - p_start_date > 366 then
    raise exception using errcode = '22023', message = 'admin_growth_date_range_invalid';
  end if;
  return query
  with days as (
    select series.day_value::date as day_utc
      from pg_catalog.generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day') as series(day_value)
  ), submitted as (
    select (application.created_at at time zone 'UTC')::date as day_utc, count(*) as total
      from public.waitlist_applications as application
     where application.created_at >= p_start_date::timestamp at time zone 'UTC'
       and application.created_at < (p_end_date + 1)::timestamp at time zone 'UTC'
     group by 1
  ), verified as (
    select (event.created_at at time zone 'UTC')::date as day_utc, count(*) as total
      from public.waitlist_application_events as event
     where event.event_type = 'verification_succeeded'
       and event.created_at >= p_start_date::timestamp at time zone 'UTC'
       and event.created_at < (p_end_date + 1)::timestamp at time zone 'UTC'
     group by 1
  ), priority as (
    select (access.granted_at at time zone 'UTC')::date as day_utc, count(*) as total
      from public.waitlist_priority_access as access
     where access.status = 'granted'
       and access.granted_at >= p_start_date::timestamp at time zone 'UTC'
       and access.granted_at < (p_end_date + 1)::timestamp at time zone 'UTC'
     group by 1
  ), approved as (
    select (event.created_at at time zone 'UTC')::date as day_utc, count(*) as total
      from public.waitlist_application_events as event
     where event.event_type = 'status_transition' and event.to_status = 'approved_for_invite'
       and event.created_at >= p_start_date::timestamp at time zone 'UTC'
       and event.created_at < (p_end_date + 1)::timestamp at time zone 'UTC'
     group by 1
  ), sent as (
    select (event.created_at at time zone 'UTC')::date as day_utc, count(*) as total
      from public.waitlist_admission_events as event
     where event.event_type in ('invite_issued', 'invite_reissued')
       and event.created_at >= p_start_date::timestamp at time zone 'UTC'
       and event.created_at < (p_end_date + 1)::timestamp at time zone 'UTC'
     group by 1
  ), accepted as (
    select (event.created_at at time zone 'UTC')::date as day_utc, count(*) as total
      from public.waitlist_admission_events as event
     where event.event_type = 'invite_accepted'
       and event.created_at >= p_start_date::timestamp at time zone 'UTC'
       and event.created_at < (p_end_date + 1)::timestamp at time zone 'UTC'
     group by 1
  ), admitted as (
    select (admission.admitted_at at time zone 'UTC')::date as day_utc, count(*) as total
      from public.workspace_admissions as admission
     where admission.admitted_at >= p_start_date::timestamp at time zone 'UTC'
       and admission.admitted_at < (p_end_date + 1)::timestamp at time zone 'UTC'
     group by 1
  )
  select days.day_utc, coalesce(submitted.total, 0), coalesce(verified.total, 0),
    coalesce(priority.total, 0), coalesce(approved.total, 0), coalesce(sent.total, 0),
    coalesce(accepted.total, 0), coalesce(admitted.total, 0)
  from days
  left join submitted using (day_utc)
  left join verified using (day_utc)
  left join priority using (day_utc)
  left join approved using (day_utc)
  left join sent using (day_utc)
  left join accepted using (day_utc)
  left join admitted using (day_utc)
  order by days.day_utc;
end;
$$;

revoke all on function public.admin_transition_waitlist_application(uuid, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_issue_waitlist_invite(uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_revoke_waitlist_invite(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_record_invite_delivery(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_growth_daily_metrics(date, date) from public, anon, authenticated;
grant execute on function public.admin_transition_waitlist_application(uuid, text, uuid, text, uuid) to service_role;
grant execute on function public.admin_issue_waitlist_invite(uuid, text, uuid, uuid, text) to service_role;
grant execute on function public.admin_revoke_waitlist_invite(uuid, uuid, text, uuid) to service_role;
grant execute on function public.admin_record_invite_delivery(uuid, uuid, uuid, text) to service_role;
grant execute on function public.admin_growth_daily_metrics(date, date) to service_role;

comment on function public.admin_transition_waitlist_application(uuid, text, uuid, text, uuid) is
  'Server-only Admin lifecycle wrapper. Requires an active founder or operations_admin membership and delegates status changes to the canonical waitlist transition function.';
comment on function public.admin_issue_waitlist_invite(uuid, text, uuid, uuid, text) is
  'Server-only Admin invitation wrapper. Preserves canonical invite issuance and writes the Admin audit atomically; recipient data is returned only to the trusted server caller for delivery.';
comment on function public.admin_growth_daily_metrics(date, date) is
  'Server-only authoritative daily lifecycle counts; visitor analytics are maintained separately by Vercel Web Analytics.';
