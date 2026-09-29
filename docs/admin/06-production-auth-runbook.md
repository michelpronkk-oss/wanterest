# Wanterest Admin — Production Auth Runbook

**Status: migration applied and verified on 2026-09-30.** The existing Wanterest production Supabase project is the sole Auth and data source. No Founder membership has been provisioned. Membership and Admin deployment remain separate approval steps.

## Reviewed migration

The approved repository migration was applied through the Supabase CLI from an isolated temporary workdir containing the 56 production-applied migration files and this migration as the only pending file:

`supabase/migrations/20261102000000_admin_console_foundation.sql`

SHA-256: `B2A673ABF1214B9BAF2BD71FA033EFD75E9F2CA9F6E1FA9C99C48079409D74B3`

Before application, read-only production inspection confirmed migration head `20261101000000_layer13b1_dynamic_share_card_engine_v1` (Postgres 17.6), non-null UUID `auth.users.id`, and availability of `gen_random_uuid()`. The isolated CLI migration list and dry run showed only this admin migration pending. It was recorded as version `20261102000000`.

The migration created no membership. Post-application catalog checks confirm both tables have RLS enabled and zero policies; `anon` and `authenticated` have no table access; `service_role` can select memberships and select/insert audit events but cannot insert memberships or update/delete audit events. `admin_audit_events.actor_user_id` has no foreign key, preserving historical UUID attribution. `admin_memberships.user_id` uses `ON DELETE RESTRICT`; grantor/revoker references use `ON DELETE SET NULL`. The enabled `BEFORE UPDATE OR DELETE` audit trigger has an empty search path. Both tables contain zero rows.

## Operator-only identity provisioning

Run these steps only after the migration is applied and separately approved membership access is granted. Use the existing Auth identity; do not create another Auth user and do not use email as the membership key. This procedure is for an authorized database operator in the production Supabase SQL editor (or an equivalent restricted database session), never the browser or admin application.

1. In Supabase Auth’s user list, locate the operator’s existing Wanterest Auth account and copy its UUID. Confirm it is the account the operator already uses for Wanterest. Do not export or list other Auth identities.
2. Confirm the migration is applied using the read-only queries below and confirm the target has no existing membership. Verify the operator's Auth UUID separately; do not enumerate or export `auth.users`.
3. After separate approval to grant this exact membership, replace all three placeholders and execute the following single SQL statement once. Both inserts are one atomic statement: a duplicate membership fails without an audit row, and an audit insert failure rolls back the membership insert. `actor_role = 'system'` identifies this out-of-band, database-operator bootstrap (it does not pretend a console role already exists); `actor_user_id` retains the operator's Auth UUID without an Auth foreign key.

```sql
with provisioned_membership as (
  insert into public.admin_memberships (
    user_id, role, status, granted_by_user_id, reason
  )
  values (
    '<EXISTING_WANTEREST_AUTH_USER_UUID>'::uuid,
    'founder',
    'active',
    '<OPERATOR_AUTH_USER_UUID>'::uuid,
    'Initial read-only Wanterest Admin access; approval <CHANGE_OR_TICKET_ID>'
  )
  returning user_id, role, status, granted_by_user_id, granted_at, reason
), recorded_audit as (
  insert into public.admin_audit_events (
    actor_user_id, actor_role, action, resource_type, resource_id,
    reason, request_id, outcome, context
  )
  select
    granted_by_user_id,
    'system',
    'admin.membership.granted',
    'admin_memberships',
    user_id::text,
    reason,
    '<CHANGE_OR_TICKET_ID>',
    'succeeded',
    jsonb_build_object(
      'provisioning', 'operator_sql',
      'membership_role', role,
      'granted_at', granted_at
    )
  from provisioned_membership
  returning id, actor_user_id, resource_id, created_at
)
select p.user_id, p.role, p.status, p.granted_by_user_id,
       a.id as audit_event_id, a.actor_user_id as audit_actor_user_id,
       a.resource_id as audit_resource_id, a.created_at as audit_created_at
from provisioned_membership p
cross join recorded_audit a;
```

Expect exactly one returned row. If it returns zero rows or errors, stop and inspect the transaction outcome before retrying; do not replace this with an upsert. `founder` is read-only in the application’s initial permission map. Do not grant access by changing Auth metadata, workspace membership, or a browser-supplied role. No admin membership should be added for ordinary Wanterest users.

The membership's `ON DELETE RESTRICT` is intentional: first revoke/remove the admin membership through an authorized operator process, then delete the Auth user if deletion is still required. The append-only audit row retains the operator UUID after Auth deletion; `granted_by_user_id` / `revoked_by_user_id` in membership rows may become null under their existing `ON DELETE SET NULL` constraints.

## Read-only verification procedure

Run in the production SQL editor using an operator account with catalog visibility. These statements only read migration/catalog metadata and the specifically provisioned admin membership. Never query or export the full `auth.users` table.

**Migration ledger and target objects:**

```sql
select version, name
from supabase_migrations.schema_migrations
where version = '20261102000000';

select to_regclass('public.admin_memberships') as admin_memberships,
       to_regclass('public.admin_audit_events') as admin_audit_events,
       to_regprocedure('public.prevent_admin_audit_event_mutation()') as audit_trigger_function;
```

Expect one migration row and all three objects to resolve.

**RLS and policies:**

```sql
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('admin_memberships', 'admin_audit_events')
order by c.relname;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('admin_memberships', 'admin_audit_events');
```

Expect RLS enabled for both tables and no client policies.

**Foreign-key deletion behavior:**

```sql
select c.conrelid::regclass as table_name,
       c.conname,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.contype = 'f'
  and c.conrelid in (
    'public.admin_memberships'::regclass,
    'public.admin_audit_events'::regclass
  )
order by table_name, c.conname;
```

Expect `admin_memberships.user_id` to reference `auth.users(id) ON DELETE RESTRICT`; its grantor/revoker references use `ON DELETE SET NULL`. `admin_audit_events` must have no Auth foreign key on `actor_user_id` (or any other actor identity constraint).

**Effective table privileges:**

```sql
select
  has_table_privilege('anon', 'public.admin_memberships', 'select') as anon_membership_read,
  has_table_privilege('authenticated', 'public.admin_memberships', 'select') as authenticated_membership_read,
  has_table_privilege('service_role', 'public.admin_memberships', 'select') as service_membership_read,
  has_table_privilege('anon', 'public.admin_audit_events', 'select') as anon_audit_read,
  has_table_privilege('authenticated', 'public.admin_audit_events', 'select') as authenticated_audit_read,
  has_table_privilege('service_role', 'public.admin_audit_events', 'select') as service_audit_read,
  has_table_privilege('service_role', 'public.admin_audit_events', 'insert') as service_audit_insert,
  has_table_privilege('service_role', 'public.admin_audit_events', 'update') as service_audit_update,
  has_table_privilege('service_role', 'public.admin_audit_events', 'delete') as service_audit_delete;
```

Expect browser-role privileges false, service-role membership/audit reads true, audit insert true, and audit update/delete false. If the hosted project reports different effective grants, stop and review before enabling the app.

**Append-only trigger and initial membership:**

```sql
select t.tgenabled, pg_get_triggerdef(t.oid) as trigger_definition,
       p.proconfig as function_settings
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'public'
  and c.relname = 'admin_audit_events'
  and t.tgname = 'admin_audit_events_append_only'
  and not t.tgisinternal;

select user_id, role, status, granted_by_user_id, granted_at, reason
from public.admin_memberships
where user_id = '<EXISTING_WANTEREST_AUTH_USER_UUID>'::uuid;

select id, actor_user_id, actor_role, action, resource_type, resource_id,
       reason, request_id, outcome, created_at
from public.admin_audit_events
where request_id = '<CHANGE_OR_TICKET_ID>'
  and action = 'admin.membership.granted'
  and resource_id = '<EXISTING_WANTEREST_AUTH_USER_UUID>';
```

Expect an enabled `BEFORE UPDATE OR DELETE` trigger with an empty search path. Before provisioning, both membership and matching audit queries must return no row. After the atomic grant, each must return exactly one matching row; audit actor UUID must equal the approved operator UUID, actor role must be `system`, outcome must be `succeeded`, and the membership must be `founder` / `active`. Do not test append-only enforcement by attempting a write in production.

## Read-only access checks after separate membership approval

- Sign in to the private admin origin with the already existing Auth account. No registration or duplicate user creation is available.
- Confirm a user without an active `admin_memberships` row is denied, even if their Auth metadata or Wanterest workspace role says founder/admin.
- Confirm the provisioned user is required to enroll a TOTP factor if none is verified; verify the authenticator and require AAL2 before any operational data is rendered.
- Confirm a verified factor at AAL1 sees only the MFA challenge. Confirm AAL2 can read the Overview projection and that unavailable/stale dependencies are labeled explicitly.
- Confirm the role exposes read-only permissions. Do not test customer review, invites, admissions, lifecycle changes, billing actions, share publication, retries, or job replays with production records.
- Keep `SUPABASE_SERVICE_ROLE_KEY` out of all browser variables and all Vercel Preview environments. The application also refuses to instantiate either Supabase client on a Vercel Preview deployment. Configure the production service key only as a server-side variable on the separately approved production admin deployment.

## Approval boundary

Production activation status and remaining approval boundaries:

1. **Completed:** migration `20261102000000` was applied and verified as described above. Do not reapply it or use `--include-all` to run unfinished Layer 13B migrations.
2. **Next, separate approval:** grant the initial Founder membership to the exact existing Auth UUID and record the operator/audit event with the one-statement CTE above. Run the read-only membership/audit checks afterward. No membership has been granted.
3. **Separate approval still required:** configure and deploy the dedicated Admin Vercel project. Keep credentials server-side; then verify ordinary-user denial and mandatory TOTP/AAL2 after the existing Founder account has been provisioned. Do not run lifecycle mutations as smoke tests.

The migration approval has been exercised; membership provisioning and deployment have not.
