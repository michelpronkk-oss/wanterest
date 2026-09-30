# Wanterest Admin — Data Sources and Reuse Plan

Audit date: 2026-09-30; plan updated 2026-09-30. “Exists” means evidenced in this checkout or a connected read-only integration; it does not imply a complete admin API. There is one Supabase source: the existing Wanterest production project. No staging, disposable, or secondary Supabase project will be created.

## Source inventory

| Admin capability | Authoritative source / reusable implementation | Status now | Decision |
|---|---|---|---|
| Visitors and pageviews | Vercel Web Analytics API; existing production Vercel project `wanterest` (`prj_sNTTM87CHOT6h5gLNz5g9r8fducu`, team `team_tM3JXep1ZWAuR2rAcvuTtXAf`) | Server-only `visits/count` and `visits/aggregate` reads support today, 7-day, 30-day and bounded custom UTC periods, page paths, homepage views, `/waitlist` visitors, referrers and daily trends. The deployment start timestamp bounds available history. Local and production values remain unavailable until server access, Analytics enablement and start time are verified. | Configure a read-only `VERCEL_API_TOKEN` and `VERCEL_WEB_ANALYTICS_START_AT` server-side. Visitors are aggregate telemetry, never joined to lifecycle identities. |
| Application started / UTM | Vercel Web Analytics `events/count` and visit groupings | `application_started` is a property-free event emitted on first form interaction. UTM source/medium/campaign groupings and custom events render unavailable when API access or plan does not support them. | Custom events require Pro or Enterprise; UTM dimensions require Web Analytics Plus or Enterprise. These events are never application truth. |
| Lifecycle conversion | `waitlist_applications`, verified timestamp, referral/Priority, invite/admission, cohort membership and Share Card publication records | The existing Overview uses exact Supabase counts and the Growth projection uses daily database event counts for the selected UTC range. Current-state Priority, approved-for-invite, pending invitations, active cohorts and published cards are separate from period event totals. | Values stay unavailable when Supabase is unconfigured or a source read fails. A missing value never becomes zero. |
| Early Access management | `waitlist_applications`, `waitlist_referrals`, `waitlist_priority_access`, invitations, admissions and cohort memberships | Candidate implementation adds a searchable, status-filtered queue and private detail/history page. Applicant email is used only for server-side search/invite delivery and is not rendered. Referral progress and Priority stay read-only. Founder/Operations Admin actions use narrow service-role wrappers over existing transition/invitation RPCs. | Require active membership, AAL2, strict input, explicit confirmation, request idempotency and append-only audit. Acceptance already creates admission and assigns a permanent cohort seat atomically; there is no separate admission or cohort-selection action. |
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
| Admin audit foundation | Append-only `admin_audit_events` in the existing production Postgres project | Migration `20261102000000` applied and catalog-verified on 2026-09-30; no membership provisioned. Candidate migration `20261104000000` adds audit wrappers and has passed local PostgreSQL rehearsal only. | Candidate Founder/Operations Admin Early Access writes remain unavailable until the migration and application release are separately approved and deployed. |
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

Reuse event-backed lifecycle state for applications, verification, Priority, review, invitations, acceptance and admission. Vercel Web Analytics provides aggregate pageviews/visitors, page/referrer/UTM dimensions, and a property-free `application_started` event. Its data is separate from lifecycle rows; no visitor-to-applicant identity join, session count, or inferred entry-page attribution is made. Values before `VERCEL_WEB_ANALYTICS_START_AT` remain unavailable. UTM and custom-event support are plan-gated. Production inspection on 2026-09-30 found the required Search Console OAuth variables, `VERCEL_API_TOKEN`, and `VERCEL_WEB_ANALYTICS_START_AT` absent from the existing Vercel project's Production environment. [Vercel Web Analytics API](https://vercel.com/docs/analytics/web-analytics-api), [API pricing and limits](https://vercel.com/docs/analytics/limits-and-pricing).

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
