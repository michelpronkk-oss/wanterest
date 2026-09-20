# Wanterest

Wanterest is a demand-intelligence SaaS built as a modular Next.js monolith. The backend now
contains the Phase 1 tenancy foundation, Phase 2 raw/canonical ingestion, Phase 3 product and
conversation intelligence, Phase 4 Demand Map/Gap/Drift primitives, Phase 5 evidence-backed
Actions and Digests, Phase 6 backend billing foundations, and the Phase 7 backend experiment and
operations primitives. The initial authenticated dashboard foundation now lives under `/app`; the
first functional slice is the scored Signals view.

## Local setup

Prerequisites: Node.js 20+ and the [Supabase CLI](https://supabase.com/docs/guides/cli).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the Supabase URL, anonymous key, and
   server-only service-role key. Never expose the service-role key to the browser.

3. For a local Supabase project, start Supabase and apply the migration:

   ```bash
   supabase start
   npm run db:reset
   ```

4. Run the backend-enabled Next.js app:

   ```bash
   npm run dev
   ```

Phase 1 API boundaries are available under `/api/auth/session` and `/api/workspaces`. They
require an authenticated Supabase session. The dashboard uses the same server session and
workspace membership boundary: `/app` is the overview and `/app/signals` is the first functional
read/write view. Workspace and product selections are validated server-side and persisted as
secure selection cookies; a missing selection falls back to the first RLS-visible row.

## Dashboard foundation

The dashboard is intentionally small and backend-led. Its shell provides workspace/product context
and navigation for Overview, Signals, Demand, Map, Gap, Drift, Actions, Experiments, and Settings.
Only Overview and Signals are functional in this slice; the other areas are lightweight
placeholders and do not add billing or experiment UI.

Signals consume the existing provider-neutral `SignalReadModel`, preserve backend opportunity
score ordering, and return a bounded 25-result page with conservative next/previous navigation.
Supported filters map directly to existing read-model filters: intent, source, lifecycle, minimum
score, and published date range. Every card keeps its source URL (when it is a safe HTTP(S) URL),
rationale, lifecycle, and evidence-node identifiers inspectable. Save and Dismiss use the existing
authenticated signal lifecycle command; no browser-side tenant or entitlement decision is trusted.

## Phase 6 billing

Billing is backend-only. Wanterest owns the Free, Pro, and Growth plan catalog, entitlements,
usage ledger, and access decisions. Dodo is isolated behind a provider port and is used only for
checkout and payment/subscription state. The server maps four configured Dodo product references
to internal plan/interval pairs; browser requests cannot submit an arbitrary product, price, or
amount.

The available boundaries are:

- `POST /api/billing/checkout` (workspace owner only)
- `GET /api/billing/overview?workspace_id=...` (workspace member)
- `POST /api/billing/cancel` and `POST /api/billing/change-plan` (workspace owner only)
- `POST /api/billing/webhooks/dodo` (raw-body signature verification and durable inbox)

Webhook processing is separate from receipt and can be retried through the billing job contract.
Cancellation at period end keeps paid access until the provider confirms the subscription ended;
`past_due` preserves current paid access during the documented V1 grace policy. A downgrade never
deletes over-limit data: reads continue and new creation is blocked by entitlement checks.

For local/offline verification, use the deterministic fixture provider:

```bash
npm run test:phase6
npm run smoke:billing
```

Server-only configuration is listed in `.env.example`. Do not commit Dodo secrets or provider
payloads containing payment-instrument data.

## Phase 2 ingestion

Phase 2 adds a server-only, provider-neutral ingestion pipeline:

```text
SourceAdapter -> raw_source_items -> source_items -> conversations
             -> conversation_source_items -> source health / job_runs
```

The fixture adapter is deterministic and offline. It covers pagination, repeated payloads,
changed raw versions, malformed records, thread roots/replies, and exact-content deduplication.
The Hacker News adapter uses the public Firebase API with bounded requests and no live dependency
in normal tests. Both adapters write only through the server-side ingestion service.

After applying the Phase 2 migration to the linked database, regenerate types without manually
editing the generated file:

```bash
npx supabase gen types typescript --linked > src/server/db/database.types.ts
```

Replay uses stored `raw_source_items` and never calls a source adapter's discovery method. The
backend command entry points are `runFixturePipeline`, `runHackerNewsSmoke`, and `replaySource`
in `src/server/modules/ingestion/commands.ts`.

Useful checks:

```bash
npm run test:phase2
npm run smoke:fixture
```

## Bluesky source connector

Bluesky is the first real search connector after the fixture and Hacker News adapters. It uses
the public AppView endpoint `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts`; no
authentication, posting, private data, or Jetstream connection is used. Search terms belong to
the caller, requests are bounded to 20 posts, and V1 uses a safe first-page search. Public AppView
may reject cursor pagination with HTTP 403, so returned cursors are retained as diagnostics but
are not sent on follow-up requests.

Bluesky AT URIs are stable external identities. Replies use their root AT URI as the conversation
identity, while quoted posts remain their own source item and conversation. The downstream
normalization, canonicalization, provenance, and intelligence layers remain provider-neutral.

Run the bounded live smoke check with a network connection:

```bash
npm run smoke:bluesky
```

The connector accepts public provider responses only and records typed health, timeout, rate-limit,
and server-error outcomes without persisting authorization material.

## GitHub source connector

GitHub uses the official REST API at `https://api.github.com` for public issue search and bounded
issue-comment expansion. Public Discussions are supported through the official GraphQL search API
when the caller supplies a query and optional repository/owner/org qualifiers in request metadata
(`contentType: "discussions"`); GitHub may require an authenticated token for this API. Combined
discovery is bounded and does not expose a misleading shared cursor. Pull requests are filtered from issue
results. Stable issue, issue-comment, discussion, and discussion-comment identities are preserved,
along with repository, labels, state, milestone, reaction, author-type, and bot-indicator metadata.

The connector is read-only and never accesses private repositories, mutates GitHub, profiles users,
or stores authorization headers. It works without a token; an optional server-only `GITHUB_TOKEN`
raises the official API limit and may make public Discussions available. REST `Link` pagination and
GraphQL cursors are bounded and replayable through raw ingestion; transient failures are retried,
rate-limit responses are classified, and malformed provider records are skipped. Run the bounded
live smoke check with a network connection:

```bash
npm run smoke:github
```

## Reddit source connector

Reddit is implemented as the next source adapter using Reddit's official OAuth/Data API only. It
uses app-only client-credentials access against `https://oauth.reddit.com`, with credentials and a
descriptive `REDDIT_USER_AGENT` supplied only through server environment variables. The connector
supports bounded global or subreddit search, opaque `after` cursor pagination, raw payload capture,
replay, stable `t3_`/`t1_` identities, and optional bounded post-comment expansion. Deleted/removed
content and `more` placeholders are handled safely; scraping, `.json` endpoints, posting, private
profile enrichment, and user-history scoring are not supported.

The adapter is implemented and fixture-verified; live API use remains pending Reddit approval. Run
the live smoke command after credentials are approved. Without credentials it exits successfully
with a clear skip message and makes no network request:

```bash
npm run smoke:reddit
```

## Phase 4 demand intelligence

Phase 4 derives immutable, product-specific observations from qualified Phase 3 evidence, then
materializes versioned themes, 7/30/90-day demand snapshots, positioning gaps, and comparable
window drift. The fixture path is deterministic and replayable from stored observations; it does
not refetch providers. Backend read models and job contracts live under
`src/server/modules/demand-intelligence/`. No Phase 5 Actions or UI are included.

```bash
npm run test:phase4
npm run smoke:demand
```

Only public source data is supported. Provider secrets, raw authorization headers, and unredacted
provider errors are not stored in ingestion health or job records.

## Phase 7 experiments and operations

Phase 7 is backend-only. Experiments can be created only from an explicitly approved Action and
must contain exactly one control variant, structured page/target information, and weights totaling
10,000 basis points. Assignment uses `deterministic_hash_v1` over the experiment and an anonymous
subject key; raw subject identity is never stored. Public experiment tokens are scoped to one
experiment, stored only as SHA-256 hashes, and can be revoked. Exposure and outcome events are
append-only and idempotent on `(experiment_id, event_id)`. Result calculations are immutable
revision snapshots and never declare a winner without a measurement basis.

The public event boundary is `GET/POST /api/events/experiment`. It validates active lifecycle,
variant/subject consistency, bounded timestamps and payloads, and uses an atomic Postgres rate
limit bucket. `GET /api/health` exposes safe liveness/readiness state; optional providers such as
Reddit do not make readiness fail. Source controls support enabled/paused/disabled states and a
lightweight retry window. Bounded replay/backfill contracts, retention/redaction policy, structured
telemetry, job-health read models, and consistency checks are under
`src/server/modules/operations/`.

The Phase 7 migration is forward-only. The linked Supabase schema has been applied and
`src/server/db/database.types.ts` is the authoritative, regenerated schema source. Persistence
aliases in `database.helpers.ts` are direct projections of that generated type and the generated
file remains fully replaceable.

Offline verification runs the full fixture-backed path, including experiment exposure, outcome,
and result calculation:

```bash
npm run smoke:system
```

## Verification commands

```bash
npm run lint
npm run typecheck
npm test
npm run test:rls
```

`test:rls` always runs migration-contract checks. Live RLS checks run when the optional
`SUPABASE_RLS_*` variables in `.env.example` are configured.

Database workflow scripts:

```bash
npm run db:lint
npm run db:reset
```

The approved architecture and later-phase boundaries are documented in
[`docs/architecture.md`](docs/architecture.md).
