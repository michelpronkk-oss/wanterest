# Wanterest Admin — Security Model and Findings

Status: implementation/security plan for the existing Wanterest production Supabase project and existing `wanterest` Vercel project. No second or disposable project will be used. This document is not a live Supabase security certification. Read-only Advisor results are in `00-full-audit.md`; Auth settings and effective SQL grants still require operator review. Vercel non-production deployments hard-disable Admin Supabase session and service clients.

## Trust boundaries

1. The browser is untrusted. It receives only allowlisted, redacted DTOs and never a service-role, Vercel, Trigger.dev, Resend, or Dodo credential.
2. Supabase Auth verifies the session. A verified user ID is necessary but not sufficient for admin access.
3. Private admin membership is the authority. A server query must establish an active `user_id` membership and permission on every route/action. Email and `user_metadata` are not role sources.
4. The exact `admin.wanterest.com` Production hostname is the Admin origin. The root Next Proxy rewrites that host to `/admin-internal`; requests directly naming that prefix are not found on any hostname. Admin auth actions also verify the request host. The same Admin host on Vercel Preview/non-production is not found.
5. Privileged adapters run only on the admin server. Supabase service-role use is wrapped by narrow repository methods, validated command schemas and explicit authorization checks.
6. Lifecycle domain services remain the mutation authority. The admin UI cannot write arbitrary tables or SQL.
7. Every admin mutation produces an append-only, attributable audit entry, including denied attempts where useful and safe.

## Identity, session, and role controls

- Private email/password sign-in using the existing Wanterest production Supabase Auth identity; no duplicate account, public admin registration, or invite-by-email auto-grant.
- An explicit membership may be provisioned only for the existing Auth UUID, but it grants no page or data access until a verified TOTP factor reaches `aal2`. Require current verified MFA assurance on every protected admin request.
- Membership keyed to the existing immutable production Supabase Auth UUID; access is denied until an operator explicitly provisions the matching admin membership. Role comes from the server-side membership record, never JWT user metadata or browser form state.
- Roles anticipated: Founder, Operations Admin, Support, Read-only Analyst. Permission checks are granular and deny by default. Support should see the minimum customer fields required; read-only means no commands.
- Admin session cookie is secure, HTTP-only, same-site, short-lived and private/no-store. Sensitive operations validate the current session and MFA assurance; membership revocation invalidates access promptly. Add explicit session revocation rather than relying solely on an unexpired JWT.
- Rate-limit authentication, recovery, search and mutation endpoints. Use CSRF/origin protections for cookie-authenticated writes. Account recovery must not grant membership.

## Data access rules

- Keep admin tables/projections in a private schema or revoke browser roles and do not expose them through the Data API. For workspace-owned data, continue relying on existing RLS and composite workspace foreign keys; do not weaken RLS for convenience.
- Server queries must include narrow selected columns and bounded pagination/time ranges. Apply per-role row/field redaction. No raw provider payloads, invite/referral credentials, auth tokens, session identifiers, webhook secrets, payment instruments, or unnecessary email addresses in logs/UI.
- External API tokens are validated from server environment/configuration and never prefixed with `NEXT_PUBLIC_`. Production service-role access is server-only and permission-gated. Do not provide the production service-role key to public Vercel previews. Cache aggregated responses with a timestamp and rate-limit handling; do not cache access decisions.
- Public member and share-card APIs retain their existing allowlisted consent model; admin does not create a bypass around consent or publication state.
- Use signed/provider-verified webhook flows already in place; admin views are read-only over delivery and processing state unless an existing replay command is explicitly authorized.

## Mutation controls

| Command class | Required controls |
|---|---|
| Review/approve/reject Early Access | `waitlist.review`; validate state transition; require bounded reason; call existing command; audit actor, transition, target and trace |
| Referral/Priority intervention | `referral.manage`; show verified-referral evidence; preview effect; require reason and elevated confirmation; append grant/revoke event; audit; never rewrite referral counts |
| Invite issue/revoke | `admission.manage`; verify application authority and current access mode; show target/expiry/delivery; explicit confirmation; existing service and durable audit |
| Cohort/public identity | Default read-only; no renumbering or implicit profile visibility. A specifically approved command must preserve immutable identity and consent history |
| Share Card publish/revoke | `share_cards.manage`; show exact variant and public snapshot/URL; explicit publish/revoke confirmation; recheck current authority and consent; audit; never auto-publish |
| Billing reconciliation | `billing.read` for display; separate permission and dry-run for reconciliation; never convert provider IDs directly into product capabilities or manually mutate normalized entitlements |
| Job replay/recovery | `incidents.recover`; original idempotency key, bounded input and dry-run when feasible; verify terminal/orphaned state; confirm action and target; preserve trace; audit |

## Audit record contract

Record at minimum: generated event UUID, server timestamp (UTC), authenticated user UUID, role/permission snapshot, operation, entity type and UUID, result, reason, request/trace ID, relevant run/provider IDs, and redacted before/after summary. Make events append-only to application roles, restrict reads by role, and define retention. Never store raw tokens or payloads in audit summaries.

## Verified repository findings

- `src/server/modules/auth/auth.service.ts` resolves users through Supabase `auth.getUser()` and treats transient provider errors separately from unauthenticated users. Workspace/domain authorization is present in many route and service boundaries.
- Supabase service-role client is server-only under `src/server/providers/supabase/service.ts`. This is the correct pattern to retain and wrap in admin query/command modules.
- `proxy.ts` refreshes Supabase sessions; it skips direct session verification for API routes and server actions, which must therefore enforce their own auth and authorization. Existing server actions/routes demonstrate this pattern; every admin boundary needs explicit checks.
- Current auth source contains no MFA/AAL2 enforcement. No admin membership or admin permission model was found.
- The customer app's `next.config.ts` has no blanket security response headers. Admin responses add noindex, frame denial, no-store, a per-request nonce CSP, MIME sniffing denial and a restrictive permissions policy only on the exact Admin host. Verify the deployed edge/host policy separately before private data is served.
- Health route is a safe, unauthenticated database readiness endpoint that returns no secrets. Its result must remain scoped to the database node.
- Static migrations contain numerous `SECURITY DEFINER` functions. Many are required for atomic writes or deliberately narrow public projections. The existence of these functions is not proof of a vulnerability; production owner/ACL/search-path/body review is required. Some function bodies pin `search_path`; verify every deployed function and grant individually.
- The migration text shows RLS enabled broadly on public tables and explicit member/service policies. Live Advisor output is recorded in `00-full-audit.md`; effective grants and per-function ACLs still require review. Do not describe the project’s full RLS posture as certified based on source migrations or Advisor counts alone.

## Required live checks before enabling admin

1. Review the current Supabase Security and Performance Advisor output; triage SECURITY DEFINER exposure, leaked-password protection, and FK indexing with object/function names and deployed ACLs.
2. Compare remote `schema_migrations` to local migrations, especially the applied Share Cards migration and the production `product_routing_edges` unique constraint.
3. Verify Supabase Auth MFA and password policy settings, allowed redirect URLs, session lifetime/revocation behavior and account recovery settings.
4. Confirm Vercel project roles/environment isolation, analytics status, domain routing and security headers.
5. Follow `06-production-auth-runbook.md` to verify the applied migration and operator-provisioned existing Auth identity. Validate production integration reads only after the migration and membership grant are separately approved. Do not create a test Auth user or run lifecycle mutations against customer data. Missing credentials or permissions must render unavailable.
