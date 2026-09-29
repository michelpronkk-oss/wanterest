# Wanterest Admin — Full Audit

Baseline audit date: 2026-09-29 (Europe/Berlin). Release status update: 2026-09-30. The baseline inventory below remains historical; current migration and deployment status is updated where noted.

**Environment decision:** there will be no staging, disposable, or second Supabase project for this admin. The local admin application will eventually authenticate against and read from the existing Wanterest production Supabase project. Before the pending admin foundation migration is approved/applied, the console must not attempt privileged production reads. Initial production access will be explicitly granted to the existing Auth user UUID, require verified TOTP MFA/AAL2, and be read-only. No lifecycle mutation or test-user creation against production is authorized. Public Vercel previews receive no production Supabase service-role credential.

The audit inventory below records the baseline, while its implementation-status bullets have been updated for the current release. The separate admin app and shared brand package are implemented on `codex/adminsystem`, which incorporates fetched production `origin/main`. The approved admin identity/audit migration was applied to the existing production project on 2026-09-30 through an isolated Supabase CLI history containing all 56 production-applied migrations and only the approved admin migration as pending. Founder membership provisioning and Admin Vercel deployment remain pending.

## Executive findings

- Wanterest is a large Next.js 16.3.5 modular monolith with Supabase/Postgres as its system of record and Trigger.dev for durable background jobs. Phase 1–7 backend foundations, Early Access/admission/referral/cohort flows, normalized billing, operations telemetry, and Share Cards already have code and migrations.
- The separate `apps/admin` application has a server-enforced membership/role gate and TOTP MFA flow. The migration is applied, but no production admin membership is provisioned. Existing workspace ownership is not suitable as admin authorization.
- The public `/api/health` endpoint checks only whether a service-role query to `workspaces` succeeds. It accurately reports liveness/readiness for that probe but cannot validate Trigger.dev, provider availability, freshness, or downstream health.
- Live Trigger.dev data shows a recurring production failure: the latest sampled `match-refreshed-partition` run failed in edge persistence with PostgreSQL `42P10` (“no unique or exclusion constraint matching the ON CONFLICT specification”). The local repository migration's unique key includes `profile_version`, while the repository upsert conflict target omits it. The production run failed twice; the Trigger.dev list returned 63 failed runs for the requested seven-day filter, including repeated failures of this task. This needs a separate, carefully scoped production incident fix; no repair was attempted here.
- GitHub PR #1 is **closed and merged** (merge commit `6fc94b27f9b32f6e0231f5e2c951aedbfc579de8`). The branch `codex/adminsystem` now incorporates the latest fetched `origin/main` through merge commit `bf8e21c`; pre-existing local state was saved before integration and reapplied where it remained current. The admin changes remain uncommitted for review.
- `@vercel/analytics` is absent from the checked package manifest and no analytics component/track call was found in source. The Vercel project’s analytics setting and historical traffic were not verified. Do not display traffic as zero or install tracking until that status and privacy scope are confirmed.
- Resend reports `wanterest.com` verified, sending enabled, receiving disabled, and open/click tracking disabled. This verifies domain configuration, not delivery health for individual messages.
- Baseline read-only production inspection confirmed 56 applied migrations through `20261101000000_layer13b1_dynamic_share_card_engine_v1`, Postgres 17.6, and compatibility of the operations projection tables. On 2026-09-30, the approved `20261102000000_admin_console_foundation.sql` migration was applied as recorded version `20261102000000`. Independent verification confirmed both admin tables, RLS enabled with no policies, no anon/authenticated table access, intended service-role grants, `admin_memberships.user_id ON DELETE RESTRICT`, no audit actor FK, and an enabled append-only audit trigger. No Auth identities, customer rows, or memberships were created or modified.

## Repository and production inventory

| Area | Verified implementation | Operational implication |
|---|---|---|
| Web application | App Router routes under `src/app`; authenticated product app, public marketing/access pages, API routes, public member/share pages | Routes compose existing domain services; an admin UI is absent |
| Domain code | `src/server/modules/*` includes auth, access, workspaces, waitlist, cohorts, share-cards, billing, entitlements, usage, ingestion, intelligence, experiments, monitoring, observability, operations | Reuse typed commands/read models; do not duplicate business rules in admin routes |
| Database | Supabase migrations and generated `src/server/db/database.types.ts`; tables for workspaces, jobs, sources, evidence, intelligence, billing, waitlist, referrals, admissions, cohorts, share cards, experiments, and monitoring | Database remains authoritative; admin read paths must stay server-side and must not widen customer RLS |
| Authentication | Supabase SSR email/password session, server `auth.getUser()`, protected product layouts/actions, workspace membership checks | No explicit internal admin membership, MFA/AAL2 enforcement, role matrix, or admin session-revocation policy exists |
| Jobs | Trigger.dev SDK 4.6.4, task files under `src/trigger`, retry defaults (3 attempts), durable `job_runs` and dispatch recovery | Trigger.dev run IDs/traces are usable for operations; recent failures show freshness and schema mismatch are not synthesized into one health view |
| Billing | Dodo adapter and normalized internal subscriptions/entitlements, webhook inbox/idempotency, billing routes and reconciliation services | Reuse the billing query/reconciliation services; provider state must remain separate from internal entitlement state |
| Email | Resend provider adapter and templates/transactional email flows | Domain is verified; per-message delivery history is not available from local code alone |
| Hosting | One Vercel project `wanterest`; latest observed production deployment `READY` on merged PR #1 commit | No separate admin Vercel project is configured |
| Source integrations | Fixture, Hacker News, Bluesky, Reddit, GitHub, X, Product Hunt, Stack Exchange, G2, Trustpilot, YouTube, GitLab, Discourse, DEV, and public-web/search adapters appear in source; actual production enablement varies | Treat `source_controls`, `source_health`, provider diagnostics and supply telemetry as authoritative for operational status |
| Analytics | No Vercel Analytics package/import found in this checkout | Visitors/pageviews/countries/referrers are unavailable until tracking and the server-side API integration are verified |

## Verified system map

```text
Visitors / applicant / member
  ├─ public marketing, waitlist, referral, signup, invite, member and share-card routes
  │    └─ waitlist/referral/access/admission/cohort/share-card services
  │         ├─ Resend adapter (verification, invitations, notifications)
  │         └─ Supabase Auth + transaction-backed RPCs + private event tables
  └─ authenticated workspace user
       └─ workspace/product API + app routes (membership/auth checks)
            └─ scan command → job_runs/dispatch state → Trigger.dev product-demand-scan
                 └─ provider adapters → raw source evidence → canonical source items/conversations
                      → analysis/matching/ranking/signals → observations/map/gap/drift
                           → actions/digests/experiments → workspace read models

Shared infrastructure: Vercel (Next.js), Supabase Auth/Postgres, Trigger.dev, Resend,
Dodo Payments (through adapter), configured discovery providers, and OpenAI where configured.
```

The pipeline and boundaries above are grounded in `docs/architecture.md`, the current `src/server` modules, migrations, and Trigger task files. A UI system map must derive node dependencies from this inventory plus run/health data; it must not infer downstream health from `/api/health`.

## Operational evidence and current incidents

### Health endpoint

`src/app/api/health/route.ts` runs a service-role `select id from workspaces limit 1`. A successful query returns HTTP 200 with liveness and readiness `ok`; failure returns HTTP 503 with liveness `ok`, readiness `error`. It includes `checkedAt`, `traceId`/`x-request-id`, and the static `reddit: non_blocking` marker. It does not expose credentials or provider payloads. It is a valid DB readiness probe, not an end-to-end health check.

### Trigger.dev production state

Read-only connected-service inspection on 2026-09-29 found the Trigger.dev Wanterest production project and deployments through `v20260927.11`. The failed-run query for seven days returned 63 runs. The latest sampled `match-refreshed-partition` failure completed 2026-09-29 12:03 UTC, had two attempts, and reported PostgreSQL `42P10` during `product_routing_edges` upsert. Its conflict target is `workspace_id,product_id,conversation_id,routing_version,profile_fingerprint,evidence_fingerprint`; local migration `20261025000000_cross_product_routing_v1.sql` declares the unique constraint with `profile_version` as an additional column. Those definitions do not match. Repeated hourly failures mean this is a material background-job incident, not merely an admin telemetry gap. The DB migration actually applied to production was not re-read in this audit, so drift between production and repository must still be checked during the incident fix.

The runbook explicitly distinguishes incomplete source coverage and nonfatal provider warnings from scan failure. Admin health must preserve these distinctions and display per-source state and freshness rather than turning every warning into a failed system.

### Vercel production state

One Vercel project is linked locally. Connected Vercel deployment listing shows PR #1 merged to `main`, with a Ready production deployment at merge commit `6fc94b27f9b32f6e0231f5e2c951aedbfc579de8`. This confirms release deployment, not analytics tracking or application uptime. The connected Vercel runtime-error view for the last 24 hours showed two clusters: three expected unauthenticated errors on `/app` and `/app/settings`, and one sanitized transient auth-verification failure on a public-profile API route. They are evidence for an error view and incident correlation; the single transient event does not establish a current auth outage.

### Resend

Connected Resend read-only domain inventory reports `wanterest.com` verified in `eu-west-1`, sending enabled, receiving disabled, and both open and click tracking disabled. No message-level delivery query was performed.

### Dodo and Supabase

No Dodo integration was available in the connected-service inventory. Dodo is represented by adapter code, smoke tests, normalized subscription/webhook tables, and runbook procedures. Production billing health cannot be asserted from those artifacts.

Initial read-only Supabase inspection of the existing Wanterest production project on 2026-09-29 found Postgres 17.6, 56 applied migrations through `20261101000000_layer13b1_dynamic_share_card_engine_v1`, and no admin objects. `auth.users` exists; no user IDs/emails were enumerated. Production `job_runs`, `source_health`, and `source_controls` contain the columns used by the admin projection. The approved migration was subsequently applied and catalog-verified on 2026-09-30. No membership change or Auth mutation was performed.

Read-only Supabase Advisor findings for the whole production project: Security—40 RLS-enabled tables without policies ([INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)), 26 anon-executable ([WARN](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)) and 30 authenticated-executable ([WARN](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)) SECURITY DEFINER findings, and leaked-password protection disabled ([WARN](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)). Performance—144 unindexed foreign keys ([INFO](https://supabase.com/docs/guides/database/database-linter?lint=0004_unindexed_foreign_keys)), one auth RLS initplan (WARN), and 37 unused indexes (INFO). These instance counts are not individually adjudicated here and do not by themselves establish an admin-migration defect. The disabled leaked-password protection and current Auth MFA/password/session configuration require operator review before enabling production admin authentication. Static migration review finds many intentionally privileged SECURITY DEFINER RPCs; the Advisor result is a review inventory, not a finding-by-finding vulnerability assessment.

## Existing telemetry and gaps

| Signal | Exists now | Gap / admin treatment |
|---|---|---|
| Request correlation | `x-request-id` / `traceId`, sanitized API errors, run trace/job IDs | Connect HTTP trace to job, Trigger run, provider and incident where IDs exist; do not print secrets or raw payloads |
| Durable job state | `job_runs`, idempotency key, attempt count, trigger run linkage, dispatch state, error fields | Needs unified query/read model for queue age, last attempt/success, stuck/orphaned runs, latency and retries |
| Source health | `source_health`, `source_controls`, per-source scan diagnostics, source-health aggregation, supply/query-yield telemetry | Derive disabled/blocked/degraded/unknown/healthy separately; include check timestamp and freshness window |
| Monitoring | scheduled automatic monitoring, notification delivery, source health alerts | Need validate current production schedule, notification transport, and incident aggregation from live runs |
| Business lifecycle | append-only waitlist/application/referral/admission/cohort/share-card/billing/experiment events | Reuse service query contracts and event history; verify which stages have complete delivery attribution |
| Web traffic | no package/import observed | Visitors, pageviews, pages, referrers, countries and devices unavailable until tracking is confirmed; do not synthesize historical metrics |
| Revenue | normalized Dodo subscription/webhook/entitlement records | No verified live Dodo data available; show unavailable until linked and reconciled |
| External delivery/deploy status | Vercel and Trigger.dev connected metadata; Resend domain settings | Per-run deployment/runtime/email delivery data should be fetched server-side with cached, redacted projections |

## Security findings by severity

Severity is based on verified evidence. Unverified external settings are explicitly left unclassified.

| Severity | Finding | Evidence and action |
|---|---|---|
| Critical blocker for admin release | Admin authorization migration is pending | The local admin implementation and migration are unmerged and not applied to production. Until explicit approval, do not query production operational rows from the console. Workspace owner/admin roles are unrelated and must not grant console access. |
| High operational | Recurring production job failure | Trigger.dev confirms repeated `42P10` routing-edge persistence failures. Fix via a separately reviewed migration/code change after verifying live schema; do not change qualification/business rules. |
| High verification gap | Auth settings, effective grants, and per-function ACL review remain open | Schema and migration-head compatibility were checked read-only; verify MFA/password/session settings and effective grants before enabling production login. No migration or production write occurred. |
| Medium | Global security headers not explicitly configured in repository | `next.config.ts` only enables React Compiler; no explicit global CSP, frame, content-type, referrer, or permissions header configuration was found. Verify Vercel/edge policy and add a reviewed app policy as an admin deployment requirement. |
| Medium | Public `SECURITY DEFINER` surface needs deployment-time ACL review | Many RPCs intentionally bypass RLS for atomic lifecycle operations. Review function owner, exact grants, safe `search_path`, `auth.uid()`/service-role checks and output allowlists against production ACLs. Do not blanket-revoke or weaken RLS. |
| Medium | No enforced admin MFA/session revocation today | Existing auth uses Supabase `getUser`; repo search found no MFA/AAL2 or strict session table checks. Admin actions must require MFA assurance and revoke/expire sessions safely. |
| Review required | Supabase Advisor findings: leaked-password protection, SECURITY DEFINER grants and unindexed foreign keys | Read-only Advisor counts are available; review individual findings and live ACLs before production auth or unrelated remediation. |
| Low / scoped | Health endpoint reveals a narrow DB ready/degraded result | It returns no environment values or credentials and is documented as a safe probe. Keep it narrow and avoid promoting its status to every service node. |

## Audit limitations

- The current working directory contains preserved local/admin work. The named `codex/adminsystem preserve local state before origin/main integration` stash was not popped or discarded.
- `codex/adminsystem` includes fetched `origin/main` at `6fc94b2` through merge commit `bf8e21c`. A separate clean worktree at `origin/main` was used for baseline build, typecheck, and suite comparison.
- PR #1 is merged. No deploy, migration, production membership, or production data mutation was performed.
- Live Supabase migration/advisor state and Dodo provider state remain unverified. Vercel Analytics enablement/settings also remain unverified even though the absence of package wiring in this checkout is verified.
