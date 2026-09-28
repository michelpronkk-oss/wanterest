-- Forward-only repair for PL/pgSQL output-variable/column ambiguity in the
-- 13A.3 verification continuation. Table aliases preserve the public RPC
-- contract while making every affected reference explicit.

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
  select * into v_referred
    from public.waitlist_applications as wa
   where wa.id = p_referred_application_id;
  if not found then raise exception using errcode = 'P0002', message = 'waitlist_application_not_found'; end if;
  if v_referred.email_verification_status <> 'verified' then raise exception using errcode = '42501', message = 'waitlist_verified_application_required'; end if;
  perform public.ensure_waitlist_referral_identity(p_referred_application_id);
  select * into v_referral
    from public.waitlist_referrals as wr
   where wr.referred_application_id = p_referred_application_id
   for update;
  if v_referral.id is null then return query select null::uuid, 0, 'normal'; return; end if;
  if v_referral.status = 'pending' then
    update public.waitlist_referrals as wr
       set status = 'verified', verified_at = timezone('utc', now())
     where wr.id = v_referral.id
     returning wr.* into v_referral;
    insert into public.waitlist_referral_events (
      application_id, referral_id, event_key, event_type, actor_kind, metadata
    ) values (
      v_referral.referrer_application_id, v_referral.id, 'referral-verified:' || v_referral.id::text,
      'referral_verified', 'service', jsonb_build_object('referred_application_id', v_referral.referred_application_id)
    ) on conflict (event_key) do nothing;
  end if;
  select * into v_referrer
    from public.waitlist_applications as wa
   where wa.id = v_referral.referrer_application_id
   for update;
  select count(*)::integer into v_count
    from public.waitlist_referrals as wr
   where wr.referrer_application_id = v_referral.referrer_application_id
     and wr.status = 'verified';
  select * into v_priority
    from public.waitlist_priority_access as pa
   where pa.waitlist_application_id = v_referral.referrer_application_id
   for update;
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
    update public.waitlist_priority_access as pa
       set status = 'revoked', revoked_at = timezone('utc', now()), verified_referral_count = v_count, reason = 'verified_referral_count_below_threshold'
     where pa.id = v_priority.id
     returning pa.* into v_priority;
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
    update public.waitlist_priority_access as pa
       set status = 'granted', granted_at = timezone('utc', now()), revoked_at = null,
           verified_referral_count = v_count, reason = null
     where pa.id = v_priority.id
     returning pa.* into v_priority;
    insert into public.waitlist_referral_events (
      application_id, priority_access_id, event_key, event_type, actor_kind, metadata
    ) values (
      v_referral.referrer_application_id, v_priority.id,
      'priority-granted:' || v_priority.id::text || ':regrant:' || encode(extensions.digest(coalesce(v_previous_revoked_at::text, '') || ':' || v_count::text, 'sha256'), 'hex'),
      'priority_access_granted', 'system', jsonb_build_object('policy_key', p_policy_key, 'threshold', p_threshold, 'verified_count', v_count, 'regrant', true)
    ) on conflict (event_key) do nothing;
  elsif v_priority.id is not null then
    update public.waitlist_priority_access as pa
       set verified_referral_count = v_count
     where pa.id = v_priority.id
     returning pa.* into v_priority;
  end if;
  return query select v_referral.referrer_application_id, v_count, coalesce(v_priority.status, 'normal');
end;
$$;
