create sequence if not exists public.waitlist_early_access_number_seq
  as bigint
  start with 1
  increment by 1
  minvalue 1;

create table if not exists public.waitlist_applications (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid(),
  early_access_number bigint unique,
  email text not null check (char_length(trim(email)) between 3 and 320),
  normalized_email text not null check (normalized_email = lower(trim(normalized_email))),
  first_name text not null check (char_length(trim(first_name)) between 1 and 80),
  company_name text not null check (char_length(trim(company_name)) between 1 and 160),
  company_website text,
  role_title text,
  use_case text not null check (char_length(trim(use_case)) between 1 and 1200),
  status text not null default 'pending' check (status in ('pending', 'verified', 'under_review', 'approved_for_invite', 'declined', 'withdrawn')),
  email_verification_status text not null default 'pending' check (email_verification_status in ('pending', 'verified')),
  verification_token_hash text not null unique check (verification_token_hash ~ '^[0-9a-f]{64}$'),
  verification_expires_at timestamptz not null,
  verification_used_at timestamptz,
  verified_at timestamptz,
  status_token_hash text not null unique check (status_token_hash ~ '^[0-9a-f]{64}$'),
  status_token_issued_at timestamptz not null default timezone('utc', now()),
  withdrawn_at timestamptz,
  source text check (source is null or char_length(trim(source)) between 1 and 80),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer_category text,
  marketing_consent boolean not null default false,
  transactional_email_allowed boolean not null default true,
  converted_user_id uuid references auth.users(id) on delete set null,
  converted_workspace_id uuid references public.workspaces(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (public_id),
  check ((status = 'withdrawn') = (withdrawn_at is not null)),
  check ((email_verification_status = 'verified') = (verified_at is not null)),
  check ((status = 'pending') or email_verification_status = 'verified'),
  check (early_access_number is null or early_access_number > 0)
);

create unique index if not exists waitlist_applications_normalized_email_idx
  on public.waitlist_applications (normalized_email);
create index if not exists waitlist_applications_status_created_idx
  on public.waitlist_applications (status, created_at desc);
create index if not exists waitlist_applications_public_id_idx
  on public.waitlist_applications (public_id);

create table if not exists public.waitlist_application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.waitlist_applications(id) on delete restrict,
  event_type text not null check (event_type in ('submitted', 'duplicate_submission', 'verification_sent', 'verification_succeeded', 'verification_failed', 'status_transition', 'withdrawn', 'rate_limited', 'abuse_rejected')),
  from_status text,
  to_status text,
  actor_kind text not null check (actor_kind in ('public', 'system', 'internal')),
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists waitlist_application_events_application_idx
  on public.waitlist_application_events (application_id, created_at desc);

create or replace function public.waitlist_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists waitlist_applications_updated_at on public.waitlist_applications;
create trigger waitlist_applications_updated_at
before update on public.waitlist_applications
for each row execute function public.waitlist_updated_at();

create or replace function public.prevent_waitlist_direct_mutation()
returns trigger language plpgsql set search_path = public as $$
declare
  mutation text := current_setting('wanterest.waitlist_mutation', true);
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'waitlist_application_delete_forbidden';
  end if;
  if tg_op = 'UPDATE' and new.early_access_number is distinct from old.early_access_number then
    if old.early_access_number is not null or mutation <> 'verify' then
      raise exception using errcode = '55000', message = 'early_access_number_immutable';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and mutation not in ('verify', 'transition', 'withdraw') then
    raise exception using errcode = '55000', message = 'waitlist_status_transition_required';
  end if;
  return new;
end;
$$;

drop trigger if exists waitlist_applications_guard on public.waitlist_applications;
create trigger waitlist_applications_guard
before update or delete on public.waitlist_applications
for each row execute function public.prevent_waitlist_direct_mutation();

create or replace function public.prevent_waitlist_event_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '55000', message = 'waitlist_application_events_append_only';
end;
$$;

drop trigger if exists waitlist_application_events_append_only on public.waitlist_application_events;
create trigger waitlist_application_events_append_only
before update or delete on public.waitlist_application_events
for each row execute function public.prevent_waitlist_event_mutation();

create or replace function public.submit_waitlist_application(
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
  p_marketing_consent boolean default false
)
returns public.waitlist_applications
language plpgsql security definer set search_path = public as $$
declare
  v_row public.waitlist_applications;
  v_inserted boolean := false;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'waitlist_service_role_required';
  end if;
  if p_normalized_email <> lower(trim(p_normalized_email)) then
    raise exception using errcode = '22023', message = 'invalid_normalized_email';
  end if;
  perform set_config('wanterest.waitlist_mutation', 'submit', true);
  insert into public.waitlist_applications (
    email, normalized_email, first_name, company_name, company_website, role_title,
    use_case, verification_token_hash, verification_expires_at, status_token_hash,
    source, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    referrer_category, marketing_consent
  ) values (
    trim(p_email), lower(trim(p_normalized_email)), trim(p_first_name), trim(p_company_name), nullif(trim(p_company_website), ''), nullif(trim(p_role_title), ''),
    trim(p_use_case), p_verification_token_hash, p_verification_expires_at, p_status_token_hash,
    nullif(trim(p_source), ''), nullif(trim(p_utm_source), ''), nullif(trim(p_utm_medium), ''), nullif(trim(p_utm_campaign), ''), nullif(trim(p_utm_content), ''), nullif(trim(p_utm_term), ''),
    nullif(trim(p_referrer_category), ''), coalesce(p_marketing_consent, false)
  ) on conflict (normalized_email) do nothing
  returning * into v_row;
  v_inserted := found;

  if not v_inserted then
    select * into v_row from public.waitlist_applications
    where normalized_email = lower(trim(p_normalized_email))
    for update;
    if v_row.status = 'pending' then
      update public.waitlist_applications as target
      set email = trim(p_email), first_name = trim(p_first_name), company_name = trim(p_company_name),
          company_website = nullif(trim(p_company_website), ''), role_title = nullif(trim(p_role_title), ''),
          use_case = trim(p_use_case), verification_token_hash = p_verification_token_hash,
          verification_expires_at = p_verification_expires_at, source = nullif(trim(p_source), ''),
          utm_source = nullif(trim(p_utm_source), ''), utm_medium = nullif(trim(p_utm_medium), ''),
          utm_campaign = nullif(trim(p_utm_campaign), ''), utm_content = nullif(trim(p_utm_content), ''),
          utm_term = nullif(trim(p_utm_term), ''), referrer_category = nullif(trim(p_referrer_category), ''),
          marketing_consent = target.marketing_consent or coalesce(p_marketing_consent, false)
      where target.id = v_row.id
      returning * into v_row;
    end if;
    insert into public.waitlist_application_events (application_id, event_type, actor_kind, metadata)
    values (v_row.id, 'duplicate_submission', 'public', jsonb_build_object('idempotent', true));
  else
    insert into public.waitlist_application_events (application_id, event_type, to_status, actor_kind, metadata)
    values (v_row.id, 'submitted', v_row.status, 'public', jsonb_build_object('idempotent', false));
  end if;
  return v_row;
end;
$$;

create or replace function public.verify_waitlist_application(p_verification_token_hash text)
returns public.waitlist_applications
language plpgsql security definer set search_path = public as $$
declare
  v_row public.waitlist_applications;
  v_now timestamptz := timezone('utc', now());
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'waitlist_service_role_required';
  end if;
  select * into v_row from public.waitlist_applications
  where verification_token_hash = p_verification_token_hash
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'waitlist_verification_invalid';
  end if;
  if v_row.email_verification_status = 'verified' then
    return v_row;
  end if;
  if v_row.verification_expires_at < v_now then
    insert into public.waitlist_application_events (application_id, event_type, actor_kind, metadata)
    values (v_row.id, 'verification_failed', 'public', jsonb_build_object('reason', 'expired'));
    raise exception using errcode = '22023', message = 'waitlist_verification_expired';
  end if;
  perform set_config('wanterest.waitlist_mutation', 'verify', true);
  update public.waitlist_applications
  set early_access_number = nextval('public.waitlist_early_access_number_seq'),
      status = 'verified', email_verification_status = 'verified', verified_at = v_now,
      verification_used_at = v_now
  where id = v_row.id
  returning * into v_row;
  insert into public.waitlist_application_events (application_id, event_type, from_status, to_status, actor_kind, metadata)
  values (v_row.id, 'verification_succeeded', 'pending', 'verified', 'public', jsonb_build_object('number_finalized', true));
  return v_row;
end;
$$;

create or replace function public.get_waitlist_application_by_status_token(p_status_token_hash text)
returns public.waitlist_applications
language plpgsql security definer set search_path = public as $$
declare v_row public.waitlist_applications;
begin
  if not public.is_service_role() then raise exception using errcode = '42501', message = 'waitlist_service_role_required'; end if;
  select * into v_row from public.waitlist_applications where status_token_hash = p_status_token_hash;
  if not found then raise exception using errcode = '22023', message = 'waitlist_status_not_found'; end if;
  return v_row;
end;
$$;

create or replace function public.withdraw_waitlist_application(p_status_token_hash text)
returns public.waitlist_applications
language plpgsql security definer set search_path = public as $$
declare
  v_row public.waitlist_applications;
  v_from text;
begin
  if not public.is_service_role() then raise exception using errcode = '42501', message = 'waitlist_service_role_required'; end if;
  select * into v_row from public.waitlist_applications where status_token_hash = p_status_token_hash for update;
  if not found then raise exception using errcode = '22023', message = 'waitlist_status_not_found'; end if;
  if v_row.status = 'withdrawn' then return v_row; end if;
  if v_row.status not in ('pending', 'verified', 'under_review', 'approved_for_invite') then raise exception using errcode = '22023', message = 'waitlist_withdrawal_not_allowed'; end if;
  v_from := v_row.status;
  perform set_config('wanterest.waitlist_mutation', 'withdraw', true);
  update public.waitlist_applications set status = 'withdrawn', withdrawn_at = timezone('utc', now()) where id = v_row.id returning * into v_row;
  insert into public.waitlist_application_events (application_id, event_type, from_status, to_status, actor_kind, metadata)
  values (v_row.id, 'withdrawn', v_from, 'withdrawn', 'public', jsonb_build_object('self_service', true));
  return v_row;
end;
$$;

create or replace function public.transition_waitlist_application(
  p_application_id uuid,
  p_to_status text,
  p_actor_user_id uuid,
  p_reason text default null
)
returns public.waitlist_applications
language plpgsql security definer set search_path = public as $$
declare
  v_row public.waitlist_applications;
  v_from text;
  v_allowed boolean := false;
begin
  if not public.is_service_role() then raise exception using errcode = '42501', message = 'waitlist_service_role_required'; end if;
  select * into v_row from public.waitlist_applications where id = p_application_id for update;
  if not found then raise exception using errcode = '22023', message = 'waitlist_application_not_found'; end if;
  v_from := v_row.status;
  v_allowed := (v_from = 'verified' and p_to_status = 'under_review')
    or (v_from = 'under_review' and p_to_status in ('approved_for_invite', 'declined'))
    or (v_from in ('pending', 'verified', 'under_review', 'approved_for_invite') and p_to_status = 'withdrawn');
  if not v_allowed then raise exception using errcode = '22023', message = 'invalid_waitlist_transition'; end if;
  perform set_config('wanterest.waitlist_mutation', 'transition', true);
  update public.waitlist_applications set status = p_to_status, withdrawn_at = case when p_to_status = 'withdrawn' then timezone('utc', now()) else withdrawn_at end where id = v_row.id returning * into v_row;
  insert into public.waitlist_application_events (application_id, event_type, from_status, to_status, actor_kind, actor_user_id, metadata)
  values (v_row.id, 'status_transition', v_from, p_to_status, 'internal', p_actor_user_id, jsonb_build_object('reason', nullif(trim(p_reason), '')));
  return v_row;
end;
$$;

alter table public.waitlist_applications enable row level security;
alter table public.waitlist_application_events enable row level security;
revoke all on public.waitlist_applications from anon, authenticated;
revoke all on public.waitlist_application_events from anon, authenticated;
grant all on public.waitlist_applications to service_role;
grant all on public.waitlist_application_events to service_role;
grant usage, select on sequence public.waitlist_early_access_number_seq to service_role;
revoke all on function public.submit_waitlist_application(text, text, text, text, text, text, text, text, timestamptz, text, text, text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.verify_waitlist_application(text) from public, anon, authenticated;
revoke all on function public.get_waitlist_application_by_status_token(text) from public, anon, authenticated;
revoke all on function public.withdraw_waitlist_application(text) from public, anon, authenticated;
revoke all on function public.transition_waitlist_application(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_waitlist_application(text, text, text, text, text, text, text, text, timestamptz, text, text, text, text, text, text, text, text, boolean) to service_role;
grant execute on function public.verify_waitlist_application(text) to service_role;
grant execute on function public.get_waitlist_application_by_status_token(text) to service_role;
grant execute on function public.withdraw_waitlist_application(text) to service_role;
grant execute on function public.transition_waitlist_application(uuid, text, uuid, text) to service_role;

comment on table public.waitlist_applications is 'Private pre-access applications. Waitlist membership never grants product access.';
comment on column public.waitlist_applications.early_access_number is 'Immutable, monotonic public display identity; never an authorization credential and never reused.';
comment on table public.waitlist_application_events is 'Append-only waitlist audit history without raw verification tokens or sensitive payloads.';
