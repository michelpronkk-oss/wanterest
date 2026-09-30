# Wanterest Admin — Implementation Roadmap

Status: Phases A–C and Admin Operations + Growth Intelligence V1 are implemented locally on `codex/admin-ops-growth-v1`, based on current `origin/main` commit `a392de928d9eb2388fb24f6a5683cba0ed8debef`. The production foundation migration `20261102000000` remains applied. The new forward-only migration `20261104000000_admin_operations_growth_v1.sql` is local and unapplied; no customer lifecycle operation or Admin membership was executed. Merge, migration application, membership provisioning and deployment remain separate approvals.

## Phase A — Architecture and security gate

**Outcome:** approved monorepo workspace, Admin server boundary, exact-host routing inside the existing Vercel project, environment/secret inventory, permission vocabulary, and data classification.

- **Done:** record the decision in `docs/architecture.md` and add an explicit architecture decision for the admin backend.
- **Done:** fetched and merged current `origin/main` into `codex/adminsystem`; preserved prior local state in a named stash and reapplied relevant work on the updated product files.
- Establish `apps/admin` and narrow shared contracts with a separate lock/build/deploy path.
- **Done:** production Postgres 17.6 and migration head `20261101000000` were confirmed before release; the approved admin migration is now recorded as `20261102000000`. The operations tables and admin security objects were verified read-only after application. Auth MFA/password/session settings still require operator review before sign-in is enabled.

**Exit checks:** architecture approval recorded; admin deploy cannot target customer project; no service credential enters client bundle; live schema compatibility checked. Review project-wide Advisor findings and Auth settings before enabling production sign-in.

## Phase B — Private application foundation

**Outcome:** local admin preview with authenticated shell and a truthful system status summary.

- **Implemented locally:** `apps/admin` Next.js workspace, noindex metadata, security response headers and per-request nonce CSP, premium responsive sign-in/recovery screens using the exact shared Wanterest LogoMark and bundled brand fonts, server-side email/password and password-recovery flows, UUID-linked membership lookup, deny-by-default role permissions, TOTP enrollment/challenge, and safe sign-out.
- **Applied and verified:** private `admin_memberships` and append-only `admin_audit_events` foundation migration. No membership is seeded; no customer rows or Auth identities were modified.
- **Implemented locally:** server-only, read-only operations projection for recent job runs and source health/control state. Missing Supabase connection or missing migration displays as unavailable; visitor/lifecycle/billing metrics remain explicitly unavailable.
- **Still needed before production use:** operator-only membership provisioning; review of session lifetime/revocation, Auth settings, rate limiting and deployed ACLs; final production migration preflight; and separate code-release approval. No membership has been provisioned.

**Checks run:** focused authz unit contracts deny ordinary or metadata-escalated users and require MFA; operations snapshot contracts cover missing/stale states; migration contract tests check private grants and append-only audit structure. Candidate migration `20261104000000` also passed an isolated local PostgreSQL runtime rehearsal. No live production mutation was performed; lifecycle audit actors derive from the current server-verified session.

**Current verification note (2026-09-30):** root and Admin typechecks, lint, optimized builds, and the full repository suite pass. Full suite: 245 files passed, 13 skipped; 2,018 tests passed, 16 skipped. Root lint reports two pre-existing unused-parameter warnings in `tests/modules/waitlist-admission.test.ts`; there are no lint errors. Production foundation migration `20261102000000` remains applied; candidate operations migration is locally rehearsed and unapplied in production. No membership was provisioned and production sign-in was not exercised.

## Phase C — Read-only overview and source modules

**Outcome:** first connected modules using verified data.

1. **Overview — implemented locally:** exact counts for applications and verification, Priority grants, invitation issues, admissions, distinct active cohorts, and published Share Cards; every card names its table, window/status definition and read timestamp. Lifecycle counts use trailing 30 days (UTC) or explicitly named current state. Missing reads render unavailable.
2. **Operations and Trigger incident — implemented locally:** bounded `job_runs`, `source_health`, `source_controls`, and server-only production Trigger `GET /api/v1/runs` reads. Retry/error code, last success/failure, source latency/failure count and next retry are shown where persisted. The routing-edge `42P10` incident is documented with latest run state, no replay or routing change. A later fix to the conflict target remains a separate product change and is out of scope here.
3. **Early Access operations — implemented in candidate:** searchable latest 30 records and a private detail page with lifecycle, referrals, Priority, invitation/delivery, admission, cohort, and audit history. Founder/Operations Admin can approve, hold, reject, send, resend, or revoke through narrow server actions and transaction wrappers after the application/migration release is active. No manual admission, cohort assignment, referral or Priority mutation is exposed. Email lookup/delivery stays server-side.
4. **Growth analytics — implemented against Vercel Web Analytics API:** visitors, pageviews, homepage views, `/waitlist` visitors, `application_started`, daily trends, referrers, top page paths, and plan-gated UTM dimensions. All traffic remains separate from the authoritative Supabase lifecycle stages. Sessions and true landing pages are explicitly unavailable; pre-instrumentation visitor data is unavailable, not zero.
5. **System Map — implemented locally:** provider nodes reflect the actual 15-entry source registry; pipeline stages mirror the approved explicit pipeline; Supabase/Trigger/Vercel/OpenAI/Dodo/Resend/Admin dependencies are represented. Only recorded checks drive status; missing probes are unknown and source health older than 24 hours is stale.
6. **Billing and delivery:** normalized subscription/entitlement/webhook state, Vercel deployments, Trigger deployments and Resend delivery metadata only after read paths and access scopes are verified. Redact identifiers and provide safe links.

Every value shows source, period, last refresh, and stale/unavailable state. Local/preview can show explicit “integration not connected”; no mock production-looking data. App-side Supabase configuration accepts only the known production project hostname and is disabled on Vercel Preview.

## Phase D — Operational management commands

**Outcome: implemented locally for Early Access lifecycle controls; production release remains separately gated.**

- **Done:** Early Access review and invitation management through canonical validated commands, with AAL2, active membership recheck, confirmation, audit, and idempotent request keys.
- Add justified referral/Priority intervention only if the current domain service supports append-only manual decisions; otherwise make a separate architecture/command decision first.
- Add Share Card publication/revocation through existing authority checks and explicit consent UX.
- Workspaces/cohorts, billing, identity histories, referrals/Priority, Share Cards, and Trigger jobs remain read-only.
- **Done for implemented controls:** confirmation, idempotency, safe error display and audit records. No broad data editing or raw SQL control exists.

## Phase E — System map and incidents

**Outcome:** graph based on actual code/config dependencies plus persisted health observations.

- **Implemented locally:** registered provider nodes, approved pipeline stages and actual declared service dependencies are shown. Observed states distinguish healthy, degraded, critical, disabled, stale and unknown; unobserved health stays unknown. Incident diagnostics link to safe Trigger.dev project context. Probes and remediation controls remain follow-up work.

- Define nodes/edges from provider registry, pipeline modules, jobs, data stores, customer read models and acquisition/access modules.
- Probe critical services independently; record check time, last success/attempt, freshness, latency, errors and retries. Apply `unknown` before evidence and after staleness.
- Add Trigger/Vercel/Resend/Supabase diagnostics and safe console/runbook links.
- Add focused incident drawer with impact paths and approved recovery commands. Never imply live status from stale observations.

## Phase F — hardening and release readiness

Run repository typecheck/lint/build and focused admin authorization/security tests plus static migration tests. The candidate SQL was applied only to a unique local PostgreSQL rehearsal after replaying the production-valid baseline through `20261103000000`; a clean reset and full migration replay succeeded. Do not apply production DDL or use live customer mutations as tests. Cover ordinary-user denial, role escalation, missing integrations, stale checks, status misclassification, audit attribution, CSRF/origin checks, recovery and retry idempotency, redaction, and confirmation. Review generated client chunks for secret leakage. Public Vercel previews receive no Admin production credentials and no Admin mutation path.

**Release remains a user-controlled step:** share the reviewable result and release plan, then obtain explicit approval before production deployment.

## Immediate priority outside the admin implementation

The production Trigger.dev failure is an existing operational incident and should be handled on a separate narrowly scoped fix. Verify the deployed `product_routing_edges` schema and recent migration state; align the application upsert conflict target and database unique key without changing routing/qualification policy; add the targeted contract/regression coverage; deploy and confirm a successful refresh. This audit did not modify or replay production jobs. Next approval required: review the exact candidate `20261104000000_admin_operations_growth_v1.sql` and approve its production migration preflight. Founder provisioning, environment-variable configuration and Vercel release remain separate operator approvals.
