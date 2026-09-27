-- Layer 13A.3: referral attribution and categorical waitlist priority.
-- Additive only. No existing waitlist application receives a referral identity
-- or priority state from this migration.

create table if not exists public.waitlist_referral_identities (
  id uuid primary key default gen_random_uuid(),
  waitlist_application_id uuid not null,
  public_code text not null unique check (public_code ~ '^[A-Za-z0-9_-]{32,80}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (waitlist_application_id),
  unique (id, waitlist_application_id),
  foreign key (waitlist_application_id) references public.waitlist_applications(id) on delete restrict
);

create table if not exists public.waitlist_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_application_id uuid not null,
  referred_application_id uuid not null,
  referral_identity_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'invalidated')),
  attributed_at timestamptz not null default timezone('utc', now()),
  verified_at timestamptz,
  invalidated_at timestamptz,
  invalid_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (referred_application_id),
  unique (referral_identity_id, referred_application_id),
  check (referrer_application_id <> referred_application_id),
  check (status <> 'pending' or verified_at is null),
  check (status = 'invalidated' or invalidated_at is null),
  check (status <> 'invalidated' or invalidated_at is not null),
  foreign key (referrer_application_id) references public.waitlist_applications(id) on delete restrict,
  foreign key (referred_application_id) references public.waitlist_applications(id) on delete restrict,
  foreign key (referral_identity_id, referrer_application_id)
    references public.waitlist_referral_identities(id, waitlist_application_id) on delete restrict
);

create index if not exists waitlist_referrals_referrer_status_idx
  on public.waitlist_referrals (referrer_application_id, status, verified_at);

create table if not exists public.waitlist_priority_access (
  id uuid primary key default gen_random_uuid(),
  waitlist_application_id uuid not null unique,
  policy_key text not null check (char_length(trim(policy_key)) between 1 and 120),
  threshold integer not null check (threshold > 0),
  verified_referral_count integer not null check (verified_referral_count >= 0),
  status text not null check (status in ('granted', 'revoked')),
  granted_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  reason text,
  source text not null default 'verified_referrals',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (status = 'granted' or revoked_at is not null),
  foreign key (waitlist_application_id) references public.waitlist_applications(id) on delete restrict
);

create table if not exists public.waitlist_referral_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  referral_id uuid,
  referral_identity_id uuid,
  priority_access_id uuid,
  event_key text not null unique,
  event_type text not null check (event_type in (
    'referral_identity_created', 'referral_attributed', 'referral_verified',
    'referral_invalidated', 'priority_access_granted', 'priority_access_revoked'
  )),
  actor_kind text not null check (actor_kind in ('service', 'system', 'admin')),
  actor_user_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (application_id) references public.waitlist_applications(id) on delete restrict,
  foreign key (referral_id) references public.waitlist_referrals(id) on delete restrict,
  foreign key (referral_identity_id) references public.waitlist_referral_identities(id) on delete restrict,
  foreign key (priority_access_id) references public.waitlist_priority_access(id) on delete restrict
);

create index if not exists waitlist_referral_events_application_idx
  on public.waitlist_referral_events (application_id, created_at desc);

create or replace function public.prevent_waitlist_referral_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception using errcode = '55000', message = 'waitlist_referral_events_append_only';
end;
$$;

drop trigger if exists waitlist_referral_events_append_only on public.waitlist_referral_events;
create trigger waitlist_referral_events_append_only
before update or delete on public.waitlist_referral_events
for each row execute function public.prevent_waitlist_referral_event_mutation();

drop trigger if exists waitlist_priority_access_updated_at on public.waitlist_priority_access;
create trigger waitlist_priority_access_updated_at
before update on public.waitlist_priority_access
for each row execute function public.updated_at_trigger();

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
    v_code := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
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

create or replace function public.submit_waitlist_application_with_referral(
  p_email text,
  p_normalized_email text,
  p_first_name text,
  p_company_name text,
  p_company_website text,
  p_role_title text,
  p_use_case text,
  p_verification_token_hash text,
  p_verification_expires_at timestamptz,
  p_status_token_hash text,
  p_source text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null,
  p_utm_term text default null,
  p_referrer_category text default null,
  p_marketing_consent boolean default false,
  p_referral_code text default null
)
returns public.waitlist_applications
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.waitlist_applications;
  v_identity public.waitlist_referral_identities;
  v_referral public.waitlist_referrals;
  v_preexisting boolean;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'waitlist_referral_service_role_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_normalized_email)), 0));
  select exists (select 1 from public.waitlist_applications where normalized_email = lower(trim(p_normalized_email))) into v_preexisting;
  select * into v_row from public.submit_waitlist_application(
    p_email, p_normalized_email, p_first_name, p_company_name, p_company_website, p_role_title, p_use_case,
    p_verification_token_hash, p_verification_expires_at, p_status_token_hash, p_source, p_utm_source,
    p_utm_medium, p_utm_campaign, p_utm_content, p_utm_term, p_referrer_category, p_marketing_consent
  );

  if not v_preexisting and nullif(trim(p_referral_code), '') is not null then
    select i.* into v_identity
      from public.waitlist_referral_identities i
      join public.waitlist_applications referrer on referrer.id = i.waitlist_application_id
     where i.public_code = trim(p_referral_code)
       and referrer.email_verification_status = 'verified';
    if found then
      if v_identity.waitlist_application_id = v_row.id then
        insert into public.waitlist_referrals (
          referrer_application_id, referred_application_id, referral_identity_id, status, invalidated_at, invalid_reason
        ) values (
          v_identity.waitlist_application_id, v_row.id, v_identity.id, 'invalidated', timezone('utc', now()), 'self_referral'
        ) on conflict (referred_application_id) do nothing returning * into v_referral;
        if v_referral.id is not null then
          insert into public.waitlist_referral_events (
            application_id, referral_id, referral_identity_id, event_key, event_type, actor_kind, metadata
          ) values (
            v_row.id, v_referral.id, v_identity.id, 'referral-invalidated:' || v_referral.id::text,
            'referral_invalidated', 'service', jsonb_build_object('reason', 'self_referral')
          ) on conflict (event_key) do nothing;
        end if;
      else
        insert into public.waitlist_referrals (
          referrer_application_id, referred_application_id, referral_identity_id, status
        ) values (
          v_identity.waitlist_application_id, v_row.id, v_identity.id, 'pending'
        ) on conflict (referred_application_id) do nothing returning * into v_referral;
        if v_referral.id is not null then
          insert into public.waitlist_referral_events (
            application_id, referral_id, referral_identity_id, event_key, event_type, actor_kind, metadata
          ) values (
            v_identity.waitlist_application_id, v_referral.id, v_identity.id,
            'referral-attributed:' || v_referral.id::text, 'referral_attributed', 'service',
            jsonb_build_object('referred_application_id', v_row.id)
          ) on conflict (event_key) do nothing;
        end if;
      end if;
    end if;
  end if;
  return v_row;
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
  elsif v_priority.id is not null then
    update public.waitlist_priority_access set verified_referral_count = v_count where id = v_priority.id returning * into v_priority;
  end if;
  return query select v_referral.referrer_application_id, v_count, coalesce(v_priority.status, 'normal');
end;
$$;

create or replace function public.get_waitlist_referral_status(p_application_id uuid)
returns table (referral_code text, verified_count integer, priority_status text, priority_granted_at timestamptz)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_application public.waitlist_applications;
  v_identity record;
  v_referral_code text;
  v_priority public.waitlist_priority_access;
  v_count integer := 0;
begin
  if not public.is_service_role() then raise exception using errcode = '42501', message = 'waitlist_referral_service_role_required'; end if;
  select * into v_application from public.waitlist_applications where id = p_application_id;
  if not found then raise exception using errcode = 'P0002', message = 'waitlist_application_not_found'; end if;
  if v_application.email_verification_status = 'verified' then
    select * into v_identity from public.ensure_waitlist_referral_identity(p_application_id);
    v_referral_code := v_identity.public_code;
    select count(*)::integer into v_count from public.waitlist_referrals where referrer_application_id = p_application_id and status = 'verified';
  end if;
  select * into v_priority from public.waitlist_priority_access where waitlist_application_id = p_application_id;
  return query select
    v_referral_code,
    v_count,
    coalesce(v_priority.status, 'normal'),
    v_priority.granted_at;
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
    'referral-invalidated:' || v_referral.id::text || ':' || encode(digest(trim(p_reason), 'sha256'), 'hex'),
    'referral_invalidated', v_actor_kind, p_actor_user_id, jsonb_build_object('reason_digest', encode(digest(trim(p_reason), 'sha256'), 'hex'))
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
    p_application_id, v_priority.id, 'priority-revoked:' || v_priority.id::text || ':manual:' || encode(digest(trim(p_reason), 'sha256'), 'hex'),
    'priority_access_revoked', v_actor_kind, p_actor_user_id, jsonb_build_object('reason_digest', encode(digest(trim(p_reason), 'sha256'), 'hex'))
  ) on conflict (event_key) do nothing;
end;
$$;

alter table public.waitlist_referral_identities enable row level security;
alter table public.waitlist_referrals enable row level security;
alter table public.waitlist_priority_access enable row level security;
alter table public.waitlist_referral_events enable row level security;

revoke all on public.waitlist_referral_identities from public, anon, authenticated;
revoke all on public.waitlist_referrals from public, anon, authenticated;
revoke all on public.waitlist_priority_access from public, anon, authenticated;
revoke all on public.waitlist_referral_events from public, anon, authenticated;
grant all on public.waitlist_referral_identities to service_role;
grant all on public.waitlist_referrals to service_role;
grant all on public.waitlist_priority_access to service_role;
grant all on public.waitlist_referral_events to service_role;

revoke all on function public.ensure_waitlist_referral_identity(uuid) from public, anon, authenticated;
revoke all on function public.submit_waitlist_application_with_referral(text, text, text, text, text, text, text, text, timestamptz, text, text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.process_waitlist_referral_verification(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.get_waitlist_referral_status(uuid) from public, anon, authenticated;
revoke all on function public.invalidate_waitlist_referral(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.revoke_waitlist_priority_access(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.ensure_waitlist_referral_identity(uuid) to service_role;
grant execute on function public.submit_waitlist_application_with_referral(text, text, text, text, text, text, text, text, timestamptz, text, text, text, text, text, text, text, text, boolean, text) to service_role;
grant execute on function public.process_waitlist_referral_verification(uuid, text, integer) to service_role;
grant execute on function public.get_waitlist_referral_status(uuid) to service_role;
grant execute on function public.invalidate_waitlist_referral(uuid, text, uuid) to service_role;
grant execute on function public.revoke_waitlist_priority_access(uuid, text, uuid) to service_role;

comment on table public.waitlist_referral_identities is 'Opaque public referral identities for verified waitlist applicants; not authentication credentials.';
comment on table public.waitlist_referrals is 'First-writer-wins referral attribution and verification state; one referred application can credit one referrer.';
comment on table public.waitlist_priority_access is 'Categorical waitlist priority state, separate from Early Access, cohorts, workspaces, and billing.';
comment on table public.waitlist_referral_events is 'Append-only referral and priority audit history without raw email or token data.';
