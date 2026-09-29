-- F1.6A forward-only repair. SQL_RUNTIME_VALIDATION=PENDING / NOT_RUNTIME_VALIDATED.
-- CLI-created unpublished file ordered after 20261030000000; no historical file renamed.
-- Policy V1 mirrors src/shared/public-profile-url.ts. No DNS/fetch/license inference.
-- Reject unsafe new URL writes; null unsafe legacy URLs on public reads without
-- altering stored data, cohort provenance, independent consent, or audit history.

create or replace function public.decode_public_cohort_url_component(p_value text)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_bytes bytea := ''::bytea;
  v_index integer := 1;
  v_character text;
  v_decoded text;
begin
  if p_value is null or length(p_value) > 2048 then return null; end if;
  while v_index <= length(p_value) loop
    v_character := substr(p_value, v_index, 1);
    if v_character = '%' then
      if substr(p_value, v_index + 1, 2) !~ '^[0-9A-Fa-f]{2}$' then return null; end if;
      v_bytes := v_bytes || decode(substr(p_value, v_index + 1, 2), 'hex');
      v_index := v_index + 3;
    else
      v_bytes := v_bytes || convert_to(v_character, 'UTF8');
      v_index := v_index + 1;
    end if;
  end loop;
  v_decoded := convert_from(v_bytes, 'UTF8');
  -- Exact C0/C1 control ranges, independent of database locale character classes.
  for v_index in 1..length(v_decoded) loop
    if ascii(substr(v_decoded, v_index, 1)) between 0 and 31 or ascii(substr(v_decoded, v_index, 1)) between 127 and 159 then return null; end if;
  end loop;
  if strpos(v_decoded, chr(92)) > 0 then return null; end if;
  return v_decoded;
exception when character_not_in_repertoire or untranslatable_character then
  return null;
end;
$$;

create or replace function public.is_public_cohort_url(p_url text)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_match text[];
  v_host text;
  v_tail text;
  v_before_hash text;
  v_hash integer;
  v_question integer;
  v_path text;
  v_anchor text;
  v_query text;
  v_pair text;
  v_equals integer;
  v_name text;
  v_parameter text;
  v_key text;
  v_credential_keys text[] := array['token','accesstoken','refreshtoken','idtoken','authtoken','bearer','bearertoken','csrf','csrftoken','cfaccesstoken','cfaccessjwt','jwt','authorization','auth','apikey','key','password','secret','clientsecret','session','sessionid','invite','invitetoken','verificationtoken','code','signature','sig','policy','expires','expiry','credential','awsaccesskeyid','googleaccessid','sv','se','sp','sr','skoid','sktid','skt','ske','sks','skv'];
begin
  if p_url is null then return true; end if;
  if length(p_url) > 2048 or p_url !~ '^[!-~]+$' or strpos(p_url, chr(92)) > 0 then return false; end if;
  v_match := regexp_match(p_url, '^https://([A-Za-z0-9.-]+)(:443)?([/?#].*)?$');
  if v_match is null then return false; end if;
  v_host := v_match[1];
  if length(v_host) > 253
     or v_host !~ '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$'
     or v_host ~* '(^|\.)(localhost|local|localdomain|internal|test|invalid|example|onion|home|lan|corp)$' then return false; end if;
  v_tail := coalesce(v_match[3], '');
  v_hash := strpos(v_tail, '#');
  v_before_hash := case when v_hash = 0 then v_tail else left(v_tail, v_hash - 1) end;
  v_question := strpos(v_before_hash, '?');
  v_path := public.decode_public_cohort_url_component(case when v_question = 0 then v_before_hash else left(v_before_hash, v_question - 1) end);
  if v_path is null or v_path ~ '[?#]' or v_path ~* '%[0-9a-f]{2}' or v_path ~ '(^|/)\.{1,2}(/|$)'
     or v_path ~* '(^|/)(auth|login|signin|sign-in|sign_in|signup|sign-up|sign_up|logout|oauth|callback|verify|verification|invite|invitations|reset-password|forgot-password|account|settings|admin|private|protected)(/|;|$)'
     or v_path ~* '/(object|image)/(sign|authenticated)(/|;|$)' or v_path ~* '^/(app|api/workspaces)(/|;|$)' or v_path ~* '(^|/)s--[^/]+--(/|$)' then return false; end if;
  if v_hash > 0 then
    v_anchor := public.decode_public_cohort_url_component(substr(v_tail, v_hash + 1));
    if v_anchor is null or v_anchor !~ '^[A-Za-z][A-Za-z0-9_-]{0,79}$' then return false; end if;
    v_key := regexp_replace(lower(v_anchor), '[-_.]', '', 'g');
    if v_key = any(v_credential_keys) or v_key ~ '^(xamz|xgoog)' or v_anchor ~* '^(token|secret|jwt|session|invite)[_-]' then return false; end if;
  end if;
  if v_question > 0 then
    v_query := substr(v_before_hash, v_question + 1);
    if v_query = '' then return false; end if;
    foreach v_pair in array string_to_array(v_query, '&') loop
      v_equals := strpos(v_pair, '=');
      v_name := public.decode_public_cohort_url_component(case when v_equals = 0 then v_pair else left(v_pair, v_equals - 1) end);
      v_parameter := public.decode_public_cohort_url_component(case when v_equals = 0 then '' else substr(v_pair, v_equals + 1) end);
      if v_name is null or v_name !~ '^[A-Za-z0-9_.-]+$' or v_parameter is null then return false; end if;
      v_key := regexp_replace(lower(v_name), '[-_.]', '', 'g');
      if v_key = any(v_credential_keys) or v_key ~ '^(xamz|xgoog)' then return false; end if;
    end loop;
  end if;
  return true;
end;
$$;

create or replace function public.guard_public_cohort_profile_urls()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- An unchanged legacy bad URL must not prevent a visibility-only revocation.
  if tg_op = 'INSERT' then
    if not public.is_public_cohort_url(new.logo_url) or not public.is_public_cohort_url(new.avatar_url) or not public.is_public_cohort_url(new.website_url) then
      raise exception using errcode = '22023', message = 'public_cohort_url_invalid';
    end if;
  else
    if (new.logo_url is distinct from old.logo_url and not public.is_public_cohort_url(new.logo_url))
       or (new.avatar_url is distinct from old.avatar_url and not public.is_public_cohort_url(new.avatar_url))
       or (new.website_url is distinct from old.website_url and not public.is_public_cohort_url(new.website_url)) then
      raise exception using errcode = '22023', message = 'public_cohort_url_invalid';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_public_cohort_profiles_url_guard on public.workspace_public_cohort_profiles;
create trigger workspace_public_cohort_profiles_url_guard
before insert or update on public.workspace_public_cohort_profiles
for each row execute function public.guard_public_cohort_profile_urls();

create or replace function public.get_public_cohort_wall(p_cohort text)
returns table (public_slug text, display_name text, logo_url text, avatar_url text, monogram text, headline text, website_url text, cohort text, cohort_number integer, cohort_limit integer, assigned_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if p_cohort not in ('founding_25', 'early_100') then
    raise exception using errcode = '22023', message = 'public_cohort_name_invalid';
  end if;
  return query
  select profile.public_slug, profile.display_name,
    case when public.is_public_cohort_url(profile.logo_url) then profile.logo_url else null::text end,
    case when public.is_public_cohort_url(profile.avatar_url) then profile.avatar_url else null::text end,
    profile.monogram, profile.headline,
    case when public.is_public_cohort_url(profile.website_url) then profile.website_url else null::text end,
    membership.cohort, membership.cohort_number,
    case when membership.cohort = 'founding_25' then 25 else 100 end, membership.assigned_at
  from public.workspace_public_cohort_profiles as profile
  join public.workspace_cohort_memberships as membership
    on membership.workspace_id = profile.workspace_id and membership.id = profile.cohort_membership_id
  join public.workspaces as workspace on workspace.id = profile.workspace_id and workspace.status = 'active'
  where profile.wall_visible = true and membership.cohort = p_cohort
  order by membership.cohort_number asc;
end;
$$;

create or replace function public.get_public_cohort_profile(p_public_slug text)
returns table (public_slug text, display_name text, logo_url text, avatar_url text, monogram text, headline text, website_url text, cohort text, cohort_number integer, cohort_limit integer, assigned_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  select profile.public_slug, profile.display_name,
    case when public.is_public_cohort_url(profile.logo_url) then profile.logo_url else null::text end,
    case when public.is_public_cohort_url(profile.avatar_url) then profile.avatar_url else null::text end,
    profile.monogram, profile.headline,
    case when public.is_public_cohort_url(profile.website_url) then profile.website_url else null::text end,
    membership.cohort, membership.cohort_number,
    case when membership.cohort = 'founding_25' then 25 else 100 end, membership.assigned_at
  from public.workspace_public_cohort_profiles as profile
  join public.workspace_cohort_memberships as membership
    on membership.workspace_id = profile.workspace_id and membership.id = profile.cohort_membership_id
  join public.workspaces as workspace on workspace.id = profile.workspace_id and workspace.status = 'active'
  where profile.public_slug = lower(trim(p_public_slug)) and profile.pass_visible = true;
end;
$$;

revoke all on function public.decode_public_cohort_url_component(text) from public, anon, authenticated;
revoke all on function public.is_public_cohort_url(text) from public, anon, authenticated;
-- Stateless policy helpers disclose no data and confer no publication/mutation authority.
grant execute on function public.decode_public_cohort_url_component(text), public.is_public_cohort_url(text) to anon, authenticated, service_role;
revoke all on function public.guard_public_cohort_profile_urls() from public, anon, authenticated;
grant execute on function public.guard_public_cohort_profile_urls() to service_role;
revoke all on function public.get_public_cohort_wall(text), public.get_public_cohort_profile(text) from public, anon, authenticated;
grant execute on function public.get_public_cohort_wall(text), public.get_public_cohort_profile(text) to anon, authenticated, service_role;

comment on function public.is_public_cohort_url(text) is 'V1 public HTTPS reference policy: no userinfo, IP/local hosts, known auth/storage/signed URLs or credential parameters. Not a detector for every secret URL or a license authority.';
