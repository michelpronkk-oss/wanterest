create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (slug)
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, user_id),
  unique (workspace_id, id)
);

create index if not exists workspace_members_user_active_idx
  on public.workspace_members (user_id, status, workspace_id);

create table if not exists public.plan_catalog (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null check (plan_code ~ '^[a-z][a-z0-9_-]*$'),
  version integer not null check (version > 0),
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  effective_from timestamptz not null default timezone('utc', now()),
  effective_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (plan_code, version),
  check (effective_to is null or effective_to > effective_from)
);

create unique index if not exists plan_catalog_one_active_version_idx
  on public.plan_catalog (plan_code)
  where status = 'active' and effective_to is null;

create table if not exists public.plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  plan_catalog_id uuid not null references public.plan_catalog(id) on delete cascade,
  capability_key text not null check (capability_key ~ '^[a-z][a-z0-9_]*$'),
  value_type text not null check (value_type in ('boolean', 'integer', 'decimal', 'enum')),
  value_json jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (plan_catalog_id, capability_key),
  check (
    (value_type = 'boolean' and jsonb_typeof(value_json) = 'boolean') or
    (value_type = 'integer' and jsonb_typeof(value_json) = 'number') or
    (value_type = 'decimal' and jsonb_typeof(value_json) = 'number') or
    (value_type = 'enum' and jsonb_typeof(value_json) = 'string')
  )
);

create table if not exists public.workspace_entitlements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_catalog_id uuid not null references public.plan_catalog(id) on delete restrict,
  capability_key text not null check (capability_key ~ '^[a-z][a-z0-9_]*$'),
  value_type text not null check (value_type in ('boolean', 'integer', 'decimal', 'enum')),
  value_json jsonb not null,
  revision integer not null check (revision > 0),
  effective_from timestamptz not null default timezone('utc', now()),
  effective_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, capability_key, revision),
  unique (workspace_id, id),
  check (effective_to is null or effective_to > effective_from)
);

create unique index if not exists workspace_entitlements_current_idx
  on public.workspace_entitlements (workspace_id, capability_key)
  where effective_to is null;

create index if not exists workspace_entitlements_lookup_idx
  on public.workspace_entitlements (workspace_id, capability_key, effective_to);

create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  usage_type text not null check (
    usage_type in (
      'qualified_signal',
      'source_scan',
      'action_generated',
      'experiment_created',
      'export'
    )
  ),
  amount bigint not null check (amount > 0),
  occurred_at timestamptz not null default timezone('utc', now()),
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 1 and 200),
  actor_user_id uuid references auth.users(id) on delete set null,
  trace_id text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, idempotency_key)
);

create index if not exists usage_ledger_monthly_idx
  on public.usage_ledger (workspace_id, usage_type, occurred_at);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_membership_id uuid,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'system', 'service')),
  action text not null check (char_length(trim(action)) between 1 and 120),
  target_type text not null check (char_length(trim(target_type)) between 1 and 120),
  target_id uuid,
  trace_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  check (actor_membership_id is null or workspace_id is not null),
  foreign key (workspace_id, actor_membership_id)
    references public.workspace_members (workspace_id, id)
);

create index if not exists audit_log_workspace_created_idx
  on public.audit_log (workspace_id, created_at desc);

create table if not exists public.engine_versions (
  id uuid primary key default gen_random_uuid(),
  engine_type text not null check (
    engine_type in ('profile', 'classifier', 'matcher', 'ranker', 'map', 'gap', 'drift', 'action')
  ),
  version text not null check (char_length(trim(version)) between 1 and 120),
  model text,
  prompt_version text,
  config_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (engine_type, version)
);

create index if not exists engine_versions_type_created_idx
  on public.engine_versions (engine_type, created_at desc);

create or replace function public.updated_at_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists workspaces_updated_at on public.workspaces;
create trigger workspaces_updated_at
before update on public.workspaces
for each row execute function public.updated_at_trigger();

drop trigger if exists workspace_members_updated_at on public.workspace_members;
create trigger workspace_members_updated_at
before update on public.workspace_members
for each row execute function public.updated_at_trigger();

create or replace function public.is_service_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_setting('request.jwt.claim.role', true) = 'service_role', false);
$$;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.is_service_role()
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
    );
$$;

create or replace function public.has_workspace_role(
  p_workspace_id uuid,
  p_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.is_service_role()
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role = any (p_roles)
    );
$$;

create or replace function public.initialize_workspace_entitlements(
  p_workspace_id uuid,
  p_plan_catalog_id uuid default null,
  p_actor_user_id uuid default null,
  p_trace_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_plan_id uuid;
  v_revision integer;
  v_now timestamptz := timezone('utc', now());
begin
  if not public.is_service_role() and not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':entitlements', 0));

  if p_plan_catalog_id is null then
    select pc.id
      into v_plan_id
      from public.plan_catalog pc
     where pc.plan_code = 'free'
       and pc.status = 'active'
       and pc.effective_to is null
     order by pc.version desc
     limit 1;
  else
    select pc.id
      into v_plan_id
      from public.plan_catalog pc
     where pc.id = p_plan_catalog_id;
  end if;

  if v_plan_id is null then
    raise exception using errcode = '22023', message = 'plan_catalog_not_found';
  end if;

  if exists (
    select 1
      from public.workspace_entitlements we
     where we.workspace_id = p_workspace_id
       and we.effective_to is null
       and we.plan_catalog_id = v_plan_id
  ) then
    return;
  end if;

  select coalesce(max(we.revision), 0) + 1
    into v_revision
    from public.workspace_entitlements we
   where we.workspace_id = p_workspace_id;

  update public.workspace_entitlements
     set effective_to = v_now
   where workspace_id = p_workspace_id
     and effective_to is null;

  insert into public.workspace_entitlements (
    workspace_id,
    plan_catalog_id,
    capability_key,
    value_type,
    value_json,
    revision,
    effective_from,
    metadata
  )
  select
    p_workspace_id,
    pe.plan_catalog_id,
    pe.capability_key,
    pe.value_type,
    pe.value_json,
    v_revision,
    v_now,
    pe.metadata
    from public.plan_entitlements pe
   where pe.plan_catalog_id = v_plan_id;

  insert into public.audit_log (
    workspace_id,
    actor_user_id,
    actor_kind,
    action,
    target_type,
    target_id,
    trace_id,
    metadata
  ) values (
    p_workspace_id,
    coalesce(p_actor_user_id, auth.uid()),
    case when public.is_service_role() then 'service' else 'user' end,
    'entitlement.revision_created',
    'workspace_entitlements',
    null,
    p_trace_id,
    jsonb_build_object('plan_catalog_id', v_plan_id, 'revision', v_revision)
  );
end;
$$;

create or replace function public.create_workspace(
  p_name text,
  p_slug text,
  p_trace_id text default null
)
returns public.workspaces
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_workspace public.workspaces;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  insert into public.workspaces (name, slug, created_by)
  values (trim(p_name), lower(trim(p_slug)), v_user_id)
  returning * into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (v_workspace.id, v_user_id, 'owner', 'active');

  perform public.initialize_workspace_entitlements(
    v_workspace.id,
    null,
    v_user_id,
    p_trace_id
  );

  insert into public.audit_log (
    workspace_id,
    actor_user_id,
    actor_kind,
    action,
    target_type,
    target_id,
    trace_id,
    metadata
  ) values (
    v_workspace.id,
    v_user_id,
    case when public.is_service_role() then 'service' else 'user' end,
    'workspace.created',
    'workspace',
    v_workspace.id,
    p_trace_id,
    jsonb_build_object('slug', v_workspace.slug)
  );

  return v_workspace;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'workspace_slug_already_exists';
end;
$$;

create or replace function public.add_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role text default 'member',
  p_trace_id text default null
)
returns public.workspace_members
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_member public.workspace_members;
  v_actor uuid := auth.uid();
  v_existing_role text;
begin
  if not public.has_workspace_role(p_workspace_id, array['owner', 'admin']) then
    raise exception using errcode = '42501', message = 'member_administration_denied';
  end if;
  if p_role not in ('owner', 'admin', 'member', 'viewer') then
    raise exception using errcode = '22023', message = 'invalid_member_role';
  end if;
  if p_role = 'owner' and not public.has_workspace_role(p_workspace_id, array['owner']) then
    raise exception using errcode = '42501', message = 'owner_role_required';
  end if;

  select wm.role into v_existing_role
    from public.workspace_members wm
   where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (p_workspace_id, p_user_id, p_role, 'active')
  on conflict (workspace_id, user_id) do update
    set role = excluded.role, status = 'active', updated_at = timezone('utc', now())
  returning * into v_member;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_kind, action, target_type, target_id, trace_id, metadata
  ) values (
    p_workspace_id, v_actor, case when public.is_service_role() then 'service' else 'user' end,
    case when v_existing_role is null then 'workspace.member_added' else 'workspace.member_reactivated' end,
    'workspace_member', v_member.id, p_trace_id,
    jsonb_build_object('user_id', p_user_id, 'role', p_role)
  );

  return v_member;
end;
$$;

create or replace function public.update_workspace_member(
  p_workspace_id uuid,
  p_member_id uuid,
  p_role text,
  p_trace_id text default null
)
returns public.workspace_members
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_member public.workspace_members;
  v_actor uuid := auth.uid();
  v_owner_count integer;
begin
  if p_role not in ('owner', 'admin', 'member', 'viewer') then
    raise exception using errcode = '22023', message = 'invalid_member_role';
  end if;
  if not public.has_workspace_role(p_workspace_id, array['owner', 'admin']) then
    raise exception using errcode = '42501', message = 'member_administration_denied';
  end if;

  select * into v_member
    from public.workspace_members
   where id = p_member_id and workspace_id = p_workspace_id and status = 'active';
  if v_member.id is null then
    raise exception using errcode = 'P0002', message = 'workspace_member_not_found';
  end if;
  if v_member.role = 'owner' and not public.has_workspace_role(p_workspace_id, array['owner']) then
    raise exception using errcode = '42501', message = 'owner_role_required';
  end if;
  if v_member.role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count
      from public.workspace_members
     where workspace_id = p_workspace_id and role = 'owner' and status = 'active';
    if v_owner_count <= 1 then
      raise exception using errcode = '22023', message = 'workspace_requires_owner';
    end if;
  end if;

  update public.workspace_members
     set role = p_role, updated_at = timezone('utc', now())
   where id = p_member_id and workspace_id = p_workspace_id
  returning * into v_member;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_kind, action, target_type, target_id, trace_id, metadata
  ) values (
    p_workspace_id, v_actor, case when public.is_service_role() then 'service' else 'user' end,
    'workspace.member_role_changed', 'workspace_member', p_member_id, p_trace_id,
    jsonb_build_object('role', p_role)
  );

  return v_member;
end;
$$;

create or replace function public.deactivate_workspace_member(
  p_workspace_id uuid,
  p_member_id uuid,
  p_trace_id text default null
)
returns public.workspace_members
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_member public.workspace_members;
  v_actor uuid := auth.uid();
  v_owner_count integer;
begin
  if not public.has_workspace_role(p_workspace_id, array['owner', 'admin']) then
    raise exception using errcode = '42501', message = 'member_administration_denied';
  end if;

  select * into v_member
    from public.workspace_members
   where id = p_member_id and workspace_id = p_workspace_id and status = 'active';
  if v_member.id is null then
    raise exception using errcode = 'P0002', message = 'workspace_member_not_found';
  end if;
  if v_member.role = 'owner' and not public.has_workspace_role(p_workspace_id, array['owner']) then
    raise exception using errcode = '42501', message = 'owner_role_required';
  end if;
  if v_member.role = 'owner' then
    select count(*) into v_owner_count
      from public.workspace_members
     where workspace_id = p_workspace_id and role = 'owner' and status = 'active';
    if v_owner_count <= 1 then
      raise exception using errcode = '22023', message = 'workspace_requires_owner';
    end if;
  end if;

  update public.workspace_members
     set status = 'inactive', updated_at = timezone('utc', now())
   where id = p_member_id and workspace_id = p_workspace_id
  returning * into v_member;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_kind, action, target_type, target_id, trace_id, metadata
  ) values (
    p_workspace_id, v_actor, case when public.is_service_role() then 'service' else 'user' end,
    'workspace.member_deactivated', 'workspace_member', p_member_id, p_trace_id,
    jsonb_build_object('user_id', v_member.user_id)
  );

  return v_member;
end;
$$;

create or replace function public.record_audit_event(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_actor_kind text,
  p_action text,
  p_target_type text,
  p_target_id uuid default null,
  p_trace_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.audit_log
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_audit public.audit_log;
begin
  if not public.is_service_role() and not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  insert into public.audit_log (
    workspace_id, actor_user_id, actor_kind, action, target_type, target_id, trace_id, metadata
  ) values (
    p_workspace_id, coalesce(p_actor_user_id, auth.uid()), p_actor_kind, p_action,
    p_target_type, p_target_id, p_trace_id, p_metadata
  )
  returning * into v_audit;
  return v_audit;
end;
$$;

create or replace function public.consume_usage(
  p_workspace_id uuid,
  p_usage_type text,
  p_amount bigint,
  p_idempotency_key text,
  p_source_metadata jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_trace_id text default null
)
returns public.usage_ledger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_existing public.usage_ledger;
  v_entry public.usage_ledger;
  v_capability text;
  v_value_type text;
  v_value jsonb;
  v_limit bigint;
  v_used bigint;
  v_period_start timestamptz := date_trunc('month', timezone('utc', now()));
begin
  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '22023', message = 'usage_amount_must_be_positive';
  end if;
  if p_usage_type not in ('qualified_signal', 'source_scan', 'action_generated', 'experiment_created', 'export') then
    raise exception using errcode = '22023', message = 'invalid_usage_type';
  end if;
  if not public.is_service_role() and not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_usage_type, 0));

  select * into v_existing
    from public.usage_ledger
   where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return v_existing;
  end if;

  v_capability := case p_usage_type
    when 'qualified_signal' then 'signals_monthly'
    when 'action_generated' then 'actions_enabled'
    when 'experiment_created' then 'experiments_max'
    when 'export' then 'exports'
    else null
  end;

  if v_capability is not null then
    select we.value_type, we.value_json
      into v_value_type, v_value
      from public.workspace_entitlements we
     where we.workspace_id = p_workspace_id
       and we.capability_key = v_capability
       and we.effective_to is null;

    if v_value is null then
      raise exception using errcode = '22023', message = 'entitlement_not_resolved';
    end if;

    if v_value_type = 'boolean' and coalesce((v_value #>> '{}')::boolean, false) = false then
      raise exception using errcode = 'P0001', message = 'usage_capability_disabled';
    end if;

    if v_value_type in ('integer', 'decimal') then
      v_limit := floor((v_value #>> '{}')::numeric)::bigint;
      select coalesce(sum(ul.amount), 0)
        into v_used
        from public.usage_ledger ul
       where ul.workspace_id = p_workspace_id
         and ul.usage_type = p_usage_type
         and ul.occurred_at >= v_period_start;
      if v_used + p_amount > v_limit then
        raise exception using errcode = '22003', message = 'usage_limit_exceeded';
      end if;
    end if;
  end if;

  insert into public.usage_ledger (
    workspace_id, usage_type, amount, idempotency_key, actor_user_id, trace_id, source_metadata
  ) values (
    p_workspace_id, p_usage_type, p_amount, p_idempotency_key,
    coalesce(p_actor_user_id, auth.uid()), p_trace_id, p_source_metadata
  )
  returning * into v_entry;

  return v_entry;
exception
  when unique_violation then
    select * into v_existing
      from public.usage_ledger
     where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return v_existing;
    end if;
    raise;
end;
$$;

create or replace function public.get_usage_totals(
  p_workspace_id uuid,
  p_period_start timestamptz default date_trunc('month', timezone('utc', now()))
)
returns table (usage_type text, amount bigint)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_service_role() and not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;

  return query
  select ul.usage_type, coalesce(sum(ul.amount), 0)::bigint
    from public.usage_ledger ul
   where ul.workspace_id = p_workspace_id
     and ul.occurred_at >= p_period_start
     and ul.occurred_at < p_period_start + interval '1 month'
   group by ul.usage_type
   order by ul.usage_type;
end;
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.plan_catalog enable row level security;
alter table public.plan_entitlements enable row level security;
alter table public.workspace_entitlements enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.audit_log enable row level security;
alter table public.engine_versions enable row level security;

drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));

drop policy if exists workspaces_update_admin on public.workspaces;
create policy workspaces_update_admin on public.workspaces
  for update to authenticated
  using (public.has_workspace_role(id, array['owner', 'admin']))
  with check (public.has_workspace_role(id, array['owner', 'admin']));

drop policy if exists workspace_members_select_member on public.workspace_members;
create policy workspace_members_select_member on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists plan_catalog_select_authenticated on public.plan_catalog;
create policy plan_catalog_select_authenticated on public.plan_catalog
  for select to authenticated using (status = 'active');

drop policy if exists plan_entitlements_select_authenticated on public.plan_entitlements;
create policy plan_entitlements_select_authenticated on public.plan_entitlements
  for select to authenticated using (
    exists (
      select 1 from public.plan_catalog pc
       where pc.id = plan_catalog_id and pc.status = 'active'
    )
  );

drop policy if exists workspace_entitlements_select_member on public.workspace_entitlements;
create policy workspace_entitlements_select_member on public.workspace_entitlements
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists usage_ledger_select_member on public.usage_ledger;
create policy usage_ledger_select_member on public.usage_ledger
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists audit_log_select_member on public.audit_log;
create policy audit_log_select_member on public.audit_log
  for select to authenticated using (
    workspace_id is null or public.is_workspace_member(workspace_id)
  );

drop policy if exists engine_versions_select_service on public.engine_versions;
create policy engine_versions_select_service on public.engine_versions
  for select to authenticated using (public.is_service_role());

revoke insert, update, delete on public.workspaces from anon, authenticated;
revoke insert, update, delete on public.workspace_members from anon, authenticated;
revoke insert, update, delete on public.plan_catalog from anon, authenticated;
revoke insert, update, delete on public.plan_entitlements from anon, authenticated;
revoke insert, update, delete on public.workspace_entitlements from anon, authenticated;
revoke insert, update, delete on public.usage_ledger from anon, authenticated;
revoke insert, update, delete on public.audit_log from anon, authenticated;
revoke insert, update, delete on public.engine_versions from anon, authenticated;

grant execute on function public.create_workspace(text, text, text) to authenticated, service_role;
grant execute on function public.initialize_workspace_entitlements(uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.add_workspace_member(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.update_workspace_member(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.deactivate_workspace_member(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.record_audit_event(uuid, uuid, text, text, text, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.consume_usage(uuid, text, bigint, text, jsonb, uuid, text) to authenticated, service_role;
grant execute on function public.get_usage_totals(uuid, timestamptz) to authenticated, service_role;

insert into public.plan_catalog (plan_code, version, status, metadata)
values ('free', 1, 'active', jsonb_build_object('provider', 'internal'))
on conflict (plan_code, version) do nothing;

do $$
declare
  v_plan_id uuid;
begin
  select id into v_plan_id
    from public.plan_catalog
   where plan_code = 'free' and version = 1;

  insert into public.plan_entitlements (plan_catalog_id, capability_key, value_type, value_json)
  values
    (v_plan_id, 'products_max', 'integer', '1'::jsonb),
    (v_plan_id, 'signals_monthly', 'integer', '5'::jsonb),
    (v_plan_id, 'scan_frequency', 'enum', '"manual"'::jsonb),
    (v_plan_id, 'demand_map', 'enum', '"preview"'::jsonb),
    (v_plan_id, 'demand_gap', 'enum', '"preview"'::jsonb),
    (v_plan_id, 'demand_drift_days', 'integer', '0'::jsonb),
    (v_plan_id, 'actions_enabled', 'boolean', 'false'::jsonb),
    (v_plan_id, 'experiments_max', 'integer', '0'::jsonb),
    (v_plan_id, 'exports', 'boolean', 'false'::jsonb),
    (v_plan_id, 'team_members', 'integer', '1'::jsonb)
  on conflict (plan_catalog_id, capability_key) do nothing;
end;
$$;
