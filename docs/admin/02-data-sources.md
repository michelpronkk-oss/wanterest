# Wanterest Admin — Data Sources and Reuse Plan

Audit date: 2026-09-29; plan updated 2026-09-29. “Exists” means evidenced in this checkout or a connected read-only integration; it does not imply a complete admin API. There is one Supabase source: the existing Wanterest production project. No staging, disposable, or secondary Supabase project will be created.

## Source inventory

| Admin capability | Authoritative source / reusable implementation | Status now | Decision |
|---|---|---|---|
| Visitors and pageviews | Vercel Web Analytics count API; production Vercel project `wanterest` (`prj_sNTTM87CHOT6h5gLNz5g9r8fducu`, team `team_tM3JXep1ZWAuR2rAcvuTtXAf`) | Server-only REST adapter prepared at `/v1/query/web-analytics/visits/count`; reads pageviews and unique visitors for a trailing 30-day UTC period. A server token is not configured locally and project tracking enablement remains unknown, so values are unavailable. | Configure a least-privilege `VERCEL_API_TOKEN` only on the server after verifying project tracking/privacy settings. Do not add visitor events to lifecycle totals. |
| Lifecycle conversion | `waitlist_applications`, verified timestamp, referral/Priority, invite/admission, cohort membership and Share Card publication records | Read-only Overview uses exact Supabase counts: applications/verification/invites/admissions for trailing 30 UTC days; Priority and published cards by current status; distinct cohorts with memberships. Source and request timestamp accompany every value. | Values stay unavailable when Supabase is unconfigured or a source read fails. A missing value never becomes zero. |
| Early Access management | `waitlist_applications`, `waitlist_referrals`, `waitlist_priority_access`, invitations, admissions and cohort memberships | Read-only searchable, status-filtered queue; 30 newest matches. Applicant email is used server-side only for matching and is not returned. Referral progress is calculated from a bounded SELECT of verified referral IDs; no lifecycle RPC is called. | Preserve the existing domain state machine. The UI exposes no edit, invitation, admission, referral or priority actions. |
| Referral and Priority | Referral repository/policy and append-only referral/priority events; threshold is 3 verified referrals | Policy and lifecycle exist | Reuse eligibility calculation. Exceptional manual grant/revoke requires named permission, bounded reason, dry-run where practical and audit event; never edit counters. |
| Invitations and admission | Invite/admission services and idempotent DB RPCs; resend/email state where available | Transactional admission and workspace provisioning exist; delivery reconciliation not proven live | Reuse commands/RPCs. Add diagnostics from durable invite/outbox/provider IDs; never expose raw invitation tokens. |
| Workspaces and cohorts | Workspaces/members, admission, permanent cohort membership and private public-profile consent rows | Implemented | Read through safe workspace/cohort contracts. Permanent numbers and consent are read-only unless a separately approved domain command exists. |
| Share Cards | Share Card authority, publication/revocation, analytics/event modules and public projection | Implemented in PR #1, confirmed merged; migration application date supplied by release notes but not independently queried live | Reuse explicit publish/revoke lifecycle and consent checks. Display public URL and engagement from event rows; do not auto-publish or expand consent. |
| Billing and access | Dodo billing adapter; normalized subscriptions, checkout sessions, billing webhook inbox, plan/entitlement state | Code and smoke tests exist; connected Dodo account not available | Build read-only provider/internal consistency view after live access is configured. Keep provider product IDs out of capability policy. Any correction remains a separately approved normalized command. |
| Jobs, runs and system map | `job_runs`, `source_health`, `source_controls`, provider registry, task registry and Trigger.dev run API | Live Operations and map screens use bounded persisted job rows, retry/error codes, source freshness/latency, and server-side Trigger production runs. The known `42P10` routing-edge incident is shown with current run status; it is not replayed or changed. | Missing probes are `unknown`; old source observations are `stale`; controls distinguish paused/disabled; blocked health is critical. No run controls are exposed. |
| Deployments and runtime incidents | Vercel project/deployment/runtime error APIs | One connected project, Ready production deploy after PR #1, aggregated errors available | Build server-side integration and safe deep links. Keep token out of browser and redact samples. |
| Email delivery | Resend adapter; provider API and durable email references if present | Domain `wanterest.com` verified/sending enabled; receiving and tracking disabled; no message-level audit run | Reuse delivery state where durable IDs exist, otherwise add an approved event/adapter contract. Do not infer delivery from verified domain. |
| Audit and event log | Existing `audit_log` plus domain-specific append-only lifecycle tables/events | Broad event history exists; no central cross-domain admin audit view | Build searchable, role-filtered projections; add a dedicated admin action audit boundary for future mutations. Sanitize before display. |
| Admin identity and auth | Existing production Supabase Auth user UUID; proposed `admin_memberships` record and Supabase Auth TOTP/AAL2 | Migration prepared locally only; no production membership is granted; the Auth identity must be reused | Require explicit operator membership provisioning for the existing Auth UUID and verified TOTP/AAL2. No duplicate user, test lifecycle mutation, or public registration. |
| Admin audit foundation | Append-only `admin_audit_events` in the existing production Postgres project | Migration `20261102000000` applied and catalog-verified on 2026-09-30; no membership provisioned | Initially record only admin operations; current UI has no lifecycle write actions. |
| Documentation/runbooks | `docs/architecture.md`, `docs/runbooks/production.md`, phase/layer design docs | Existing product/job/runbook coverage | Index local markdown and deep-link safe GitHub/Supabase/Vercel/Trigger pages. Add admin-specific incident playbooks as capabilities land. |

## Metric contract

Every admin metric carries:

```ts
type MetricEnvelope<T> = {
  value: T | null;
  state: "available" | "stale" | "unavailable";
  source: string;
  period: { from: string; to: string } | null;
  lastRefreshedAt: string | null;
  freshnessTargetSeconds: number | null;
};
```

`null` means no verified data source/result. It is distinct from a measured value of zero. The UI should show the source and last refresh time on each card/table/chart. Lifecycle conversions must identify the event timestamps and denominator used. Vercel traffic counts must not be summed with lifecycle events or duplicated through custom events.

## Capability build-vs-reuse detail

### Overview and growth

Reuse event-backed lifecycle state for applications, verified users, Priority, review, invitation, admission, workspaces/cohorts, share-card events and normalized billing. Build a new overview read model for the combined period filters and `MetricEnvelope`. Traffic metrics need confirmed Vercel Web Analytics tracking and a server-side API client. The official API offers aggregate pageview/visitor queries and groupings for time, route, country, referrer and device; the package is not currently present. The official docs state Web Analytics is available on all plans, while custom events require Pro or Enterprise; lifecycle reporting should therefore come from existing server-side Wanterest events rather than custom events. [Vercel Web Analytics API announcement](https://vercel.com/changelog/web-analytics-api), [Vercel Web Analytics pricing and limits](https://vercel.com/docs/analytics/limits-and-pricing).

### Operations and system map

Reuse `job_runs`, `source_health`, `source_controls`, automatic monitoring state, source-health/query-yield/supply telemetry, Trigger.dev run detail and task deployment APIs. Build a graph read model from verified dependencies plus status snapshots. Do not mark components healthy just because the database probe succeeded. The codebase already holds most operational truth; admin needs a unified, bounded projection and UI rather than a parallel monitoring database.

### Event log and incident response

Reuse domain events and audit log, with a new redacted cross-domain search projection and admin-action audit append path. Build filters, trace/run correlation and links to the existing production runbook. Recovery controls must map to an existing typed command with dry-run/confirmation/permission; free-form SQL and broad data edits are out of scope.

## Connected-service evidence and gaps

- **GitHub:** PR #1 fetched directly and is merged. Do not re-merge or treat it as open work.
- **Vercel:** project list confirms project `wanterest` and its project/team IDs above. The official page-view count API is supported. Project detail invocation was rejected by a connector argument mismatch; analytics enablement/settings remain unknown. No Vercel API token was read or added to the browser.
- **Trigger.dev:** production project `proj_cxghokhenspxdbmgrczh` is connected. On 2026-09-29, the failed-run read returned 10 recent `match-refreshed-partition` failures (latest at 12:03 UTC); the recent-run sample also showed a successful run at 21:03 UTC. This is a recurring historical incident with a later success observed, not a claim that the task is continuously failing. The UI reads the latest 24-hour run state with the official read-only runs API.
- **Resend:** domain configuration is available; message-level delivery status was not queried. `wanterest.com` is verified; sending is enabled; receiving and open/click tracking are disabled.
- **Dodo:** no connected Dodo integration was available. Production subscription/payment status remains unavailable.
- **Supabase:** read-only inspection confirms production Postgres 17.6, migration head `20261101000000`, no admin foundation objects, and compatible operations tables plus `auth.users`. Security Advisor reports 40 RLS/no-policy INFO findings, 26 anon and 30 authenticated SECURITY DEFINER WARN findings, and leaked-password protection disabled; Performance Advisor reports 144 unindexed foreign keys, one auth RLS initplan, and 37 unused indexes. These project-wide findings are not adjudicated individually here. Review them and Auth MFA/password/session settings before enabling admin access. No production DDL, data write, membership grant, or Auth account creation was performed. See `06-production-auth-runbook.md` for the prepared operator procedure.
