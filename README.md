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

## Trigger.dev orchestration

Trigger.dev orchestrates Wanterest; it does not own Wanterest business logic. The durable
`product-demand-scan` task calls the existing onboarding, source, ingestion, intelligence,
Demand Map/Gap/Drift, Actions, entitlement, and usage services. Its bounded child tasks are
`discover-product-source`, `process-product-candidates`,
`rebuild-product-demand-intelligence`, and `generate-product-actions`.

The initiating server command validates the authenticated user, workspace membership, product
access, and scan entitlement, then returns a `jobRunId` and queued status. `job_runs` remains the
idempotency and progress boundary; the `input_reference.progress` object exposes the stable stages
`queued`, `preparing_product`, `planning`, `discovering`, `processing`, `qualifying`,
`building_intelligence`, `generating_actions`, `completed`, `partial_failure`, and `failed`.
The database status remains compatible with the existing constraint: a successful run with source
warnings is stored as `succeeded` with a `complete_with_warnings` result/progress state.

Source discovery is isolated and bounded. X insufficient credits and unavailable/unconfigured
Reddit are nonfatal source warnings; successful sources continue through qualification, ranking,
intelligence rebuild, and evidence-backed Actions. Retries reuse the same job and usage
idempotency keys, while raw ingestion and immutable derived records remain replayable. The direct
service path remains available for tests, debugging, and replay and does not require Trigger.dev.

For local development, put a Trigger.dev Development API key in `.env.local` as
`TRIGGER_SECRET_KEY` (the same server-only environment key is used by the Next.js
dispatcher and local worker), then run the app and Trigger worker separately:

```bash
npm run dev
npm run trigger:dev
```

The worker uses the existing Trigger project configuration and `.env.local`; use
`TRIGGER_LOCAL_EXECUTION=direct` only for an explicit local/test direct execution path. In
production, configure the same project and server-only environment variables in the Trigger.dev
worker, deploy tasks with `npm run trigger:deploy`, and keep the Vercel request path limited to
queueing `product-demand-scan`. Do not put Trigger secrets in browser configuration.

## Website understanding, product understanding, and OpenAI

Onboarding treats the submitted public website as the primary product-understanding input. The
server-only Website Understanding v1 layer fetches the homepage and at most four high-value
same-site pages (`product`, `features`, `solutions`, `pricing`, `use cases`, `customers`,
`integrations`, `platform`, or `about`). It uses bounded HTTP(S)-only requests, DNS checks that
reject private/link-local/metadata addresses, revalidated same-site redirects, a 9-second page
timeout, a 512 KB response limit, and deterministic HTML/text extraction. It never executes page
scripts, follows external domains, or fetches from the browser.

The extracted context is compacted into the existing immutable `product_snapshots` path. Snapshot
metadata records the website URL, pages selected/fetched, extraction version, content hashes,
fetch outcome, user-description participation, and a sanitized fallback reason. The one-line
description remains supplemental context; if the homepage cannot be read, it becomes the explicit
description-fallback input and onboarding continues when possible. A persisted snapshot prevents
refreshes from fetching the same website again.

Product understanding keeps the provider-neutral `StructuredLlmProvider` boundary. When the
server-only `OPENAI_API_KEY` is present, onboarding selects the OpenAI structured-output adapter;
the default model is `gpt-4.1-mini` and can be changed with `OPENAI_MODEL`. The same `.env.local`
file is loaded by Next.js and `npm run trigger:dev`, so the Trigger worker sees the same key without
any `NEXT_PUBLIC_` variable. Prompts are bounded, temperature is zero, output is schema-guided,
and retries are limited.

Business Classification v1 and Demand Profile v2 remain normalized and persisted in immutable
product snapshot metadata. OpenAI failures are logged with provider/model/operation/latency/status
diagnostics only; a deterministic fixture result is used as an explicit, observable fallback so a
temporary provider failure does not create opaque `unknown` output. Product understanding uses the
website-derived context plus the onboarding description, and both existing engines receive that
same bounded context. Refreshes reuse the persisted snapshot/profile instead of fetching the site
or calling the model again.

## GitHub source connector

GitHub uses the official REST API at `https://api.github.com` for public issue search and bounded
issue-comment expansion. Public Discussions are supported through the official GraphQL search API
when the caller supplies a query and optional repository/owner/org qualifiers in request metadata
(`contentType: "discussions"`); GitHub may require an authenticated token for this API. Set
`GITHUB_TOKEN` in the server/Trigger worker environment to receive the higher authenticated
rate-limit bucket; without it, public API rate limits are handled as a nonfatal source warning.
Combined
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

## X source connector

X uses only the official API v2 recent-search endpoint at `https://api.x.com`. It is a
server-only, app-only bearer integration: `X_BEARER_TOKEN` is never sent to the browser, stored
in raw payloads, or logged. Queries are caller-supplied, recent searches are bounded, retweets are
excluded by default, and author data is limited to the user expansion bundled with the post search.
The adapter does not post, read private data, enrich profiles, or expand complete threads.

The default scan budget is 10 posts and one page. Provider cursors are opaque and can be requested
only with an explicit bounded page/billable-post budget; no pagination is attempted by the initial
scan. The read-cost assumption is versioned and defaults to `$0.005` per post (`X_POST_READ_COST_USD`);
the adapter records the estimate and provider cursor diagnostics without storing credentials. Rate
limits, authentication failures, forbidden access, and insufficient credits are classified separately.
Run the bounded live smoke check only when `X_BEARER_TOKEN` is configured:

```bash
npm run smoke:x
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

## Business Classification v1

Product understanding also produces a versioned, normalized Business Classification v1 record
inside the immutable product snapshot metadata. It uses the controlled primary taxonomy
`b2b_saas`, `developer_tool`, `consumer_software`, `ecommerce`, `marketplace`,
`service_business`, `local_business`, `agency`, `media_content`, and `other`.

The record also carries business model, delivery model, market scope, technical orientation,
commerce type, short category labels, customer/buyer/end-user arrays, geographic fields, and a
0..1 location-dependency score. Overall and per-dimension confidence, plus inspectable evidence
references and excerpts, are persisted with the classification. Country codes and labels are
normalized deterministically, arrays are deduplicated, and weak or invalid model output falls
back to `unknown`/`other` without inventing evidence.

Classification is `business-classification-v1`, runs from the existing product snapshot text,
and is recomputed only when the snapshot or classification engine version changes. The structured
LLM adapter is provider-neutral and treats website text as untrusted data, while the fixture
engine keeps local development and tests deterministic. Classification failure is non-blocking:
product understanding continues with an unavailable classification diagnostic. Source Routing v1
may consume the read model for deterministic source selection, while Signal Qualification remains
separate. One generic demand engine, product-type-aware discovery and qualification. Engagement
does not determine demand quality.

## Demand Profile v2

Demand Profile v2 is a compact, versioned prerequisite for product-type-aware Source Routing.
It is built from the existing product snapshot and Business Classification v1; it does not crawl
again, generate provider queries, qualify Signals, monitor competitors, or enforce new billing
limits.
The profile contains structured identity, audience, pains, desired outcomes, jobs-to-be-done,
switching triggers, buying intents, feature-demand concepts, objections, buyer language,
competitors, alternatives, comparison terms, geography, confidence, and evidence.

Competitors require explicit comparison, replacement, migration, or similar evidence. Alternatives
remain distinct and can be manual workflows, spreadsheets, internal builds, service providers,
generic tools, or the status quo. Website positioning is evidence of positioning, not proof of
market demand; current product capabilities remain separate from likely market feature demand;
engagement is not used as demand quality. Profiles are bounded and normalized, with
stable concept keys, confidence values, source references, and no invented domains. The fixture
and structured-LLM paths both treat website text as untrusted data.

The version is `demand_profile_v2`. It is stored immutably under
`product_snapshots.metadata.demand_profile_v2` and rebuilt only for a material snapshot,
Business Classification, engine-version, or explicit rescan change. A failed build leaves the
existing product and v1 profile usable. Compact routing and qualification projections feed the
deterministic Source Routing v1 planner.

## Source Routing v1

Source Routing v1 builds a recomputable, provider-neutral plan from Business Classification v1,
Demand Profile v2, source configuration, persisted source health, source controls, scan mode, and
a bounded candidate budget. It assigns controlled priorities and route reasons, separates
theoretical relevance from operational availability, and selects at most three conservative
sources for the onboarding scan. Reddit remains a valid high-relevance route when unavailable,
but is not executed; X is paid and bounded; GitHub and Hacker News are not used as local or
ecommerce substitutes; Bluesky is not promoted automatically without a fit signal.

Free does not mean relevant.

Source relevance and operational availability are separate.

The planner exposes coverage status, confidence, missing-capability diagnostics, operational
exclusions, route budgets, and a network-free dry-run formatter. If Demand Profile v2 is not
available, onboarding falls back to the existing configured-source selection. Source Routing chooses where to look. Signal Qualification decides whether what we found is actually demand.

The clean planner boundary is `buildSourceRoutingPlan(...)` in
`src/server/modules/operations/source-routing.service.ts`; it does not generate provider queries,
change connector semantics, alter Signal Qualification, or add a persistence table.

## Query Planning v1

Query Planning v1 determines what to search after Source Routing has determined where to search.
It consumes the Business Classification v1 and Demand Profile v2 projections plus the selected
Source Routing routes, and emits a deterministic `query_planning_v1` plan. Query families are
controlled: pain, alternative search, switching, recommendation, comparison, feature requirement,
JTBD, objection, desired outcome, and category discovery. Buying intents are reused rather than
invented, and structured profile concepts are capped at the top three per section.

The planner uses compact semantic templates for competitors, alternatives, pains, switching
triggers, features, JTBD, objections, outcomes, and category fallback. It deduplicates normalized
and near-identical variants, preserves family diversity, explains each query with reason codes,
and allocates positive candidate budgets whose source totals never exceed the routing budget.
Onboarding remains conservative at at most three queries per source. Discovery Depth v2 gives
manual scans a bounded twelve-query/four-source envelope when the profile supports it: X up to
four queries and eight admitted candidates, GitHub up to four queries and ten candidates, Hacker
News up to two queries and six candidates, and Bluesky up to two queries and eight candidates.
Manual routing requires modest per-source minimums (6/8/4/6 for X/GitHub/Hacker News/Bluesky)
when those sources are executable; it does not force a low-relevance source. Scheduled and deep
modes retain their smaller existing query ceilings. Low-confidence profiles receive fewer broad
queries and no competitor-specific exploration. X remains limited to one bounded page per query
and its provider minimum/cost guard; no open-ended pagination is introduced.

Query text remains provider-neutral. A small execution formatter maps semantic plans to the
existing source request port: X receives a validated, human lexical query compiled from product
and competitor context, X operators remain in the X adapter metadata, and GitHub qualifiers
remain in the GitHub adapter. Hacker News has no search endpoint, so it applies bounded lexical
product/category/competitor anchors to a recent-stories window rather than admitting an
unfiltered feed. No connector pagination contract is redesigned.
Empty results do not trigger a second wave or adaptive query mutation in v1. If planning fails,
onboarding uses the existing conservative source-query behavior. The job result stores compact
routing/query diagnostics; the full plan is reproducible and has a network-free dry-run helper.

Source Routing chooses where to look.

Query Planning chooses what to look for.

Signal Qualification decides whether what we found is actually demand.

## Signal Qualification v1

Signal Qualification v1 is the deterministic quality gate between conversation analysis/matching
and ranking. It emits a versioned `SignalQualification` result with controlled status and intent
taxonomies, normalized relevance/intent/specificity/pain/buyer/commercial/evidence/freshness/source
dimensions, risk dimensions, matched Demand Profile concepts, verified evidence spans, and a
concise explanation. The threshold set is explicit and stored with the immutable match evaluation.

Qualification uses the Demand Profile v2 projection where available and falls back to the existing
stored profile only for compatibility. Evidence spans are validated against exact source-item text
and linked through the existing relational provenance chain. A candidate must clear product,
intent/pain, specificity, evidence, noise, spam, and promotion gates before it can enter normal
ranking and Signal creation. Qualification failures fail closed and remain diagnosable; they never
silently promote a candidate.

Market Resonance is separate from demand quality. Provider-supplied likes, replies, reposts,
upvotes, reactions, and comments are source-normalized for context only. Engagement strengthens
qualified demand; engagement does not create demand. No new engagement fetches, billing unit,
table, or migration are required. Calibration fixtures cover strong demand, weak/rejected noise,
promotion, spam, duplicates, geo relevance, evidence validity, product relevance, determinism,
and fail-closed behavior.

Public domains can be analyzed. Persistent monitoring is plan-limited. Execution belongs only to
owned products. Competitors should be discovered by overlapping demand, not merely by category
labels. A future `ProductRelationship` may separate `owned`, `tracked_competitor`,
`tracked_alternative`, and `reference` from independent `unverified`, `pending`, and `verified`
ownership status; that relationship is not persisted in this scope.

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
