# Wanterest

Wanterest is a demand-intelligence SaaS built as a modular Next.js monolith. The backend now
contains the Phase 1 tenancy foundation, Phase 2 raw/canonical ingestion, Phase 3 product and
conversation intelligence, Phase 4 Demand Map/Gap/Drift primitives, Phase 5 evidence-backed
Actions and Digests, and Phase 6 backend billing foundations. Product/dashboard UI and Phase 7
experiments remain intentionally out of scope.

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
require an authenticated Supabase session; there is no dashboard UI yet.

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
