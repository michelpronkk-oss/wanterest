-- Private, server-only Wanterest Admin identity and append-only audit foundation.
-- No customer RLS policy or customer lifecycle table is modified here.

create table if not exists public.admin_memberships (
  -- RESTRICT is intentional: remove/revoke the membership before deleting its Auth identity.
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null check (role in ('founder', 'operations_admin', 'support', 'read_only_analyst')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  granted_by_user_id uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  check ((status = 'active' and revoked_at is null) or (status = 'revoked' and revoked_at is not null))
);

alter table public.admin_memberships enable row level security;
revoke all on public.admin_memberships from public, anon, authenticated;
grant select on public.admin_memberships to service_role;

create index if not exists admin_memberships_granted_by_idx
  on public.admin_memberships (granted_by_user_id)
  where granted_by_user_id is not null;
create index if not exists admin_memberships_revoked_by_idx
  on public.admin_memberships (revoked_by_user_id)
  where revoked_by_user_id is not null;

create table if not exists public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  -- Keep historical actor attribution as a UUID even after the Auth identity is deleted.
  actor_user_id uuid,
  actor_role text not null check (actor_role in ('founder', 'operations_admin', 'support', 'read_only_analyst', 'system')),
  action text not null check (char_length(trim(action)) between 1 and 120),
  resource_type text not null check (char_length(trim(resource_type)) between 1 and 120),
  resource_id text check (resource_id is null or char_length(resource_id) <= 240),
  reason text check (reason is null or char_length(reason) <= 500),
  request_id text check (request_id is null or char_length(request_id) <= 120),
  outcome text not null check (outcome in ('succeeded', 'denied', 'failed')),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists admin_audit_events_created_idx
  on public.admin_audit_events (created_at desc);
create index if not exists admin_audit_events_actor_created_idx
  on public.admin_audit_events (actor_user_id, created_at desc);
create index if not exists admin_audit_events_resource_created_idx
  on public.admin_audit_events (resource_type, resource_id, created_at desc);

alter table public.admin_audit_events enable row level security;
revoke all on public.admin_audit_events from public, anon, authenticated;
grant select, insert on public.admin_audit_events to service_role;

create or replace function public.prevent_admin_audit_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'admin_audit_events_are_append_only';
end;
$$;

drop trigger if exists admin_audit_events_append_only on public.admin_audit_events;
create trigger admin_audit_events_append_only
  before update or delete on public.admin_audit_events
  for each row execute function public.prevent_admin_audit_event_mutation();

revoke all on function public.prevent_admin_audit_event_mutation() from public, anon, authenticated;
grant execute on function public.prevent_admin_audit_event_mutation() to service_role;
