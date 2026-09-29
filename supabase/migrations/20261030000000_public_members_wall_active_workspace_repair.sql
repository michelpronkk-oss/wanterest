-- Public Members Wall repair: keep the established narrow public projection,
-- but stop serving an opted-in profile if its authoritative workspace is no
-- longer active. This does not assign cohorts or change profile consent.

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
  join public.workspaces as workspace
    on workspace.id = profile.workspace_id and workspace.status = 'active'
  where profile.wall_visible = true and membership.cohort = p_cohort
  order by membership.cohort_number asc;
end;
$$;

revoke all on function public.get_public_cohort_wall(text) from public, anon, authenticated;
grant execute on function public.get_public_cohort_wall(text) to anon, authenticated, service_role;

comment on function public.get_public_cohort_wall(text) is 'Narrow opt-in public cohort wall projection. Requires an active workspace, immutable eligible cohort membership, and wall_visible consent.';

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
  join public.workspaces as workspace
    on workspace.id = profile.workspace_id and workspace.status = 'active'
  where profile.public_slug = lower(trim(p_public_slug))
    and profile.pass_visible = true;
end;
$$;

revoke all on function public.get_public_cohort_profile(text) from public, anon, authenticated;
grant execute on function public.get_public_cohort_profile(text) to anon, authenticated, service_role;

comment on function public.get_public_cohort_profile(text) is 'Narrow opt-in public cohort pass projection. Requires an active workspace, immutable eligible cohort membership, and pass_visible consent.';
