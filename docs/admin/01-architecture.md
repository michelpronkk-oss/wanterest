# Wanterest Admin — Architecture Proposal

Status: approved foundation decision recorded in `docs/architecture.md`; `codex/adminsystem` now includes fetched production `main`. The existing Wanterest production Supabase project is the eventual Auth and data source. No second Supabase environment will be created. The migration is schema-compatible for additive first application based on read-only live inspection, but awaits explicit approval. This does not authorize a production migration, membership grant, or deployment.

## Decision summary

Build a dedicated, independently deployed Next.js App Router application in this repository, with an explicit server-only admin application boundary and a separate Vercel project. Keep it in the same Git repository to reuse code and review history, but give it its own package/build/deployment configuration and release gate. The admin browser talks only to this app’s authenticated route handlers/server actions. It never connects to Supabase with a service-role key, Trigger.dev, Dodo, Resend, or the Vercel API directly.

Do not add admin routes to the customer-facing Next.js deployment. Do not point a second Vercel project at the customer app’s same root build. The current repository is an npm app rather than a workspace; establish the workspace/package boundary as part of the architecture change so deployment does not depend on accidental parent-directory imports.

## Application and trust boundaries

```text
admin.wanterest.com browser
  └─ admin Next.js app (separate Vercel project, noindex, restrictive headers)
       ├─ Supabase Auth session: email/password + verified MFA assurance
       ├─ admin authorization service: UUID-linked admin membership + permission checks
       ├─ typed admin commands and query/read-model contracts
       ├─ audit writer (actor, role, action, target, reason, trace, before/after summary)
       └─ server-only adapters
            ├─ Supabase service-role repository (least-privilege selects/RPCs only)
            ├─ Vercel Analytics API client (aggregated traffic only)
            ├─ Trigger.dev read API (run/deployment status)
            ├─ Resend read API (message status, when authorized)
            └─ Dodo adapter and existing normalized Wanterest billing records

Supabase RLS and customer schema remain unchanged by the admin UI.
Admin identity and append-only audit schema use the new objects created by production migration `20261102000000`. Membership is still provisioned separately by an authorized operator after explicit approval.
```

The server verifies the Supabase user ID with `auth.getUser()` and checks an internal `admin_memberships.user_id` row in the same authorization path for every privileged operation. Email address, user metadata, workspace membership, client-sent role, and stale application state are not authority. Admin identity is UUID-backed. Role permissions are enforced in server command entry points, never only in UI visibility.

## Repository shape to approve

```text
apps/admin/                         # isolated Next.js app, its routes/layout/styles
packages/admin-contracts/           # narrow serializable DTOs and validation schemas
src/server/modules/admin/           # authz, commands, queries, audit contracts
src/server/modules/*/               # existing domain-owned services; reuse public APIs
src/server/providers/admin/          # server-only external API adapters
docs/admin/                          # audit, runbooks, decisions
```

The actual extraction/reuse boundary should be small. Admin query services should depend on existing module public contracts or purpose-built safe read models, not query private table details across arbitrary domain modules. If a current module has no appropriate read command, add a typed admin-facing application contract in the owning module or an approved operations module rather than creating a second set of lifecycle rules.

## Isolation alternatives

| Option | Assessment |
|---|---|
| Admin pages/routes inside existing customer app | Reject. Shared deployment/release and broader route surface increase accidental exposure and couple founder tooling to customer releases. |
| Separate Next.js app under `apps/admin` in this repository | Recommended. Separate Vercel project and build give release isolation while one reviewed repository can share narrow, versioned server contracts. Requires a deliberate npm workspace and no implicit cross-root imports. |
| Separate repository/service | Defer. It creates duplicated domain contracts or a new remote internal API, deployment/secret surface, and synchronization burden before reuse boundaries are known. Revisit if monorepo deployment or access separation cannot meet the threat model. |
| Reuse customer production API as the admin backend | Reject. It lacks the internal admin authorization model and would couple privileged reads/actions to public product routes. |

## Authentication and authorization design

- Disable public sign-up in the admin app. Provision the user's existing production Supabase Auth UUID through an explicit operator-controlled membership grant after the migration is approved and applied. Never create a duplicate Auth account for admin access.
- Require Supabase email/password authentication and verified MFA. Sensitive operations require current `aal2`/MFA assurance; no editable metadata can satisfy the check.
- Store a private admin membership record linked by `user_id` with a role (`founder`, `operations_admin`, `support`, `read_only_analyst`), active/revoked state, grants, and audit timestamps. Use explicit permissions such as `waitlist.read`, `waitlist.review`, `admission.manage`, `billing.read`, `share_cards.manage`, `incidents.recover`; use deny-by-default checks.
- Keep memberships, audit records, and privileged projections unavailable to `anon`/`authenticated` browser roles. Use a server-only Supabase service client only after authenticating the existing production Auth identity, requiring AAL2, checking explicit membership and permission, then using narrow selects/RPCs; no generic SQL execution.
- Public Vercel preview deployments must not receive production Supabase service-role credentials. Local development may use operator-managed credentials only in a server-only `.env.local`; never expose them to a client bundle or public preview. Initial access is read-only.
- Add per-account and per-IP rate limits, CSRF/origin defenses for cookie-authenticated mutations, safe recovery, short admin session lifetime, explicit session revocation, no-store private responses, noindex robots metadata, and restrictive response headers.

## Data and service design

- Preserve domain command authority: early access review/admission/share-card operations must call existing validated lifecycle services, and billing state must go through its normalized adapter/services.
- Start read-only. Every query declares its authority table/source, time range, refresh timestamp, freshness threshold and redaction profile. Missing source or stale result appears as unavailable/stale, never as a zero or healthy status.
- Preserve immutable events and stable identity rows. Admin decisions append attributable events; they do not overwrite cohort numbers, referral history, prior matches/rankings, or external provider truth.
- Use a small cache only for aggregated or low-risk external reads (for example, Vercel Analytics and deployment summaries), with explicit TTL, source timestamp, rate-limit handling and per-user/role visibility. Do not cache authorization decisions or live mutation results without revalidation.
- Use a dedicated admin audit event table or approved audit module with actor user UUID, role snapshot, action, entity type/id, reason, trace/correlation ID, result and redacted before/after summary. Append-only to admins; no user-supplied audit actor.

## System map and status model

Create node/edge definitions from checked-in module/task/config/migration inventory, then join them with checked service observations. Each observation stores `checked_at`, observed status, last success, last attempt, freshness target, latency, recent error count, retries, run IDs and sanitized incident references. States are `healthy`, `degraded`, `critical`, `unknown`, and `intentionally_disabled` (the UI may label the latter as disabled). Unknown is the initial state until a real check succeeds.

Distinguish source configured/disabled/blocked/credit-limited from infrastructure failure. A scan with `complete_with_warnings` is not a total failure. A job that has no new execution must show stale/unknown after a per-node threshold. The database health route only informs the Supabase/Postgres node.

Use bounded polling initially and existing Trigger/webhook/event subscriptions where available. Persist only the status snapshot needed for history and alerting; do not mirror raw provider payloads. The incident drawer shows sanitized timeline, affected nodes and dependency paths, safe console links, runbooks, and only approved recovery commands.

## Design system

Use the requested restrained Wanterest visual language: warm off-white surfaces, charcoal type, limited lime for key state/action, strong accessible typography, concise metric cards, dense but legible tables, compact charts, keyboard-accessible filters/drawers, and responsive layouts. Show source, period, refresh time, freshness, and missing-data state adjacent to each metric. Avoid oversized KPI tiles, decorative gradients, and fake activity.
