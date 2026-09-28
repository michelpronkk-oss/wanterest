-- Layer 13A.4: privacy-first public projections of authoritative workspace cohorts.
-- Additive only. This migration creates no profiles, assigns no cohorts, and consumes no seats.

create table if not exists public.workspace_public_cohort_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cohort_membership_id uuid not null,
  public_slug text not null unique,
  display_name text not null check (char_length(trim(display_name)) between 1 and 160),
  logo_url text,
  avatar_url text,
  monogram text,
  headline text,
  website_url text,
  wall_visible boolean not null default false,
  pass_visible boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id),
  foreign key (workspace_id, cohort_membership_id)
    references public.workspace_cohort_memberships (workspace_id, id) on delete restrict,
  check (
    public_slug = lower(trim(public_slug))
    and char_length(public_slug) between 3 and 80
    and public_slug ~ '^[a-z0-9]+(-[a-z0-9]+){0,11}$'
    and public_slug not in (
      'api', 'app', 'auth', 'about', 'contact', 'early', 'founding', 'forgot-password',
      'login', 'members', 'privacy', 'r', 'signup', 'start', 'terms', 'waitlist'
    )
  ),
  check (logo_url is null or (char_length(logo_url) <= 2048 and logo_url ~ '^https://[^[:space:]]+$')),
  check (avatar_url is null or (char_length(avatar_url) <= 2048 and avatar_url ~ '^https://[^[:space:]]+$')),
  check (website_url is null or (char_length(website_url) <= 2048 and website_url ~ '^https://[^[:space:]]+$')),
  check (monogram is null or monogram ~ '^[A-Z0-9]{1,3}$'),
  check (headline is null or char_length(trim(headline)) between 1 and 240)
);

create index if not exists workspace_public_cohort_profiles_visibility_idx
  on public.workspace_public_cohort_profiles (wall_visible, pass_visible, public_slug);

drop trigger if exists workspace_public_cohort_profiles_updated_at on public.workspace_public_cohort_profiles;
create trigger workspace_public_cohort_profiles_updated_at
before update on public.workspace_public_cohort_profiles
for each row execute function public.updated_at_trigger();

create or replace function public.upsert_workspace_public_cohort_profile(
  p_workspace_id uuid,
  p_public_slug text,
  p_display_name text default null,
  p_logo_url text default null,
  p_avatar_url text default null,
  p_monogram text default null,
  p_headline text default null,
  p_website_url text default null,
  p_wall_visible boolean default null,
  p_pass_visible boolean default null,
  p_trace_id text default null
)
returns table (
  profile_id uuid,
  workspace_id uuid,
  public_slug text,
  display_name text,
  logo_url text,
  avatar_url text,
  monogram text,
  headline text,
  website_url text,
  wall_visible boolean,
  pass_visible boolean,
  cohort text,
  cohort_number integer,
  cohort_limit integer,
  assigned_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_workspace public.workspaces;
  v_membership public.workspace_cohort_memberships;
  v_existing public.workspace_public_cohort_profiles;
  v_profile public.workspace_public_cohort_profiles;
  v_slug text := lower(trim(coalesce(p_public_slug, '')));
  v_display_name text;
  v_monogram text;
  v_logo_url text := nullif(trim(p_logo_url), '');
  v_avatar_url text := nullif(trim(p_avatar_url), '');
  v_headline text := nullif(trim(p_headline), '');
  v_website_url text := nullif(trim(p_website_url), '');
  v_actor_kind text := case when public.is_service_role() then 'service' else 'user' end;
begin
  if not public.has_workspace_role(p_workspace_id, array['owner', 'admin']) then
    raise exception using errcode = '42501', message = 'public_cohort_profile_access_denied';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+){0,11}$' or char_length(v_slug) not between 3 and 80
     or v_slug in ('api', 'app', 'auth', 'about', 'contact', 'early', 'founding', 'forgot-password',
                   'login', 'members', 'privacy', 'r', 'signup', 'start', 'terms', 'waitlist') then
    raise exception using errcode = '22023', message = 'public_cohort_slug_invalid';
  end if;
  select * into v_workspace
    from public.workspaces as w
   where w.id = p_workspace_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;
  select * into v_membership
    from public.workspace_cohort_memberships as m
   where m.workspace_id = p_workspace_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_cohort_membership_not_found';
  end if;
  if exists (
    select 1 from public.workspace_public_cohort_profiles as collision
     where collision.public_slug = v_slug and collision.workspace_id <> p_workspace_id
  ) then
    raise exception using errcode = '23505', message = 'public_cohort_slug_conflict';
  end if;

  v_display_name := coalesce(nullif(trim(p_display_name), ''), trim(v_workspace.name));
  if char_length(v_display_name) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'public_cohort_display_name_invalid';
  end if;
  v_monogram := upper(nullif(trim(p_monogram), ''));
  if v_monogram is null then
    v_monogram := left(regexp_replace(v_display_name, '[^A-Za-z0-9]+', '', 'g'), 2);
  end if;
  if v_monogram !~ '^[A-Z0-9]{1,3}$' then
    raise exception using errcode = '22023', message = 'public_cohort_monogram_invalid';
  end if;
  if v_logo_url is not null and (char_length(v_logo_url) > 2048 or v_logo_url !~ '^https://[^[:space:]]+$') then
    raise exception using errcode = '22023', message = 'public_cohort_logo_url_invalid';
  end if;
  if v_avatar_url is not null and (char_length(v_avatar_url) > 2048 or v_avatar_url !~ '^https://[^[:space:]]+$') then
    raise exception using errcode = '22023', message = 'public_cohort_avatar_url_invalid';
  end if;
  if v_website_url is not null and (char_length(v_website_url) > 2048 or v_website_url !~ '^https://[^[:space:]]+$') then
    raise exception using errcode = '22023', message = 'public_cohort_website_url_invalid';
  end if;
  if v_headline is not null and char_length(v_headline) not between 1 and 240 then
    raise exception using errcode = '22023', message = 'public_cohort_headline_invalid';
  end if;

  select * into v_existing
    from public.workspace_public_cohort_profiles as profile
   where profile.workspace_id = p_workspace_id
   for update;
  if not found then
    insert into public.workspace_public_cohort_profiles (
      workspace_id, cohort_membership_id, public_slug, display_name, logo_url, avatar_url,
      monogram, headline, website_url, wall_visible, pass_visible
    ) values (
      p_workspace_id, v_membership.id, v_slug, v_display_name, v_logo_url, v_avatar_url,
      v_monogram, v_headline, v_website_url, coalesce(p_wall_visible, false), coalesce(p_pass_visible, false)
    ) returning * into v_profile;
    perform public.record_audit_event(
      p_workspace_id, null, v_actor_kind, 'public_profile_created', 'workspace_public_cohort_profile',
      v_profile.id, p_trace_id, jsonb_build_object('cohort', v_membership.cohort, 'cohort_number', v_membership.cohort_number)
    );
  else
    if v_existing.cohort_membership_id <> v_membership.id then
      raise exception using errcode = '55000', message = 'public_cohort_membership_immutable';
    end if;
    update public.workspace_public_cohort_profiles as profile
       set public_slug = v_slug,
           display_name = v_display_name,
           logo_url = v_logo_url,
           avatar_url = v_avatar_url,
           monogram = v_monogram,
           headline = v_headline,
           website_url = v_website_url,
           wall_visible = coalesce(p_wall_visible, v_existing.wall_visible),
           pass_visible = coalesce(p_pass_visible, v_existing.pass_visible)
     where profile.id = v_existing.id
     returning profile.* into v_profile;
    if v_existing.wall_visible is distinct from v_profile.wall_visible then
      perform public.record_audit_event(
        p_workspace_id, null, v_actor_kind,
        case when v_profile.wall_visible then 'wall_visibility_enabled' else 'wall_visibility_disabled' end,
        'workspace_public_cohort_profile', v_profile.id, p_trace_id, '{}'::jsonb
      );
    end if;
    if v_existing.pass_visible is distinct from v_profile.pass_visible then
      perform public.record_audit_event(
        p_workspace_id, null, v_actor_kind,
        case when v_profile.pass_visible then 'pass_visibility_enabled' else 'pass_visibility_disabled' end,
        'workspace_public_cohort_profile', v_profile.id, p_trace_id, '{}'::jsonb
      );
    end if;
    if v_existing.public_slug is distinct from v_profile.public_slug
       or v_existing.display_name is distinct from v_profile.display_name
       or v_existing.logo_url is distinct from v_profile.logo_url
       or v_existing.avatar_url is distinct from v_profile.avatar_url
       or v_existing.monogram is distinct from v_profile.monogram
       or v_existing.headline is distinct from v_profile.headline
       or v_existing.website_url is distinct from v_profile.website_url then
      perform public.record_audit_event(
        p_workspace_id, null, v_actor_kind, 'public_profile_updated', 'workspace_public_cohort_profile',
        v_profile.id, p_trace_id, '{}'::jsonb
      );
    end if;
  end if;

  return query
  select v_profile.id, v_profile.workspace_id, v_profile.public_slug, v_profile.display_name,
    v_profile.logo_url, v_profile.avatar_url, v_profile.monogram, v_profile.headline, v_profile.website_url,
    v_profile.wall_visible, v_profile.pass_visible, v_membership.cohort, v_membership.cohort_number,
    case when v_membership.cohort = 'founding_25' then 25 else 100 end, v_membership.assigned_at;
end;
$$;

create or replace function public.initialize_workspace_public_cohort_profile(
  p_workspace_id uuid,
  p_public_slug text,
  p_trace_id text default null
)
returns table (
  profile_id uuid,
  workspace_id uuid,
  public_slug text,
  display_name text,
  logo_url text,
  avatar_url text,
  monogram text,
  headline text,
  website_url text,
  wall_visible boolean,
  pass_visible boolean,
  cohort text,
  cohort_number integer,
  cohort_limit integer,
  assigned_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'public_cohort_profile_service_role_required';
  end if;
  return query
  select * from public.upsert_workspace_public_cohort_profile(
    p_workspace_id, p_public_slug, null, null, null, null, null, null, false, false, p_trace_id
  );
end;
$$;

create or replace function public.get_workspace_public_cohort_profile(p_workspace_id uuid)
returns table (
  profile_id uuid,
  workspace_id uuid,
  public_slug text,
  display_name text,
  logo_url text,
  avatar_url text,
  monogram text,
  headline text,
  website_url text,
  wall_visible boolean,
  pass_visible boolean,
  cohort text,
  cohort_number integer,
  cohort_limit integer,
  assigned_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.has_workspace_role(p_workspace_id, array['owner', 'admin']) then
    raise exception using errcode = '42501', message = 'public_cohort_profile_access_denied';
  end if;
  return query
  select profile.id, profile.workspace_id, profile.public_slug, profile.display_name,
    profile.logo_url, profile.avatar_url, profile.monogram, profile.headline, profile.website_url,
    profile.wall_visible, profile.pass_visible, membership.cohort, membership.cohort_number,
    case when membership.cohort = 'founding_25' then 25 else 100 end, membership.assigned_at
  from public.workspace_public_cohort_profiles as profile
  join public.workspace_cohort_memberships as membership
    on membership.workspace_id = profile.workspace_id and membership.id = profile.cohort_membership_id
  where profile.workspace_id = p_workspace_id;
end;
$$;

create or replace function public.get_public_cohort_wall(p_cohort text)
returns table (
  public_slug text,
  display_name text,
  logo_url text,
  avatar_url text,
  monogram text,
  headline text,
  website_url text,
  cohort text,
  cohort_number integer,
  cohort_limit integer,
  assigned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_cohort not in ('founding_25', 'early_100') then
    raise exception using errcode = '22023', message = 'public_cohort_name_invalid';
  end if;
  return query
  select profile.public_slug, profile.display_name, profile.logo_url, profile.avatar_url,
    profile.monogram, profile.headline, profile.website_url, membership.cohort,
    membership.cohort_number,
    case when membership.cohort = 'founding_25' then 25 else 100 end,
    membership.assigned_at
  from public.workspace_public_cohort_profiles as profile
  join public.workspace_cohort_memberships as membership
    on membership.workspace_id = profile.workspace_id and membership.id = profile.cohort_membership_id
  where profile.wall_visible = true and membership.cohort = p_cohort
  order by membership.cohort_number asc;
end;
$$;

create or replace function public.get_public_cohort_profile(p_public_slug text)
returns table (
  public_slug text,
  display_name text,
  logo_url text,
  avatar_url text,
  monogram text,
  headline text,
  website_url text,
  cohort text,
  cohort_number integer,
  cohort_limit integer,
  assigned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select profile.public_slug, profile.display_name, profile.logo_url, profile.avatar_url,
    profile.monogram, profile.headline, profile.website_url, membership.cohort,
    membership.cohort_number,
    case when membership.cohort = 'founding_25' then 25 else 100 end,
    membership.assigned_at
  from public.workspace_public_cohort_profiles as profile
  join public.workspace_cohort_memberships as membership
    on membership.workspace_id = profile.workspace_id and membership.id = profile.cohort_membership_id
  where profile.public_slug = lower(trim(p_public_slug))
    and profile.pass_visible = true;
end;
$$;

alter table public.workspace_public_cohort_profiles enable row level security;
revoke all on public.workspace_public_cohort_profiles from public, anon, authenticated;
grant all on public.workspace_public_cohort_profiles to service_role;

revoke all on function public.upsert_workspace_public_cohort_profile(uuid, text, text, text, text, text, text, text, boolean, boolean, text) from public, anon, authenticated;
revoke all on function public.initialize_workspace_public_cohort_profile(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_workspace_public_cohort_profile(uuid) from public, anon, authenticated;
revoke all on function public.get_public_cohort_wall(text) from public, anon, authenticated;
revoke all on function public.get_public_cohort_profile(text) from public, anon, authenticated;
grant execute on function public.upsert_workspace_public_cohort_profile(uuid, text, text, text, text, text, text, text, boolean, boolean, text) to authenticated, service_role;
grant execute on function public.initialize_workspace_public_cohort_profile(uuid, text, text) to service_role;
grant execute on function public.get_workspace_public_cohort_profile(uuid) to authenticated, service_role;
grant execute on function public.get_public_cohort_wall(text) to anon, authenticated, service_role;
grant execute on function public.get_public_cohort_profile(text) to anon, authenticated, service_role;

comment on table public.workspace_public_cohort_profiles is 'Opt-in public projection settings for authoritative workspace cohort identities; no cohort assignment authority.';
comment on column public.workspace_public_cohort_profiles.cohort_membership_id is 'Immutable reference to the authoritative 13A.2 workspace cohort membership.';
comment on column public.workspace_public_cohort_profiles.wall_visible is 'Explicit opt-in for the curated public wall; defaults to false.';
comment on column public.workspace_public_cohort_profiles.pass_visible is 'Explicit opt-in for the public Founder Pass; defaults to false.';
