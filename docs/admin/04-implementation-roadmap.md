# Wanterest Admin — Implementation Roadmap

Status: Phases A–C are implemented locally on `codex/adminsystem`, which includes fetched production `origin/main`. The approved foundation migration is applied to production. Founder membership provisioning and deployment are separate pending release steps.

## Phase A — Architecture and security gate

**Outcome:** approved monorepo workspace, Admin server boundary, exact-host routing inside the existing Vercel project, environment/secret inventory, permission vocabulary, and data classification.

- **Done:** record the decision in `docs/architecture.md` and add an explicit architecture decision for the admin backend.
- **Done:** fetched and merged current `origin/main` into `codex/adminsystem`; preserved prior local state in a named stash and reapplied relevant work on the updated product files.
- Establish `apps/admin` and narrow shared contracts with a separate lock/build/deploy path.
- **Done:** production Postgres 17.6 and migration head `20261101000000` were confirmed before release; the approved admin migration is now recorded as `20261102000000`. The operations tables and admin security objects were verified read-only after application. Auth MFA/password/session settings still require operator review before sign-in is enabled.

**Exit checks:** architecture approval recorded; admin deploy cannot target customer project; no service credential enters client bundle; live schema compatibility checked. Review project-wide Advisor findings and Auth settings before enabling production sign-in.

## Phase B — Private application foundation

**Outcome:** local admin preview with authenticated shell and a truthful system status summary.

- **Implemented locally:** `apps/admin` Next.js workspace, noindex metadata, security response headers and per-request nonce CSP, premium responsive sign-in/recovery screens using the exact shared Wanterest LogoMark and bundled brand fonts, server-side email/password and password-recovery flows, UUID-linked membership lookup, read-only role permission map, TOTP enrollment/challenge, and safe sign-out.
- **Applied and verified:** private `admin_memberships` and append-only `admin_audit_events` foundation migration. No membership is seeded; no customer rows or Auth identities were modified.
- **Implemented locally:** server-only, read-only operations projection for recent job runs and source health/control state. Missing Supabase connection or missing migration displays as unavailable; visitor/lifecycle/billing metrics remain explicitly unavailable.
- **Still needed:** operator-only membership provisioning, short-lived/revocable admin sessions, per-auth/search rate limiting, explicit origin defense review, audit writer integration for every future mutation, and live PostgreSQL RLS integration coverage.

**Checks run:** focused authz unit contracts deny ordinary or metadata-escalated users and require MFA; operations snapshot contracts cover missing/stale states; migration contract tests check private grants and append-only audit structure. The local login page responds 200 with `noindex` and a request nonce CSP. These are source-level/unit checks, not a live PostgreSQL RLS integration test. Audit actor derivation is not wired because mutation commands are not implemented.

**Current verification note (2026-09-30):** root and Admin typechecks, lint, optimized builds, and the full repository suite pass. Full suite: 231 files passed, 13 skipped; 1,852 tests passed, 16 skipped. Root lint has two existing unused-parameter warnings in `tests/modules/waitlist-admission.test.ts`; there are no lint errors. The production migration is applied as `20261102000000` and catalog-verified. Desktop/mobile sign-in and recovery views were inspected, including keyboard focus and unavailable states. The local app has no production Auth configuration, so authenticated dashboard and MFA screens were not visually entered. No membership was provisioned and production sign-in was not exercised.

## Phase C — Read-only overview and source modules

**Outcome:** first connected modules using verified data.

1. **Overview — implemented locally:** exact counts for applications and verification, Priority grants, invitation issues, admissions, distinct active cohorts, and published Share Cards; every card names its table, window/status definition and read timestamp. Lifecycle counts use trailing 30 days (UTC) or explicitly named current state. Missing reads render unavailable.
2. **Operations and Trigger incident — implemented locally:** bounded `job_runs`, `source_health`, `source_controls`, and server-only production Trigger `GET /api/v1/runs` reads. Retry/error code, last success/failure, source latency/failure count and next retry are shown where persisted. The routing-edge `42P10` incident is documented with latest run state, no replay or routing change. A later fix to the conflict target remains a separate product change and is out of scope here.
3. **Early Access management — implemented read-only:** searchable, status-filtered latest 30 applications with verified referrals, Priority, latest invite, admissions and cohort. Email matching remains server-side, and referral counts come from table SELECTs because `get_waitlist_referral_status` can create a referral identity. No lifecycle mutation is exposed.
4. **Analytics — server adapter prepared:** Vercel production project `wanterest` is identified; the supported Web Analytics visits/count endpoint is queried server-side for a trailing 30-day period when `VERCEL_API_TOKEN` is provided. Project tracking state/token are not available locally, so the panel is unavailable. No browser tracking was added. Visitors/pageviews are separate from Supabase lifecycle conversion.
5. **System Map — implemented locally:** provider nodes reflect the actual 15-entry source registry; pipeline stages mirror the approved explicit pipeline; Supabase/Trigger/Vercel/OpenAI/Dodo/Resend/Admin dependencies are represented. Only recorded checks drive status; missing probes are unknown and source health older than 24 hours is stale.
6. **Billing and delivery:** normalized subscription/entitlement/webhook state, Vercel deployments, Trigger deployments and Resend delivery metadata only after read paths and access scopes are verified. Redact identifiers and provide safe links.

Every value shows source, period, last refresh, and stale/unavailable state. Local/preview can show explicit “integration not connected”; no mock production-looking data. App-side Supabase configuration accepts only the known production project hostname and is disabled on Vercel Preview.

## Phase D — Operational management commands

**Outcome:** permissioned, attributable controls for approved lifecycle commands.

- Add Early Access review and invitation management through existing validated commands.
- Add justified referral/Priority intervention only if the current domain service supports append-only manual decisions; otherwise make a separate architecture/command decision first.
- Add Share Card publication/revocation through existing authority checks and explicit consent UX.
- Keep workspaces/cohorts, billing and identity histories read-only unless a narrowly scoped existing command is approved.
- Add preflight/dry-run where meaningful, confirmation for consequential actions, idempotency, safe error display and complete audit records.

## Phase E — System map and incidents

**Outcome:** graph based on actual code/config dependencies plus persisted health observations.

- **Implemented locally:** registered provider nodes, approved pipeline stages and actual declared service dependencies are shown. Observed states distinguish healthy, degraded, critical, disabled, stale and unknown; unobserved health stays unknown. Incident diagnostics link to safe Trigger.dev project context. Probes and remediation controls remain follow-up work.

- Define nodes/edges from provider registry, pipeline modules, jobs, data stores, customer read models and acquisition/access modules.
- Probe critical services independently; record check time, last success/attempt, freshness, latency, errors and retries. Apply `unknown` before evidence and after staleness.
- Add Trigger/Vercel/Resend/Supabase diagnostics and safe console/runbook links.
- Add focused incident drawer with impact paths and approved recovery commands. Never imply live status from stale observations.

## Phase F — hardening and release readiness

Run repository typecheck/lint/build and focused admin authorization/security tests plus static migration tests. Use read-only SELECT-based schema compatibility checks against production; do not apply DDL or use live customer mutations as tests. Cover ordinary-user denial, role escalation, missing integrations, stale checks, status misclassification, audit attribution, CSRF/origin checks, recovery and retry idempotency, redaction, and confirmation. Review generated client chunks for secret leakage. Public Vercel previews receive no production service-role credential and no production mutation path.

**Release remains a user-controlled step:** share the reviewable result and release plan, then obtain explicit approval before production deployment.

## Immediate priority outside the admin implementation

The production Trigger.dev failure is an existing operational incident and should be handled on a separate narrowly scoped fix. Verify the deployed `product_routing_edges` schema and recent migration state; align the application upsert conflict target and database unique key without changing routing/qualification policy; add the targeted contract/regression coverage; deploy and confirm a successful refresh. This audit did not modify or replay production jobs. Next approval required: review and approve the exact admin foundation migration; membership provisioning remains a separate operator action after migration success.
