-- Forward-only repair for pgcrypto functions used by the 13A.3 referral RPCs.
-- Keep SECURITY DEFINER search_path constrained; qualify extension functions instead.

create or replace function public.ensure_waitlist_referral_identity(p_application_id uuid)
returns table (referral_identity_id uuid, public_code text, created boolean)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_existing public.waitlist_referral_identities;
  v_application public.waitlist_applications;
  v_code text;
  v_inserted public.waitlist_referral_identities;
  v_attempt integer;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'waitlist_referral_service_role_required';
  end if;
  select * into v_application from public.waitlist_applications where id = p_application_id;
  if not found then raise exception using errcode = 'P0002', message = 'waitlist_application_not_found'; end if;
  if v_application.email_verification_status <> 'verified' then
    raise exception using errcode = '42501', message = 'waitlist_referral_verified_applicant_required';
  end if;
  select * into v_existing from public.waitlist_referral_identities where waitlist_application_id = p_application_id;
  if found then return query select v_existing.id, v_existing.public_code, false; return; end if;

  for v_attempt in 1..5 loop
    v_code := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
    begin
      insert into public.waitlist_referral_identities (waitlist_application_id, public_code)
      values (p_application_id, v_code)
      on conflict (waitlist_application_id) do nothing
      returning * into v_inserted;
      if v_inserted.id is null then
        select * into v_existing from public.waitlist_referral_identities where waitlist_application_id = p_application_id;
        if found then return query select v_existing.id, v_existing.public_code, false; return; end if;
      else
        insert into public.waitlist_referral_events (
          application_id, referral_identity_id, event_key, event_type, actor_kind, metadata
        ) values (
          p_application_id, v_inserted.id, 'referral-identity-created:' || v_inserted.id::text,
          'referral_identity_created', 'service', jsonb_build_object('public_code_version', 'referral_code_v1')
        ) on conflict (event_key) do nothing;
        return query select v_inserted.id, v_inserted.public_code, true; return;
      end if;
    exception when unique_violation then
      -- A public-code collision is retried with fresh entropy.
    end;
  end loop;
  raise exception using errcode = '23505', message = 'waitlist_referral_identity_generation_failed';
end;
$$;

create or replace function public.process_waitlist_referral_verification(
  p_referred_application_id uuid,
  p_policy_key text,
  p_threshold integer
)
returns table (referrer_application_id uuid, verified_count integer, priority_status text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_referred public.waitlist_applications;
  v_referral public.waitlist_referrals;
  v_referrer public.waitlist_applications;
  v_priority public.waitlist_priority_access;
  v_count integer;
  v_previous_revoked_at timestamptz;
begin
  if not public.is_service_role() then raise exception using errcode = '42501', message = 'waitlist_referral_service_role_required'; end if;
  if p_policy_key is null or char_length(trim(p_policy_key)) not between 1 and 120 or p_threshold is null or p_threshold < 1 then
    raise exception using errcode = '22023', message = 'waitlist_priority_policy_invalid';
  end if;
  select * into v_referred from public.waitlist_applications where id = p_referred_application_id;
  if not found then raise exception using errcode = 'P0002', message = 'waitlist_application_not_found'; end if;
  if v_referred.email_verification_status <> 'verified' then raise exception using errcode = '42501', message = 'waitlist_verified_application_required'; end if;
  perform public.ensure_waitlist_referral_identity(p_referred_application_id);
  select * into v_referral from public.waitlist_referrals where referred_application_id = p_referred_application_id for update;
  if v_referral.id is null then return query select null::uuid, 0, 'normal'; return; end if;
  if v_referral.status = 'pending' then
    update public.waitlist_referrals set status = 'verified', verified_at = timezone('utc', now()) where id = v_referral.id returning * into v_referral;
    insert into public.waitlist_referral_events (
      application_id, referral_id, event_key, event_type, actor_kind, metadata
    ) values (
      v_referral.referrer_application_id, v_referral.id, 'referral-verified:' || v_referral.id::text,
      'referral_verified', 'service', jsonb_build_object('referred_application_id', v_referral.referred_application_id)
    ) on conflict (event_key) do nothing;
  end if;
  select * into v_referrer from public.waitlist_applications where id = v_referral.referrer_application_id for update;
  select count(*)::integer into v_count from public.waitlist_referrals where referrer_application_id = v_referral.referrer_application_id and status = 'verified';
  select * into v_priority from public.waitlist_priority_access where waitlist_application_id = v_referral.referrer_application_id for update;
  if v_priority.id is null and v_count >= p_threshold then
    insert into public.waitlist_priority_access (
      waitlist_application_id, policy_key, threshold, verified_referral_count, status, source
    ) values (
      v_referral.referrer_application_id, trim(p_policy_key), p_threshold, v_count, 'granted', 'verified_referrals'
    ) returning * into v_priority;
    insert into public.waitlist_referral_events (
      application_id, priority_access_id, event_key, event_type, actor_kind, metadata
    ) values (
      v_referral.referrer_application_id, v_priority.id, 'priority-granted:' || v_priority.id::text,
      'priority_access_granted', 'system', jsonb_build_object('policy_key', p_policy_key, 'threshold', p_threshold, 'verified_count', v_count)
    ) on conflict (event_key) do nothing;
  elsif v_priority.id is not null and v_priority.status = 'granted' and v_count < v_priority.threshold then
    update public.waitlist_priority_access
       set status = 'revoked', revoked_at = timezone('utc', now()), verified_referral_count = v_count, reason = 'verified_referral_count_below_threshold'
     where id = v_priority.id
     returning * into v_priority;
    insert into public.waitlist_referral_events (
      application_id, priority_access_id, event_key, event_type, actor_kind, metadata
    ) values (
      v_referral.referrer_application_id, v_priority.id, 'priority-revoked:' || v_priority.id::text || ':' || v_count::text,
      'priority_access_revoked', 'system', jsonb_build_object('verified_count', v_count, 'reason', 'verified_referral_count_below_threshold')
    ) on conflict (event_key) do nothing;
  elsif v_priority.id is not null and v_priority.status = 'revoked'
    and v_priority.reason in ('verified_referral_invalidated', 'verified_referral_count_below_threshold')
    and v_count >= v_priority.threshold then
    v_previous_revoked_at := v_priority.revoked_at;
    update public.waitlist_priority_access
       set status = 'granted', granted_at = timezone('utc', now()), revoked_at = null,
           verified_referral_count = v_count, reason = null
     where id = v_priority.id
     returning * into v_priority;
    insert into public.waitlist_referral_events (
      application_id, priority_access_id, event_key, event_type, actor_kind, metadata
    ) values (
      v_referral.referrer_application_id, v_priority.id,
      'priority-granted:' || v_priority.id::text || ':regrant:' || encode(extensions.digest(coalesce(v_previous_revoked_at::text, '') || ':' || v_count::text, 'sha256'), 'hex'),
      'priority_access_granted', 'system', jsonb_build_object('policy_key', p_policy_key, 'threshold', p_threshold, 'verified_count', v_count, 'regrant', true)
    ) on conflict (event_key) do nothing;
  elsif v_priority.id is not null then
    update public.waitlist_priority_access set verified_referral_count = v_count where id = v_priority.id returning * into v_priority;
  end if;
  return query select v_referral.referrer_application_id, v_count, coalesce(v_priority.status, 'normal');
end;
$$;

create or replace function public.invalidate_waitlist_referral(
  p_referral_id uuid,
  p_reason text,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_referral public.waitlist_referrals;
  v_referrer public.waitlist_applications;
  v_priority public.waitlist_priority_access;
  v_count integer;
  v_actor_kind text := case when p_actor_user_id is null then 'service' else 'admin' end;
begin
  if not public.is_service_role() then raise exception using errcode = '42501', message = 'waitlist_referral_service_role_required'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 240 then raise exception using errcode = '22023', message = 'waitlist_referral_invalidation_reason_invalid'; end if;
  select * into v_referral from public.waitlist_referrals where id = p_referral_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'waitlist_referral_not_found'; end if;
  if v_referral.status = 'invalidated' then return; end if;
  select * into v_referrer from public.waitlist_applications where id = v_referral.referrer_application_id for update;
  update public.waitlist_referrals
     set status = 'invalidated', invalidated_at = timezone('utc', now()), invalid_reason = trim(p_reason)
   where id = p_referral_id
   returning * into v_referral;
  insert into public.waitlist_referral_events (
    application_id, referral_id, event_key, event_type, actor_kind, actor_user_id, metadata
  ) values (
    v_referral.referrer_application_id, v_referral.id,
    'referral-invalidated:' || v_referral.id::text || ':' || encode(extensions.digest(trim(p_reason), 'sha256'), 'hex'),
    'referral_invalidated', v_actor_kind, p_actor_user_id, jsonb_build_object('reason_digest', encode(extensions.digest(trim(p_reason), 'sha256'), 'hex'))
  ) on conflict (event_key) do nothing;
  if v_referral.status = 'invalidated' and v_referral.verified_at is not null then
    select count(*)::integer into v_count from public.waitlist_referrals where referrer_application_id = v_referral.referrer_application_id and status = 'verified';
    select * into v_priority from public.waitlist_priority_access where waitlist_application_id = v_referral.referrer_application_id for update;
    if v_priority.id is not null and v_priority.status = 'granted' and v_count < v_priority.threshold then
      update public.waitlist_priority_access
         set status = 'revoked', revoked_at = timezone('utc', now()), verified_referral_count = v_count, reason = 'verified_referral_invalidated'
       where id = v_priority.id returning * into v_priority;
      insert into public.waitlist_referral_events (
        application_id, priority_access_id, event_key, event_type, actor_kind, actor_user_id, metadata
      ) values (
        v_referral.referrer_application_id, v_priority.id, 'priority-revoked:' || v_priority.id::text || ':invalidation:' || v_referral.id::text,
        'priority_access_revoked', v_actor_kind, p_actor_user_id, jsonb_build_object('verified_count', v_count, 'reason', 'verified_referral_invalidated')
      ) on conflict (event_key) do nothing;
    end if;
  end if;
end;
$$;

create or replace function public.revoke_waitlist_priority_access(
  p_application_id uuid,
  p_reason text,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_priority public.waitlist_priority_access;
  v_actor_kind text := case when p_actor_user_id is null then 'service' else 'admin' end;
begin
  if not public.is_service_role() then raise exception using errcode = '42501', message = 'waitlist_referral_service_role_required'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 240 then raise exception using errcode = '22023', message = 'waitlist_priority_revocation_reason_invalid'; end if;
  select * into v_priority from public.waitlist_priority_access where waitlist_application_id = p_application_id for update;
  if not found or v_priority.status = 'revoked' then return; end if;
  update public.waitlist_priority_access
     set status = 'revoked', revoked_at = timezone('utc', now()), reason = trim(p_reason)
   where id = v_priority.id returning * into v_priority;
  insert into public.waitlist_referral_events (
    application_id, priority_access_id, event_key, event_type, actor_kind, actor_user_id, metadata
  ) values (
    p_application_id, v_priority.id, 'priority-revoked:' || v_priority.id::text || ':manual:' || encode(extensions.digest(trim(p_reason), 'sha256'), 'hex'),
    'priority_access_revoked', v_actor_kind, p_actor_user_id, jsonb_build_object('reason_digest', encode(extensions.digest(trim(p_reason), 'sha256'), 'hex'))
  ) on conflict (event_key) do nothing;
end;
$$;

-- CREATE OR REPLACE preserves the existing owners and service_role-only grants.
