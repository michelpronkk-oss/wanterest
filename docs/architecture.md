# Wanterest backend architecture

Status: approved foundation; Phase 1 through Phase 7 are implemented as backend foundations.
The initial authenticated dashboard foundation is implemented under `src/app/app`; broader
dashboard workflows remain intentionally incremental.

## 1. Current repository

The repository is a clean Next.js 16.3.5 App Router starter using TypeScript, React 19,
Tailwind CSS 4, ESLint, and the React Compiler. It currently contains:

- `src/app/layout.tsx`: default root layout and Geist font setup.
- `src/app/page.tsx`: temporary authenticated entry redirect to `/app` or `/login`.
- `src/app/login/page.tsx`: minimal Supabase email/password sign-in entry point.
- `src/app/globals.css`: default Tailwind import and color variables.
- `package.json`: only Next.js/React/Tailwind/TypeScript/ESLint dependencies and the standard
  `dev`, `build`, `start`, and `lint` scripts.
- `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, and the generated static assets.
- `AGENTS.md`: the generated Next.js guidance plus the stable Wanterest rules added with this
  proposal.
- `CLAUDE.md`: delegates to `AGENTS.md`.

There is currently no database client, Supabase setup, authentication flow, schema/migration,
provider adapter, job definition, API route, domain module, or product UI. The installed
Next.js guidance confirms that this is an App Router project; future Next.js changes must
continue to follow the local `node_modules/next/dist/docs/` guidance.

## 2. Architectural decisions

### Shape

Use a modular monolith deployed as one Next.js application plus Trigger.dev durable tasks.
PostgreSQL/Supabase is the system of record. The web app handles authenticated UI and thin
route/server-action composition; domain services, repositories, and provider adapters live in
server-only modules.

### Boundaries

There are three data layers:

1. **Raw**: immutable or append-only provider responses and fetch metadata.
2. **Canonical**: provider-neutral source items and public conversations.
3. **Derived**: analyses, matches, rankings, observations, themes, maps, gaps, drift, and
   actions, always tied to engine versions and evidence.

The same public conversation is never copied once per customer. Global canonical data is
matched to many workspace products through workspace-owned match rows.

### Replaceability

Provider SDKs are confined to adapters. Domain code consumes ports for source discovery,
language-model analysis, embeddings, billing, email, clock, and task scheduling. Provider
identifiers may be stored for reconciliation, but they are not Wanterest business identifiers.

### Reproducibility

Each intelligence result references an `engine_versions` row and stores the effective model,
prompt/algorithm version, input references, confidence, and creation time. Immutable snapshots
make historical Demand Map, Gap, and Drift results explainable and replayable.

## 3. Target folder/module architecture

```text
src/
  app/
    (marketing)/                 # public pages
    (app)/                       # authenticated product UI
    api/                         # thin HTTP/webhook boundaries only
      auth/
      webhooks/dodo/               # verified Dodo webhook boundary
      billing/                     # authenticated checkout/portal routes
      health/
  components/                   # reusable UI; no server-only imports
  server/
    modules/
      auth/
      workspaces/
      products/
      demand-profile/
      sources/
      discovery/
      conversations/
      classification/
      matching/
      ranking/
      demand-intelligence/
      actions/
      experiments/
      feedback/
      digests/
      billing/
      entitlements/
      usage/
      admin/
      observability/
    application/
      jobs/                      # Trigger.dev task definitions and orchestration
      commands/                  # use-case entry points
      queries/                   # read models/use-case queries
    providers/
      source/                    # SourceAdapter port and provider adapters
      llm/                       # classifier/action model ports and adapters
      embedding/                 # optional; no-op until justified
      billing/                   # Dodo adapter only; normalized Wanterest API
      email/                     # Resend adapter
      search/                    # optional search provider port
      clock/
    db/
      repositories/              # persistence behind module interfaces
      migrations/                # or a thin wrapper around supabase/migrations
      views/
    lib/
      env.ts
      auth.ts
      errors.ts
      idempotency.ts
      logging.ts
      rate-limit.ts
      tracing.ts
  shared/
    contracts/                   # cross-boundary DTOs and serialized types
    schemas/                     # runtime validators
    types/
supabase/
  migrations/
  seed/
docs/
  architecture.md
tests/
  contracts/
  rls/
  jobs/
  modules/
```

Each module exposes a small public `index.ts` and owns its domain types, policies, commands,
queries, and repository interfaces. Persistence implementations may be shared, but modules do
not reach into another module's private tables. `src/app/api` must validate and delegate; it
must not contain business rules.

## 4. Proposed database schema

All tables have `id uuid` unless a natural/provider key is explicitly called out. Operational
tables also have `created_at`, `updated_at` where mutable, and `created_by`/`actor_type` where
auditable. Use `timestamptz` in UTC. Use `jsonb` only for provider metadata, structured
evidence, or versioned payloads with a typed boundary; query-critical fields remain columns.

### Global raw and canonical data

#### `raw_source_items`

Immutable provider payload versions. Columns include `source_key`, `external_id`,
`fetched_at`, `payload_json` or `payload_uri`, `payload_hash`, `fetch_job_run_id`,
`evidence_node_id`, and `metadata`. Unique `(source_key, external_id, payload_hash)` prevents
duplicate raw writes.
Large payloads can move to private object storage while retaining a hash and URI.

#### `source_items`

One provider-neutral source identity per `(source_key, external_id)`. Stores `canonical_url`,
`title`, `body`, `author`, `published_at`, `captured_at`, `language`, `metadata`,
`content_hash`, `latest_raw_source_item_id`, `evidence_node_id`, `normalization_version`, and
source status. This
is the canonical normalized source record and does not contain customer/product data.

#### `conversations`

One global canonical public conversation. Stores `conversation_key`, `primary_source_item_id`,
root `title`/`body`, `author`, `published_at`, `last_activity_at`, `canonical_url`, language,
metadata, content hash, `evidence_node_id`, and canonicalization version. A standalone post is
a one-message conversation.

#### `conversation_source_items`

Join table for source items that map to the same conversation, with `relation_type`,
`is_primary`, and `dedupe_evidence`. This preserves provenance and makes false-positive merges
reversible instead of deleting source records.

#### `conversation_analysis`

Global analysis of a conversation, reusable across products. Each row is immutable and keyed for
idempotency by `(conversation_id, engine_version_id, input_fingerprint)`. Stores
`evidence_node_id`, structured intent type, pain themes, desired outcomes, alternatives, buyer
language, audience signals, confidence, evidence spans, model, prompt version, status, and error
metadata. Product matching is intentionally not stored here.

#### `engine_versions`

Immutable registry of `engine_type` (classifier, matcher, ranker, map, gap, drift, action,
profile), semantic `version`, model/provider, prompt version, config hash, and release time.

#### `source_health`

One row per source adapter/environment with last success/failure, latency, rate-limit state,
degradation state, and the latest error summary. Provider secrets do not live here.

#### `billing_webhook_events`

Provider event inbox with provider, provider event ID, signature verification result, received
time, payload hash, processing state, and processed time. Unique `(provider, provider_event_id)`
is the webhook idempotency boundary.

### Workspace and product configuration

#### `workspaces`

Tenant root: name, slug, lifecycle status, created_by, and timestamps.

#### `workspace_members`

`workspace_id`, Supabase `user_id`, role (`owner`, `admin`, `member`, `viewer`), status, and
timestamps. Unique `(workspace_id, user_id)`. This is the source of truth for RLS membership.

#### `products`

Workspace-owned product/project being analyzed: name, website URL, status, and current snapshot
pointer. Unique product slug within a workspace.

#### `product_snapshots`

Immutable crawled or supplied positioning snapshot. Stores snapshot version, captured pages
(homepage, pricing, features, use cases), normalized text/metadata, content hash, source URL,
capture status, and extraction engine version. Do not overwrite a snapshot used by a prior Gap.

#### `demand_profiles`

Workspace/product-owned definition of audience, jobs, problems, outcomes, alternatives,
include/exclude terms, geography/language, and profile version. This is configuration and
should be immutable by version rather than mutated under historical results.

#### `discovery_strategies`

Workspace/product-owned source/query configuration, source adapter keys, schedule, time window,
filters, strategy version, and active status. It contains no provider-specific business logic.

### Workspace-derived intelligence

#### `product_matches`

Stable workspace/product-to-global-conversation relationship. Stores `workspace_id`,
`product_id`, `conversation_id`, `evidence_node_id`, lifecycle/current status, and optional
`current_match_evaluation_id`. Enforce one row per `(workspace_id, product_id, conversation_id)`.
This row is never versioned by replacing it for a new engine run.

#### `product_match_evaluations`

Immutable product-match evaluation rows. Stores `workspace_id`, `product_match_id`,
`match_engine_version_id`, the product/profile/snapshot input references, input fingerprint,
`evidence_node_id`, confidence, rationale, structured evidence, and `created_at`. A replay creates a new evaluation
when its inputs or engine version differ; an idempotent retry returns the existing evaluation for
the same input fingerprint. The stable match may point to the current evaluation, while all
historical evaluations remain queryable.

#### `match_rankings`

Immutable score breakdown for one `product_match_evaluation_id`: `ranking_engine_version_id`,
`semantic_relevance`, `pain_alignment`, `buyer_alignment`, `intent_strength`, `specificity`,
`freshness`, `source_quality`, and calculated `opportunity_score`. Store `evidence_node_id`,
formula/config version, and input fingerprint. A ranking never points only to the stable
`product_matches` row and never overwrites a prior ranking.

#### `signals`

Workspace/product-facing signal materialization for an opportunity. Stores the stable
`product_match_id`, the specific `product_match_evaluation_id` and `match_ranking_id` surfaced,
lifecycle/current status, and `evidence_node_id`. If a newer evaluation is promoted, the signal
pointer changes while the prior evaluation/ranking remains immutable and inspectable.

### Evidence provenance

Evidence is first-class relational data, not primarily arrays of IDs in JSON. Every traceable
source or derived result receives one `evidence_nodes` row and a typed table row retains its
`evidence_node_id`.

#### `evidence_nodes`

Evidence anchors with `id`, `node_type`, optional `workspace_id`, `entity_table`,
`entity_id`, `created_at`, and an optional content/identity hash. `node_type` is a controlled
set such as `action`, `gap`, `drift`, `demand_snapshot`, `signal`, `observation`, `match`,
`match_evaluation`, `ranking`, `conversation`, `source_item`, or `raw_source_item`. The source
entity rows and derived rows each retain a unique FK to their anchor.

#### `evidence_provenance`

Directed provenance edges with `derived_evidence_node_id`, `source_evidence_node_id`,
`relation_type`, `weight`, `ordinal`, optional structured `span` (message/source item, character
or token offsets, field, and quote hash), optional `measurement` metadata, `engine_version_id`,
and `created_at`. Both node IDs are real foreign keys. A database trigger rejects incompatible
workspace edges while allowing workspace-derived nodes to point to global source nodes.

The minimum inspectable chain is:

```text
action -> gap / drift / demand_snapshot / signal
       -> observation / match / match_evaluation
       -> conversation -> source_item -> raw_source_item
```

The relevant domain rows also keep typed foreign keys for their immediate inputs (for example,
`demand_gaps.demand_snapshot_id`, `signals.match_ranking_id`, and
`demand_observations.conversation_id`). `evidence_provenance` makes the full chain queryable,
weighted, and span-aware without overloading each table with many bespoke evidence columns.

#### `match_feedback`

Workspace/user feedback for a match: `opened`, `saved`, `dismissed`, `relevant`,
`not_relevant`, `contacted`, or `converted`, with actor, reason, and timestamp. This is later
usable for ranking evaluation and engine comparisons.

#### `demand_observations`

Workspace/product-specific evidence rows derived from matched conversations. Store
`evidence_node_id`, observation type, normalized facet/value, weights, intent, source
conversation/match, analysis/ranking engine versions, period, and evidence references. This is
the durable input to maps and trend calculations.

#### `demand_themes`

Versioned workspace/product themes with label, normalized key, description, status, and theme
engine version. Do not silently merge themes across engine versions.

#### `theme_memberships`

Joins observations to themes with membership weight, evidence, and engine version.

#### `demand_snapshots`

Immutable product/time-period map materialization: `evidence_node_id`, theme share, pain
distribution, buyer language, alternatives, desired outcomes, intent mix, sample size, source
window, and map engine version. It is computed from observations, not from a fresh giant prompt.

#### `demand_gaps`

Compares one market `demand_snapshot_id` to one `product_snapshot_id`. Stores theme, market
weight, positioning weight, gap score, interpretation, `evidence_node_id`, evidence links,
engine version, and status. The comparison inputs are immutable foreign keys.

#### `demand_drifts`

Historical comparison between two periods/snapshots. Stores theme, period start/end, current
and prior mention counts, shares, high-intent shares, deltas, significance/measurement metadata,
evidence, and drift engine version. “Trending” is calculated from stored observations, not
asked of an LLM.

Each drift row also stores an `evidence_node_id`; its provenance edges point to the compared
snapshots and their observations/matches.

### Actions, digests, experiments, feedback, and operations

#### `actions`

Workspace/product action with `evidence_node_id`, `action_type`, `trigger_type`, `trigger_id`,
suggested change, target metric, status, action engine version, and approval/completion audit
fields. An action must have provenance edges to a Map, Gap, Drift, or Signal-derived evidence
record.

#### `action_variants`

Alternative copy/offer/angle hypotheses for an action with rationale, structured content,
variant engine version, and immutable generated history. These are hypotheses, not experiments.

#### `action_feedback` and `action_events`

Feedback is append-only and preserves useful/not-useful, relevance, approval, dismissal, and
completion history. Action events preserve lifecycle transitions and actor context so derived
feedback state never replaces the underlying history.

#### `experiments`

Workspace/product experiment linked to an approved action. Stores the bounded taxonomy, hypothesis,
primary metric, structured target, deterministic assignment method, lifecycle state, sample window,
engine version, current-result pointer, and measurement metadata. The pointer is only a convenience;
historical result rows remain immutable.

#### `experiment_variants` and `experiment_assignments`

Variants are immutable action-content snapshots with one explicit control and weighted allocation.
Assignments are sticky rows keyed by the experiment and a hash of an anonymous subject key. Neither
table stores arbitrary identity or executable client content.

#### `experiment_events`

Minimal assignment and conversion-event facts: experiment, variant/control, anonymous or
hashed subject key, event name, occurred time, and dedupe key. Do not turn this into a general
analytics warehouse.

#### `experiment_results`

Immutable periodic result snapshots: per-variant assignment/exposure/conversion counts and rates,
comparison to control, sample state, primary metric, and calculation version. A future statistical
engine may add a justified winner contract; Phase 7 does not infer one.

#### `experiment_public_tokens`

Rotatable, revocable public event credentials. Only a public key and token hash are stored; the raw
credential is returned at issuance and never persisted.

#### `digests`

Workspace/product digest period, immutable evidence anchor, selected structured content/render
version, delivery status, and sent time. The stable idempotency key is
`digest:<workspace>:<product-or-workspace>:<type>:<period-start>:<period-end>:<render-version>`.

#### `digest_items`

Relational references to selected Signals, Themes, Gaps, Drifts, and Actions with positions,
reasons, and source evidence nodes. Digest composition is deterministic; delivery remains
optional and provider-neutral.

#### `billing_customers`

One workspace's normalized billing identity and provider customer reference. Business code uses
the workspace ID and internal plan codes, not Dodo product IDs.

#### `subscriptions`

Normalized Wanterest subscription: workspace, internal plan (`free`, `pro`, `growth`), interval,
status, current period, cancellation/failure state, provider subscription reference, and last
provider event. Provider references are reconciliation data only.

#### `billing_checkout_requests`

Server-side checkout idempotency boundary. It stores the internal plan/interval and resulting
provider checkout reference, but never accepts a provider product or price from a browser.

#### `plan_catalog`

Versioned internal Wanterest plan definitions. Each row has a stable `plan_code`, catalog
`version`, lifecycle status, display/pricing metadata, and effective dates. The catalog is
owned by Wanterest and may be revised independently of Dodo products or prices.

#### `plan_entitlements`

Normalized capability/limit rows for a `plan_catalog` version: `capability_key`, value type,
typed value (boolean, integer, decimal, or enum), usage window where relevant, and effective
metadata. Unique `(plan_catalog_id, capability_key)` makes the catalog deterministic.

#### `workspace_entitlements`

Materialized effective capabilities for a workspace, one row per capability and entitlement
revision. Stores `workspace_id`, `plan_catalog_id`, capability key/value, source subscription
reference, `effective_from`, `effective_to`, and revision metadata. Rows are append-only; a
partial unique constraint permits only one current row per `(workspace_id, capability_key)` where
`effective_to IS NULL`. Dodo IDs never appear in capability decisions.

The entitlement service exposes the primitives from Phase 1 onward:

- `can(workspaceId, capability)` returns whether a capability is enabled.
- `limit(workspaceId, entitlement)` returns the current numeric/enum limit.
- `consume(workspaceId, usageType)` atomically checks the applicable limit and appends a
  `usage_ledger` event, with an idempotency key for retried operations.

New workspaces initially resolve to the internal versioned Free catalog. Later billing events
only change normalized subscription/plan state and cause Wanterest to materialize a new
workspace-entitlement revision.

#### `usage_ledger`

Append-only workspace usage events such as `qualified_signal`, `source_scan`,
`action_generated`, `experiment_created`, and `export`. Monthly aggregation is derived from
this ledger; payment-provider counters are never the usage authority.

#### `job_runs`

Durable job state: job type, workspace/product scope where applicable, input reference, stable
idempotency key, Trigger.dev run ID, status, attempt count, timestamps, trace ID, error code,
redacted error details, and dispatch claim/link state. Dispatch state is separate from execution
status: a short-lived claim may be `claimed`, a provider run is `linked`, direct execution is
`not_applicable`, and proven stale/terminal dispatches become `orphaned`. Unique idempotency
keys prevent duplicate writes and provider re-dispatch uses the original key until a run is
durably linked.

#### `feature_flags`

Global flag definitions and rollout metadata. Workspace/user overrides should be a separate
scoped assignment table if needed; do not let a client choose privileged flags.

#### `audit_log`

Append-only records for membership, billing, entitlement, admin, and destructive data actions.
Include workspace scope when applicable, actor, action, target, request/trace ID, and redacted
metadata.

## 5. Relationship map

```text
workspace
  ├─ workspace_members
  ├─ products
  │   ├─ product_snapshots
  │   ├─ demand_profiles
  │   ├─ discovery_strategies
  │   ├─ product_matches ── global conversations
  │   │   └─ match_rankings / match_feedback
  │   ├─ demand_observations ── conversations / matches
  │   │   └─ theme_memberships ── demand_themes
  │   ├─ demand_snapshots
  │   ├─ demand_gaps ── demand_snapshot + product_snapshot
  │   ├─ demand_drifts ── historical demand_snapshots
  │   ├─ actions ── evidence from map/gap/drift/signals
  │   │   └─ action_variants / experiments
  │   └─ digests
  ├─ billing_customers ── subscriptions ── entitlements
  ├─ usage_ledger
  ├─ job_runs
  └─ audit_log

raw_source_items ──> source_items ──> conversations ──> conversation_analysis
        └──────────────────────────────────────────────────────────────┘
For matching, the stable `product_matches` row owns immutable
`product_match_evaluations`; each `match_rankings` row and surfaced `signals` row references a
specific evaluation. In the diagram, `entitlements` means the current
`workspace_entitlements` materialization sourced from `plan_catalog` and `plan_entitlements`.
`engine_versions` is referenced by every versioned derived result.
```

## 6. Global versus workspace-scoped data

### Global, reusable, and not customer-owned

`raw_source_items`, `source_items`, `conversations`, `conversation_source_items`,
`conversation_analysis`, `engine_versions`, `source_health`, `billing_webhook_events`,
`plan_catalog`, and `plan_entitlements` are global. `feature_flags` is global as a catalog;
scoped assignments are workspace-owned. Global source/canonical rows and workspace-derived
rows each have an `evidence_nodes` anchor; `evidence_provenance` is the shared graph joining
them.

Global tables must not contain a customer ID merely to make a query convenient. Any workspace
association belongs in a join/derived table such as `product_matches`.

### Workspace-scoped

`workspaces`, `workspace_members`, `products`, `product_snapshots`, `demand_profiles`,
`discovery_strategies`, `product_matches`, `product_match_evaluations`, `match_rankings`,
`signals`, `match_feedback`, `demand_observations`, `demand_themes`, `theme_memberships`,
`demand_snapshots`, `demand_gaps`, `demand_drifts`, `actions`, `action_variants`,
`experiments`, `experiment_variants`, `experiment_assignments`, `experiment_events`,
`experiment_results`, `experiment_public_tokens`, `source_controls`, `digests`, `billing_customers`,
`subscriptions`, `workspace_entitlements`, `usage_ledger`, and scoped `job_runs`/`audit_log`
rows are workspace-owned.

Every workspace-owned row carries `workspace_id`, even where it is derivable through product,
so RLS and partition-pruning decisions remain explicit and safe. Foreign keys must ensure the
workspace on a child matches the workspace on its parent.

### Workspace integrity at database level

Application validation is not the integrity boundary. Every workspace-owned parent exposes a
composite unique key `(workspace_id, id)`. A child that references a workspace-owned parent
also carries `workspace_id` and uses a composite FK, for example:

```text
products UNIQUE (workspace_id, id)
product_matches FOREIGN KEY (workspace_id, product_id)
  REFERENCES products (workspace_id, id)
product_match_evaluations FOREIGN KEY (workspace_id, product_match_id)
  REFERENCES product_matches (workspace_id, id)
```

Phase 1 applies the same rule to audit actor provenance: `audit_log` stores an optional
`actor_membership_id` and enforces `(workspace_id, actor_membership_id)` against
`workspace_members (workspace_id, id)`, so an audit event cannot pair a workspace with a
membership from another workspace.

The deployed Phase 1 application audit contract currently requires both `workspace_id` and
`actor_user_id`: every exposed Phase 1 audit operation is an authenticated, workspace-scoped
operation. The nullable database columns remain intentional for future global or system audit
events, but exposing those cases through the application requires a forward migration that
changes the RPC contract and its authorization rules; callers must not send `null` to the
current RPC for required arguments.

The same pattern applies to product snapshots, profiles, strategies, matches, observations,
snapshots, gaps, drifts, actions, experiments, and billing rows. Join tables use composite FKs
to both workspace-owned parents. Global parents such as `conversation_id` use ordinary FKs,
while any global-to-workspace evidence edge is checked by a database trigger: a workspace node
may point to a global node or a node in the same workspace, never to another workspace.

RLS policies remain required for tenant access, but composite foreign keys/checks make cross-workspace
references impossible even through a privileged application path or a malformed request.

## 7. Canonical contracts

These are serialized contract shapes, not implementation code. Runtime validation belongs in
`src/shared/schemas` at every provider, webhook, and HTTP boundary.

### `SourceItem`

```ts
type SourceItem = {
  id: string;
  source: {
    key: string;             // e.g. reddit, hn, stackexchange; never business logic
    externalId: string;
    externalConversationId?: string;
  };
  canonicalUrl: string | null;
  author: {
    externalId?: string;
    displayName?: string;
    profileUrl?: string;
  } | null;
  title: string | null;
  body: string;
  publishedAt: string | null;
  capturedAt: string;
  language: string | null;
  metadata: Record<string, unknown>;
  contentHash: string;
  rawSourceItemId: string;
  normalizationVersion: string;
};
```

`SourceItem` is the stable provider-neutral item. It must preserve source, external ID, URL,
author when available, title, body, publication/capture times, metadata, content hash, and a
reference to the raw payload. It contains no workspace, product, match, or ranking fields.

### `Conversation`

```ts
type Conversation = {
  id: string;
  conversationKey: string;
  sourceItemIds: string[];
  primarySourceItemId: string;
  source: string;
  externalId: string;
  canonicalUrl: string | null;
  author: SourceItem["author"];
  title: string | null;
  body: string;
  messages: Array<{
    sourceItemId: string;
    body: string;
    author: SourceItem["author"];
    publishedAt: string | null;
  }>;
  publishedAt: string | null;
  lastActivityAt: string | null;
  capturedAt: string;
  language: string | null;
  metadata: Record<string, unknown>;
  contentHash: string;
  canonicalizationVersion: string;
};
```

A single post is represented by one message. Thread/repost/duplicate relationships are
preserved through source-item IDs and dedupe evidence rather than silently discarded.

### Analysis and ranking boundary

Conversation analysis returns only general conversation facts: intent type, pain themes, desired
outcomes, alternatives, buyer language, audience signals, evidence spans, and confidence. A
separate matching contract accepts a product snapshot/profile plus an analyzed conversation and
returns product-specific match evidence. Ranking then accepts a match and returns separate
components plus formula version. No LLM call may combine analysis, product matching, and final
ranking into one untraceable result.

## 8. `SourceAdapter` contract

Every source implements the same port; downstream modules never branch on a provider name.

```ts
interface SourceAdapter {
  readonly key: string;
  readonly capabilities: {
    supportsSearch: boolean;
    supportsIncrementalCursor: boolean;
    supportsThreadExpansion: boolean;
  };

  discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage>;
  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate;
  healthCheck(): Promise<SourceHealthResult>;
}
```

The supporting contracts are:

- `SourceDiscoveryRequest`: strategy version, source-specific query parameters held behind the
  adapter, UTC window, cursor, page size, and a request/trace ID.
- `RawSourceItemEnvelope`: adapter key, provider external ID, fetched time, raw payload,
  payload hash, request metadata, and cursor context.
- `SourceDiscoveryPage`: raw envelopes, next cursor, provider rate-limit metadata, and page
  diagnostics.
- `SourceItemCandidate`: the normalized fields needed to create/update `source_items` and the
  raw payload reference. It is validated before persistence.

The adapter owns provider protocol details, parsing, and provider rate-limit interpretation. It
does not know products, workspaces, demand profiles, ranking, or entitlements. Discovery stores
the raw envelope first; normalization is replayable from that envelope. A fixture adapter must
be built before the first external adapter so jobs and contracts can be tested offline.

### Initial adapter order

Implement and test adapters in this order:

1. fixture adapter
2. Hacker News
3. Bluesky
4. Reddit
5. GitHub
6. X
7. Product Hunt, Stack Exchange, and approved review APIs
8. YouTube and GitLab
9. open-web/search adapters

This order is an implementation sequence, not a downstream domain dependency. Discovery,
normalization, deduplication, analysis, matching, ranking, and aggregation consume only the
shared contracts and must not branch on Hacker News, Bluesky, Reddit, or search behavior.

### Source Expansion v1 decision

Source Expansion v1 adds Product Hunt, Stack Exchange, Public Web, G2, and Trustpilot as
provider adapters over the existing source port. Product Hunt uses its official GraphQL API and
is disabled unless a server token and the provider's commercial-use approval are present. Stack
Exchange uses the official advanced-search API and may run anonymously with its public quota.
Public Web is intentionally a bounded explicit-URL adapter over the existing SSRF-safe website
fetcher; it does not crawl, scrape search-result pages, bypass robots/paywalls, or invent a search
provider. G2 and Trustpilot use their approved API surfaces only. G2 requires only its server API
key and resolves each product, competitor, or alternative through the official Products API;
resolved IDs are cached in product-scoped G2 discovery-strategy metadata. Trustpilot is optional;
it runs only when its API key and business identity are configured and is otherwise treated as an
unavailable source without affecting scan health.

All five adapters preserve raw payloads and source-category metadata, normalize through the same
canonical source-item contract, and leave qualification responsible for deciding whether launch
discussion, developer discussion, web pages, or reviews represent actionable demand. No new
scheduler, monitoring state, qualification threshold, or database table is introduced by this
expansion.

### Source Expansion v2 decision

Source Expansion v2 adds exactly two provider adapters over the existing source port: YouTube
Data API v3 and GitLab REST. YouTube uses only the server-side `YOUTUBE_API_KEY` with bounded
`search.list` video discovery followed by bounded `commentThreads.list` retrieval; it does not
use OAuth or private/user-specific content. GitLab uses only the server-side `GITLAB_TOKEN` with
read-only public project, project-scoped issue, and issue-discussion endpoints; it does not crawl
repositories or fetch repository contents.

Both adapters preserve provider IDs, timestamps, canonical URLs, query metadata, and source
semantics in the existing raw -> canonical pipeline. Stable provider IDs make ingestion and
canonicalization idempotent before analysis. YouTube records structured request/quota metrics;
both adapters apply bounded retries and stop on rate-limit/quota failures. Missing credentials
classify the provider as unavailable with `missing_credentials`, skip only that provider, and do
not degrade scan health or block Automatic Monitoring. Partial provider failures retain results
from other sources. No new scheduler, monitoring system, qualification pipeline, qualification
threshold, or database table is introduced by this expansion.

Phase 2 ingestion tables are global system tables, not browser-facing read models. RLS is enabled
with no `anon` or `authenticated` policies, direct browser privileges are revoked, and only the
server-side service-role repository may write or inspect raw payloads, canonical source rows,
source health, job state, and provenance. API routes and UI code must use backend commands rather
than querying these tables directly.

Replay reads stored `raw_source_items` by ID or bounded time/source filters, then runs the selected
normalization and canonicalization versions without calling adapter discovery. Raw rows are never
updated or deleted; current normalized rows may converge to newer versions, while conversation
relationships and evidence provenance preserve the reversible history.

## 9. Durable job graph

Trigger.dev tasks are the durable execution boundary. PostgreSQL uniqueness and `job_runs` are
the write/idempotency boundary. Tasks pass IDs and version/config references, not large payloads.

```text
scan-product
  └─ discover-source (fan out per adapter/strategy/window)
       └─ normalize-source-items
            └─ dedupe-conversations
                 └─ analyze-conversations (global, once per conversation/engine)
                      └─ match-product (per product/conversation/engine)
                           └─ rank-matches
                                └─ aggregate-demand
                                     ├─ calculate-demand-gap
                                     ├─ calculate-demand-drift
                                     └─ generate-actions
                                          └─ build-digest
                                               └─ send-digest

evaluate-experiment runs on measurement windows and consumes experiment_events.
reprocess-engine-version starts from stored canonical/derived inputs and fans into the
appropriate downstream step.
backfill-demand-snapshots rebuilds immutable periods from demand_observations.
```

Job rules:

- Use stable keys such as `analyze:<conversationId>:<engineVersionId>:<inputFingerprint>`,
  `match-evaluate:<productMatchId>:<matchEngineVersionId>:<inputFingerprint>`, and
  `rank:<productMatchEvaluationId>:<rankingEngineVersionId>:<inputFingerprint>`.
- Claim/write through transactions and unique constraints; a retry returns the existing result
  when the idempotency key already succeeded.
- Keep source windows and engine versions in the input record so a replay is deterministic.
- Record state transitions, attempts, latency, trace IDs, and redacted errors in `job_runs`.
- Use bounded batches and cursor pagination. Do not put an entire scan in one unbounded task.
- Send digests only after the digest row is committed and use a delivery idempotency key.

### Trigger.dev orchestration v1

Trigger.dev is the durable execution layer for the production product scan; it does not own
Wanterest business logic. The `product-demand-scan` task validates its schema, revalidates the
workspace/product context and initiating membership before execution, checks the existing scan
entitlement, and delegates to the server-only domain/application services. The task is entered by
the onboarding/manual server command and returns the existing `job_runs` identifier promptly.

The scan uses bounded child tasks for provider isolation and observability:

```text
product-demand-scan
  ├─ discover-product-source (one per selected source/query plan fragment)
  ├─ process-product-candidates (bounded analysis/matching/qualification/ranking batch)
  ├─ rebuild-product-demand-intelligence
  └─ generate-product-actions
```

Selected source discovery runs in parallel only after Source Routing and Query Planning have
excluded disabled, paused, unconfigured, or unavailable sources. Each child consumes a validated
server-built plan fragment; it never accepts provider queries directly from the browser. Source
errors are isolated, so X insufficient credits and unavailable Reddit remain warnings while
successful sources continue. Trigger retries are bounded and share the existing job, raw-ingestion,
immutable-evaluation, and usage idempotency boundaries. A scan with usable output and source
warnings remains a successful `job_runs` row with a `complete_with_warnings` result state; the
existing database status constraint is not expanded for this orchestration.

Progress is persisted in `job_runs.input_reference.progress` using stable user-facing stages:
`queued`, `preparing_product`, `planning`, `discovering`, `processing`, `qualifying`,
`building_intelligence`, `generating_actions`, `completed`, `partial_failure`, and `failed`.
The final job result records source/candidate counts, qualified and high-confidence signals,
Map/Gap/Drift and Actions updates, and redacted warnings. The direct synchronous service remains
available for tests, debug, and replay, and replay never requires Trigger.dev or provider network
calls.

Local development uses `npm run dev` plus `npm run trigger:dev`. Production requires the existing
Trigger project connection, server-only `TRIGGER_SECRET_KEY`, and `npm run trigger:deploy`; Vercel
only queues the durable task. `TRIGGER_LOCAL_EXECUTION=direct` is an explicit local/debug escape
hatch, not the production execution path.

Dispatch recovery is part of the durable scan boundary. A pending/running row is not considered
active solely because of its execution status: the claim must still be within the dispatch grace
window, its linked Trigger run must be provider-active, or direct execution must be explicitly
marked `not_applicable`. Polling and retry commands reconcile terminal/missing Trigger runs and
stale claims, mark them terminal with redacted diagnostics, and stop polling; they never delete a
job or blindly create a replacement while the existing provider run remains valid.

## 10. Dodo billing and entitlement flow

1. A workspace owner chooses an internal Wanterest plan and interval. The server checks the
   workspace role and creates a Dodo checkout through the billing port, passing only a signed or
   server-generated checkout reference plus `workspace_id`, internal plan code, and interval as
   metadata.
2. The browser return page is informational. It does not grant access.
3. Dodo sends lifecycle webhooks to `POST /api/webhooks/dodo`. The route reads the exact raw
   body, verifies the Standard Webhooks signature, durably records the event, atomically claims
   processing, and returns safely for a duplicate event. Unsupported signed events remain in the
   inbox without changing subscription state.
4. A billing application service translates provider events into normalized
   `billing_customers`/`subscriptions` state. It never stores product access rules in Dodo
   product IDs.
5. Entitlements are recalculated from the normalized Wanterest plan/status and the versioned
   `plan_catalog`/`plan_entitlements` catalog into append-only
   `workspace_entitlements` revisions. `free` is an internal plan and has no Dodo product.
6. Access checks call `can`, `limit`, and `consume` against Wanterest's entitlement/usage
   primitives, not the browser, checkout result, or provider counters.
7. Renewal, cancellation, past-due, failed-payment, and expiration events update normalized
   state and audit records. Subscription lifecycle events may retrieve the authoritative Dodo
   subscription before applying state. A scheduled reconciliation task can compare provider state without
   making the provider the product-access authority.

Initial internal catalog:

| Plan | Monthly | Yearly | Key limits/capabilities |
| --- | ---: | ---: | --- |
| Free | internal | internal | restricted trial capabilities; no Dodo product |
| Pro | $49 | $468 | 3 products, 500 monthly signals, daily scans, Map/Gap/Drift, actions, 2 experiments |
| Growth | $99 | $948 | higher limits defined in the entitlement catalog |

Prices are configuration, not hard-coded in domain decisions. Dodo remains responsible for
checkout, subscription lifecycle, renewals, cancellations, failed payments, and Merchant of
Record concerns only.

## 11. Security and RLS boundaries

- Supabase Auth identifies the user. `workspace_members` determines tenant membership and role.
- Every workspace table has RLS. The baseline policy is “allow only when the authenticated
  user has an active membership for `workspace_id`”; write policies additionally check role.
- Global canonical tables are not directly writable by a browser. Server-only ingestion and
  job paths use a restricted service role or carefully scoped security-definer functions.
- Server code must set/verify the workspace context from authenticated membership and query
  with an explicit workspace predicate even when RLS is present (defense in depth).
- Cross-tenant joins are forbidden in product-facing queries. Global conversation rows may be
  reused, but all match/observation/intelligence reads are filtered by workspace.
- Dodo, Resend, LLM, source, and Supabase service credentials are server-only. Webhook routes
  are public only for signature-verified provider delivery and have replay protection.
- Expensive scan, export, AI, and webhook paths get rate limits and bounded payload sizes.
- Log IDs, hashes, and error codes rather than raw customer content or provider secrets. Apply
  retention/redaction policies to author data and raw payloads.
- Admin/debug access uses a server-checked internal admin role and read-only diagnostic views;
  it is never inferred from a client-provided flag.

## 12. Likely scaling and data-model problems

1. **Conversation volume and duplicate discovery.** Use provider identity uniqueness, payload
   hashes, content-hash candidates, and reversible merge evidence. Do not perform expensive
   cross-source semantic dedupe on every insert.
2. **Global analysis versus product matching.** Analyze a conversation once per engine version;
   keep product-specific matches separate. This is the primary cost and storage win.
3. **JSONB becoming an undocumented schema.** Keep query-critical values as typed columns,
   validate JSON at boundaries, and version structured payloads.
4. **Theme churn.** Theme IDs are scoped to a product/profile and engine version. Historical
   snapshots remain immutable; later taxonomy changes create a new computation.
5. **Unbounded fan-out.** Batch/cursor all jobs, limit concurrency per source, and honor
   adapter rate-limit state. Trigger.dev is the durable scheduler, not a reason to create
   millions of tiny untracked rows.
6. **Raw payload growth.** Keep small payloads in Postgres, move large immutable bodies to
   private object storage, and retain hashes/URIs for replay and audit.
7. **False-positive deduplication.** Never delete the original source identity. Use a join and
   evidence so an incorrect merge can be undone.
8. **Trend noise.** Require comparable time windows, minimum sample sizes, and stored counts;
   expose uncertainty rather than labeling every small delta as drift.
9. **Billing state divergence.** Treat webhooks as an event inbox and normalized subscription
   state as the access input. Add reconciliation and audit history.
10. **Overusing vectors/LLMs.** Start with deterministic filters, full-text/trigram search,
    structured analysis, and measured component scores. Add embeddings/pgvector only after a
    benchmark shows a retrieval or matching benefit.
11. **PII and retention.** Author names/profile URLs are optional source data. Define retention,
    redaction, and deletion behavior before expanding sources.

### Immutable evaluation/current-pointer review

The same rule applies anywhere a new engine run can change a user-visible result:

- `product_matches` is the stable relationship; `product_match_evaluations` and
  `match_rankings` are immutable rows, with current pointers only for fast reads.
- `conversation_analysis` is immutable per input fingerprint and engine version; a changed
  source normalization, model, or prompt creates a new row instead of overwriting analysis.
- `product_snapshots`, `demand_profiles`, `discovery_strategies`, `demand_snapshots`,
  `demand_gaps`, and `demand_drifts` are immutable version/period computations. New calculations
  create new rows; products may keep current pointers for navigation.
- `signals` is a current user-facing projection pointing to a specific match evaluation and
  ranking. Promotion changes the pointer/status, not the historical evaluation or ranking.
- `plan_catalog`/`plan_entitlements` versions and `workspace_entitlements` revisions are
  append-only. `subscriptions` may maintain current normalized state, but provider events and
  audit rows preserve its history.
- Mutable operational state is limited to lifecycle pointers, job state, and delivery state;
  none of those overwrite an intelligence computation.

## 13. Complexity intentionally removed

- No microservices, Kafka, Redis requirement, Python worker, or custom crawler fleet.
- No general autonomous agent layer; use a small number of versioned analysis/action engines.
- No general analytics product; experiments measure only Wanterest-generated actions against a
  selected conversion event.
- No per-customer copy of public conversations or analyses.
- No opaque “match percentage” as the canonical score.
- No real-time Demand Map recomputation; use persisted observations and scheduled/materialized
  snapshots.
- No provider-specific fields in downstream domain contracts beyond adapter metadata and
  provider references needed for reconciliation.

## 14. Phased implementation plan

### Phase 0 — Architecture approval (current)

Review this document, choose the initial source adapter and deployment assumptions, and approve
the schema/module boundaries. Deliverable: an accepted architecture decision and any recorded
changes here.

### Phase 1 — Foundation and tenancy

Phase 1 is backend-only. “Create/select a workspace” means server-side use cases exposed
through authenticated server actions/API boundaries, with no product/dashboard UI.

Implement only the primitives needed by every later phase:

- server-only Supabase clients, secure environment validation, request context, typed errors,
  logging/trace IDs, and input validation;
- Supabase Auth integration and backend workspace commands/queries: create workspace, list the
  caller's memberships, select/resolve an active workspace context, invite/remove/update role,
  and authorization policies;
- migrations for `workspaces`, `workspace_members`, `plan_catalog`, `plan_entitlements`,
  `workspace_entitlements`, `usage_ledger`, `audit_log`, `engine_versions`, and the required
  composite keys/RLS policies;
- a seeded, versioned internal Free catalog and entitlement service primitives:
  `can(workspaceId, capability)`, `limit(workspaceId, entitlement)`, and
  `consume(workspaceId, usageType)`;
- repositories and module contracts for tenancy, entitlements, usage, and observability;
- transaction-safe entitlement revision materialization and usage-ledger idempotency; and
- backend contract, RLS, composite-FK, authorization, and concurrency tests.

Explicitly out of Phase 1: dashboard/product UI, Dodo integration, real source adapters,
crawling, conversation analysis, product matching, ranking, and Demand Map/Gap/Drift logic.

#### Phase 1 deliverables

1. Supabase migrations and seed data for the foundation tables, including Free catalog version
   `free` and its capability/limit rows.
2. Server-only auth/workspace module with typed commands/queries and route/server-action
   boundaries; no client-side privileged database access.
3. RLS policies plus composite `(workspace_id, id)` keys and cross-workspace composite FKs for
   every workspace-owned relationship introduced in this phase.
4. Entitlement module implementing `can`, `limit`, and atomic idempotent `consume`; current
   workspace grants are materialized in `workspace_entitlements` with append-only revisions.
5. Audit records for workspace membership and entitlement changes, plus redacted structured
   logs and trace IDs.
6. Automated tests covering the exit criteria below.

#### Phase 1 exit tests

- An authenticated user can create a workspace, list only their memberships, and resolve an
  active workspace through a backend boundary; unauthenticated and unauthorized calls fail.
- RLS prevents a member of workspace A from reading or mutating workspace B, including by
  changing a request's workspace ID.
- PostgreSQL rejects a child row whose `(workspace_id, parent_id)` does not match its parent;
  the test exercises product-owned and workspace-owned relationships directly at the database
  level.
- A new workspace receives the current internal Free catalog and exactly one current grant per
  catalog capability. No Dodo identifier is required or consulted.
- `can` and `limit` return the catalog-defined values, and a catalog version change produces a
  new `workspace_entitlements` revision without mutating the prior revision.
- `consume` appends exactly one usage event for an idempotency key, rejects over-limit usage,
  and remains correct under concurrent attempts in a transaction.
- Role checks allow owner/admin membership mutations and reject member/viewer mutations; all
  key changes produce audit rows.
- Contract/schema tests reject malformed auth/workspace/entitlement inputs, and a static/module
  boundary check prevents client imports of server-only code.

No Phase 1 exit criterion requires a dashboard or product UI.

### Phase 2 — Raw/canonical ingestion and replay

Implement the source port, fixture adapter, raw/source/conversation tables, normalization and
reversible dedupe jobs, source health, `job_runs`, and replay tooling. The adapter order is
strictly: fixture first, Hacker News first real adapter, Bluesky next, Reddit next, GitHub next, X
next, and open-web/search later. Add each real adapter only after the provider-neutral fixture/contracts
path is stable. Exit when the same input can be replayed without duplicates and downstream code
does not branch on provider identity.

The Bluesky V1 adapter uses the public AppView at `https://api.bsky.app` for the
`app.bsky.feed.searchPosts` endpoint with caller-
supplied queries, bounded first-page searches, exact local time-window filtering,
runtime-validated records, and typed timeout/rate-limit/server-error handling. Public AppView
cursor pagination has a known HTTP 403 failure mode, so `supportsIncrementalCursor` is false for
this mode: a returned cursor is retained in raw diagnostics, but additional-page discovery is
rejected rather than faking or retrying unsafe pagination. It uses AT URIs as stable external
identities, maps replies to their root URI, and keeps quote posts as independent conversations.
Thread expansion, authentication, posting, private data, and Jetstream are deliberately deferred.
The newer `app.bsky.feed.searchPostsV2` lexicon is not used: its public AppView availability and
operational response contract are not established by the current public API reference, so it is
not a safe compatibility workaround for V1's cursor behavior.
All payloads enter the existing raw-source ingestion and replay path; normalization,
canonicalization, provenance, and downstream intelligence remain provider-neutral.

The Reddit adapter is implemented after Bluesky using the official OAuth/Data API at
`https://oauth.reddit.com` and the official token endpoint at `https://www.reddit.com/api/v1/access_token`.
It accepts caller-supplied global or subreddit queries, sends bounded documented listing parameters,
preserves Reddit's opaque `after` cursor inside a Wanterest cursor envelope, and records provider rate
limit metadata. Optional post-comment expansion is bounded by maximum comments and depth; nested
comments remain in the root post conversation, while `more` placeholders are ignored. Posts and
comments preserve stable Reddit fullnames (`t3_` and `t1_`), safe canonical permalinks, deleted or
removed state, and minimal public author fields only. OAuth tokens are memory-only and never enter
raw payloads, persistence, logs, or provenance. The connector is fixture-verified and live-API
pending Reddit approval; no scraping, unofficial `.json` endpoints, posting, profile enrichment,
Jetstream, migration, or provider-specific downstream branch is introduced.

The GitHub adapter follows Reddit and uses only the official APIs. Public issue search and issue
comments use `https://api.github.com`; public Discussions and their bounded comments use the
official GraphQL `search(type: DISCUSSION)` connection with caller-supplied query and optional
repository/owner/org qualifiers. GitHub may require authenticated public API access for this
connection. REST `Link` headers and
GraphQL cursors are wrapped in source-owned cursors for single-content-type discovery; combined
issue/discussion discovery remains bounded to avoid pretending that two provider pagination
models share one cursor. Pull requests are filtered, closed issues remain evidence, and malformed
records are skipped after runtime validation. The optional server-only `GITHUB_TOKEN` is never
persisted or sent to downstream code: it only selects authenticated public API mode and improves
rate limits. Stable identities are `github:issue:<repository-id>:<number>`,
`github:issue_comment:<comment-id>`, `github:discussion:<node-id>`, and
`github:discussion_comment:<node-id>`. Repository, labels, state, milestone, reactions, and
minimal author/bot metadata are retained in normalized metadata. No private repository access,
mutation, user profiling, scraping, or GitHub-specific downstream branch is introduced.

The X adapter follows GitHub and uses only the official API v2 at `https://api.x.com`, with a
server-only app-only bearer token. Recent search is caller-driven and bounded to a default ten-post,
one-page scan; the first scan never follows a cursor. An explicit caller may request at most two
bounded pages through an opaque cursor envelope, with cost and configured scan-budget guards applied
before every request. The default versioned read-cost assumption is `$0.005` per post. Author data comes only
from the bundled `author_id` expansion; no profile history, private data, posting, scraping, or
thread expansion is supported. Retweets are excluded by default, post IDs remain stable identities,
replies use `conversation_id`, quoted posts keep their own conversation, malformed records are
skipped, and rate-limit/auth/forbidden/credit failures are typed. Raw ingestion, replay,
normalization, canonicalization, provenance, and downstream intelligence remain provider-neutral.

### Phase 3 — Product understanding, analysis, matching, ranking

Phase 3 adds the intelligence layer without introducing Demand Map, Gap, Drift, Actions,
experiments, billing, digests, or UI. The forward migration is
`20260921000000_phase3_intelligence.sql`.

The implemented pipeline is:

```text
product -> immutable product_snapshot -> immutable demand_profile
conversation -> global conversation_analysis
product + analysis -> stable product_match -> immutable match_evaluation
match_evaluation -> immutable match_ranking -> current user-facing signal
```

Products and all workspace-derived intelligence use composite workspace foreign keys and RLS.
Conversation analysis is global and service-role-only; it is reusable across products. Match
evaluations and rankings are immutable and keyed by engine/input fingerprints. Signals point to
the specific evaluation and ranking currently surfaced, while historical rows remain intact.

The initial engines are provider-neutral ports with deterministic fixture implementations for
demand profiles, conversation analysis, and product matching. Ranking is deterministic with
formula `ranker-v1` and weights: semantic relevance `.24`, pain alignment `.20`, buyer alignment
`.14`, intent strength `.18`, specificity `.10`, freshness `.08`, and source quality `.06`.
Freshness uses an exponential 30-day decay with a safe `.5` value when timestamps are missing.
Qualified signal usage consumes the Phase 1 `signals_monthly` entitlement exactly once per
workspace/match/evaluation idempotency key. Replay reuses stored canonical conversations and
creates new versioned analysis, match, and ranking rows without fetching sources again.

Exit when one product can inspect a traceable ranked signal with all component scores, feedback,
and replay history available from backend primitives and automated tests.

### Website Understanding v1

Website Understanding v1 is the bounded, server-only enrichment layer before Business
Classification v1 and Demand Profile v2. Onboarding validates a public HTTP(S) URL, then the
`WebsiteUnderstandingService` composes four small provider-neutral boundaries:
`WebsiteFetcher`, `WebsitePageExtractor`, `WebsitePageSelector`, and the service itself. The
default fetcher resolves every hostname before each request, rejects loopback/private/link-local/
metadata addresses, manually revalidates same-site redirects, accepts only HTML/XHTML/plain text,
does not execute scripts, and enforces a 9-second timeout and 512 KB per-page response limit.

The homepage is always attempted. A deterministic selector may choose at most four additional
same-site pages using product, feature, solution, pricing, use-case, customer, integration,
platform, and about signals while excluding auth, careers, legal, cookie, changelog, and archive
paths. Secondary failures are non-fatal; a homepage failure produces an explicit description
fallback. Extracted text is deduplicated and capped at 48,000 characters before it reaches the
existing structured LLM boundary. The browser never fetches the submitted URL.

The resulting compact context is persisted as the existing immutable `product_snapshots` record,
with `page_type = homepage` for a successful website capture and `page_type = manual` for the
description fallback. `metadata.website_understanding` records the extraction version, canonical
URL, fetched page summaries and content hashes, character count, user-description participation,
and a sanitized fallback reason. The snapshot `raw_text` contains labeled page excerpts and the
supplemental description; raw HTML is not passed downstream. Provenance remains attached to the
snapshot evidence node, and the existing Business Classification v1 / Demand Profile v2 outputs
remain immutable metadata derived from that snapshot. No migration or second crawler is required.

### Business Classification v1

Business Classification v1 is an intelligence-layer read model derived from the existing
immutable `product_snapshots` text and metadata. The normalized record is stored under snapshot metadata as
`business_classification`, versioned as `business-classification-v1`, and remains attached to
the immutable snapshot that produced it. A later snapshot or classification engine version
creates a new immutable snapshot record; historical classifications are never overwritten.

The controlled primary taxonomy is:

```text
b2b_saas | developer_tool | consumer_software | ecommerce | marketplace |
service_business | local_business | agency | media_content | other
```

Each classification also includes these bounded secondary dimensions:

```text
business_model: b2b | b2c | b2b2c | mixed | unknown
delivery_model: software | physical_product | digital_product | service |
                marketplace | content | mixed | unknown
market_scope: global | multi_country | country | regional | local | unknown
technical_orientation: high | medium | low | unknown
commerce_type: subscription | transactional | usage_based | service_fee |
                advertising | mixed | unknown
```

Geographic fields are `primary_country_code`, `primary_region`, `primary_city`, and a bounded
`location_dependency` score. A physical office or headquarters alone does not make a product
local; local classification requires evidence of geographic service dependency. Category labels
are short normalized strings rather than a large taxonomy. Audience arrays cover target customer
types, buyer roles, and end-user types.

The record stores overall confidence and per-dimension confidence for business type, model,
market scope, category, delivery model, technical orientation, commerce type, and audience. Each
user-facing classification field is backed by inspectable snapshot evidence entries containing
field, value, reason, source reference, optional source path, and bounded excerpt. Invalid enums
normalize to `unknown`/`other`, labels are whitespace-normalized and deduplicated, country codes
are canonicalized, confidence values are clamped to 0..1, and no evidence is fabricated when the
input is weak.

The classification engine is exposed through the existing provider-neutral
`StructuredLlmProvider`; its schema-only request explicitly treats website text as untrusted
data, not instructions. A deterministic fixture engine is used for local and automated tests.
Failure is non-blocking and produces an unavailable result rather than fake classification data.
The read model exposes business type, business model, market scope, technical orientation,
primary category, and location dependency for Source Routing and Signal Qualification decisions.
Source Routing consumes it deterministically; Signal Qualification remains a separate downstream
contract. Future manual overrides should be stored separately from computed snapshot
classifications.

One generic demand engine, product-type-aware discovery and qualification. Engagement does not
determine demand quality.

### Demand Profile v2

Demand Profile v2 is the richer, versioned product-understanding input for Source Routing and
future discovery. It is built from the existing immutable product snapshot, structured website
understanding, optional future user hints, and Business Classification v1. It does not introduce
another crawler, source adapter, provider query planner, Signal Qualification rule, competitor
monitor, domain verification, or billing entitlement.

The schema contains:

```text
identity, audience, problems, desired_outcomes, jobs_to_be_done,
switching_triggers, buying_intents, feature_demands, objections, language,
competitors, alternatives, comparison_terms, geography, confidence, evidence, version
```

Identity dimensions are inherited from Business Classification v1 when available: business type,
business model, delivery model, technical orientation, market scope, primary category, and
secondary categories. High-confidence classification is authoritative; absent classification
falls back to explicit `other`/`unknown` values without a second independent classifier.
Audience includes target customer types, buyer roles, end users, company-size segments, and
industry segments. Pains, outcomes, JTBD, switching triggers, feature demands, objections,
competitors, and alternatives are structured concepts with stable normalized keys, bounded arrays,
confidence, and evidence. Buying intents use a controlled taxonomy and describe discovery
relevance, not claims that current users expressed that intent.

Competitor and alternative semantics are intentionally separate. A known competitor requires
explicit comparison, replacement, migration, or related evidence; integration partners, customer
logos, broad category matches, and footer links are not competitors by themselves. Alternatives
include manual workflows, spreadsheets, internal builds, service providers, generic tools, and
the status quo. Domains are preserved only when supplied and valid; they are never invented.
The compact language model preserves category, pain, outcome, switching, comparison,
recommendation, and feature phrasing rather than generating an SEO keyword dump.

The profile also preserves the distinction between current product capabilities and likely
market-demand feature concepts. Website positioning may support the former, but it is not proof
that users demand the latter.

The geographic section inherits market scope, country, region, city, and location dependency from
Business Classification and adds only evidence-supported demand geography terms. Overall and
section-level confidence are bounded to 0..1. Every important derived concept carries evidence
with source type, reference, field path, excerpt, reason, and confidence. Website text is data,
not instructions, and the structured LLM boundary explicitly defends that rule.

Version `demand_profile_v2` is stored immutably under
`product_snapshots.metadata.demand_profile_v2`; no new table or column is required. Repeated
same-version builds reuse the existing snapshot, while a new snapshot or engine identity creates
a new immutable result. Build failures are diagnostic and non-blocking, so existing v1 profile
behavior remains available. Lightweight diagnostics record version, success/failure, confidence,
and concept counts without logging crawled text.

The routing projection exposes business type, model, delivery, market scope, technical orientation,
category, audience, pains, JTBD, switching triggers, buying intents, feature demands, competitors,
alternatives, comparison terms, location dependency, and profile confidence. The qualification
projection exposes relevant pains, outcomes, intents, JTBD, features, buyer roles, competitors,
alternatives, and geography. These projections remain separate contracts: Source Routing decides
where to look, while Signal Qualification decides whether what was found is actually demand.

### Plan Entitlements + Source Budget Matrix v1

Wanterest resolves billing state into one provider-independent internal plan:
free, pro, or growth. Billing cadence remains metadata (monthly or annual) and never creates
a second capability set. A missing or inactive paid subscription resolves to Free. The
authoritative runtime contract is plan-capabilities.ts; normalized plan_catalog,
plan_entitlements, and workspace_entitlements remain the database materialization used by
atomic limits and usage RPCs.

The plan contract owns product count, monitoring cadence, deep-discovery cadence, manual scan
allowance, Drift history visibility, active experiment count, seats, explicit scan profiles
(onboarding, manual_standard, manual_deep, monitoring, scheduled_deep_discovery), and global
source/query/candidate/LLM budgets. Provider adapters do not contain plan conditionals.
Provider guardrails (including X spend caps and YouTube quota/comment caps) are selected by
the same capability layer and applied before adapter execution.

Monitoring uses the current plan on every scheduling and execution boundary. Deterministic
rotation uses the durable scan idempotency/slot key to order secondary sources, while
high-fit sources remain preferred and unhealthy sources are deprioritized. Manual scan usage
is recorded through the existing idempotent source_scan ledger event with a manual_standard or
manual_deep profile; onboarding and monitoring do not consume that allowance. Product
creation, experiment creation, and membership RPCs enforce their materialized limits
server-side. Downgrades preserve data and historical experiments but stop new work above the
new plan; Drift visibility is restricted without deleting stored observations.

### Source Routing v1

Source Routing v1 is a deterministic, provider-neutral orchestration layer. It consumes Business
Classification v1, the Demand Profile v2 routing projection, source configuration, persisted source
health, source controls, scan mode, and a bounded candidate budget. The output is a recomputable
`source_routing_v1` plan with classification/profile versions, route priorities, relevance,
confidence, reason codes, cost class, health and availability status, per-source candidate/page
caps, selected budget weights, coverage status, and missing-capability diagnostics. No new table
is required; onboarding stores a compact routing summary in its existing job result.

Provider-neutral capability profiles are centralized for the source set (Hacker News, Bluesky,
Reddit, GitHub, GitLab, X, YouTube, Product Hunt, Stack Exchange, Public Web, G2, and Trustpilot, plus the fixture
adapter). They describe software, consumer, developer, ecommerce, local, switching,
recommendation, problem, feature, comparison, long-form, reply, and recency fit, as well as cost
class. Business type and structured intent modifiers are bounded and deterministic; raw website
keyword matching is not used to score routes.

Source relevance and operational availability are separate. A relevant but unconfigured, paused,
disabled, or blocked source remains visible as an operational exclusion and contributes to
coverage diagnostics without receiving a discovery budget. Free does not mean relevant. Paid
sources are cost-weighted and bounded, and X remains within its provider safety cap.

Onboarding selects no more than three executable routes, with stable tie-breaking and minimum
candidate allocations. If Demand Profile v2 is unavailable, the current configured-source
selection remains the conservative fallback. The planner has a network-free dry-run formatter and
does not change provider pagination, query generation, normalization, canonicalization, matching,
ranking, or Signal Qualification semantics. Source Routing chooses where to look. Signal Qualification decides whether what we found is actually demand.

### Query Planning v1

Query Planning v1 is a deterministic, provider-neutral discovery layer after Source Routing. It
consumes the Business Classification v1 and Demand Profile v2 projections, selected routing plans,
scan mode, and route candidate budgets. Its `query_planning_v1` output contains source plans,
controlled query families, reused buying intents, semantic query text, concept/competitor/
alternative references, confidence, priorities, reason codes, geographic context, cost hints,
per-query candidate budgets, and compact diagnostics. It is reproducible from its inputs and does
not require a query-plan table.

The controlled family taxonomy is `pain`, `alternative_search`, `switching`, `recommendation`,
`comparison`, `feature_requirement`, `jtbd`, `objection`, `desired_outcome`, and
`category_discovery`. Templates consume only bounded structured concepts: top pains, switching
triggers, buying intents, features, competitors, alternatives, JTBD, objections, and outcomes.
Known competitors are preferred; detected candidates require high confidence; integration partners
and customer logos are never promoted. Manual processes, internal builds, service providers, and
generic tools receive distinct natural-language alternatives rather than brand-style templates.

Scores combine commercial intent weighting, concept confidence, profile confidence, source
capability fit, route priority, and uniqueness. No engagement or Signal score is used. Exact and
near-identical normalized queries are suppressed, then family-diverse candidates are selected.
Onboarding caps each source at three queries and remains conservative. Discovery Depth v2 gives
manual scans a bounded twelve-query/four-source envelope when enough distinct demand concepts and
executable routes exist: X up to four queries/eight candidates, GitHub four/ten, Hacker News
two/six, and Bluesky two/eight. Manual routing uses source minimums of 6/8/4/6 for
X/GitHub/Hacker News/Bluesky but does not force a low-relevance or unavailable source. Per-query
budgets are positive and sum no higher than the route candidate budget. X remains limited to one
bounded page per query with an explicit provider-minimum cost guard; no open-ended pagination is
introduced. Scheduled and deep modes retain their smaller existing query ceilings; low-confidence
profiles get fewer broad queries and no competitor-specific exploration.
Local geography is added only for local/high-dependency profiles; global SaaS does not receive
invented geo terms.

The planner emits semantic queries only. The execution bridge adapts them to the existing source
request port: X compiles each selected semantic family into a bounded human query from product,
competitor, alternative, pain, and category context, validates it before HTTP, and retains any
fallback reason as sanitized diagnostics; X operators remain in the provider layer. GitHub retains
issue/discussion qualifiers in its adapter, Reddit receives natural-language demand queries,
Bluesky remains short and bounded, Hacker News applies bounded lexical product/category/
competitor anchors to a recent-stories window because HN search is not supported, Product Hunt
uses bounded recent posts plus comments, Stack Exchange uses advanced search, G2 resolves
product/business targets before fetching reviews, and Trustpilot uses its business identity at the
server boundary. YouTube turns a small set of high-value semantic queries into a bounded video
shortlist and comment retrieval, while GitLab searches public projects before bounded issue and
discussion expansion. Public Web requires explicit
URLs from an approved discovery provider. Empty results do not trigger adaptive second-wave
search. If Query Planning fails, onboarding falls back to its existing conservative query
behavior. Source Routing chooses where to look. Query Planning chooses what to look for. Signal
Qualification decides whether what we found is actually demand.

### Signal Qualification v1

Signal Qualification v1 is a deterministic, versioned gate after conversation analysis and product
matching and before normal ranking/Signal materialization. Its typed result records status, primary
intent, normalized quality/risk dimensions, matched Demand Profile concepts, exact evidence spans,
controlled reason codes, a concise explanation, Market Resonance, and qualification diagnostics.
The explicit threshold set is `signal_qualification_thresholds_v1`; the planner version is
`signal_qualification_v1`.

The hard gate requires product relevance, demand intent or strong pain/intent, specificity,
validated evidence, low noise, low spam, and low promotion probability. High-confidence Signals
use stricter relevance, intent, specificity, evidence, commercial-relevance, confidence, and
noise thresholds plus a strong commercial intent. Qualification is persisted inside the existing
immutable product-match evaluation evidence JSON, with structured provenance links to exact
source-item spans; no new table or migration is required.

Market Resonance is intentionally separate. Existing provider metrics are normalized per source
and retained as contextual diagnostics only. Engagement strengthens qualified demand; engagement
does not create demand. Generic viral content therefore cannot qualify from popularity, while
specific low-engagement switching or feature demand can qualify. Promotion, affiliate/giveaway
spam, bot-like repetition, news-only content, memes, link-only content, duplicate reposts, and
vague replies are rejected or kept weak. Qualification errors fail closed, preserve diagnostics,
and do not crash the scan.

Ranking remains the ordering layer for qualified candidates, and Signal lifecycle/feedback remains
unchanged. Qualification can be replayed from stored canonical content, analysis, match, and
profile inputs without provider calls. A network-free calibration formatter is represented by the
typed result and fixtures; a labeling UI and adaptive learning system are intentionally deferred.

Public domains can be analyzed. Persistent monitoring is plan-limited. Execution belongs only to
owned products. Competitors should be discovered by overlapping demand, not merely by category
labels. A future ProductRelationship will keep ownership/monitoring relationship types separate
from independent verification status; persistent relationship storage is intentionally deferred.

### Phase 4 — Demand Map, Gap, and Drift

Phase 4 is backend-only and is implemented by the forward migration
`20260922000000_phase4_demand_intelligence.sql`. It adds:

- immutable, product-specific `demand_observations` derived from qualified Phase 3 evaluations,
  analyses, signals, conversations, and source items. Raw facet phrases are retained alongside
  conservative normalized values, typed observation kinds, weights, confidence, source keys,
  and engine/input fingerprints;
- versioned `demand_themes` and immutable `theme_memberships`. The fixture engine is
  deterministic (`fixture-theme-v1`) and maps known facets to a small taxonomy while preserving
  an explicit `unclassified` bucket;
- immutable `demand_snapshots` for 7-, 30-, and 90-day windows, with relational theme, phrase,
  alternative, and intent detail rows. Theme share is the number of unique conversations mentioning
  a theme divided by unique conversations with an observation; multi-theme shares may therefore
  sum above one. Sample size, source mix, confidence, and warnings are stored with the snapshot;
- immutable `demand_gaps`, calculated from market share, high-intent share, current product
  positioning, and sample quality. The deterministic formula is
  `marketWeight * (1 - positioningWeight) * (0.5 + 0.5 * highIntentShare) * sampleFactor`,
  where sample factors are `.25/.5/.8/1` for insufficient/low/normal/high confidence;
- immutable `demand_drifts` plus phrase and alternative drift details. Drift compares equal-length
  windows, uses smoothed growth `(current - previous) / (previous + 1)`, and reports
  `insufficient_data` below five conversations rather than treating tiny samples as meaningful.

Every Phase 4 derived row has a relational evidence node. Provenance links preserve the chains
`map → observation → signal/evaluation → analysis → conversation → source item → raw source`
and `gap → demand snapshot + product snapshot + demand profile`; drift links both comparable
snapshots. Structured spans, weights, and measurement metadata are kept on provenance/detail rows.
The job types are `aggregate-demand`, `calculate-demand-gap`, `calculate-demand-drift`, and
`backfill-demand-snapshots`. Replays use stored observations and snapshots only; they never refetch
providers. Read models are exposed through backend module contracts `getDemandMap`,
`getDemandGap`, and `getDemandDrift`. No Actions, experiments, billing, or UI are part of Phase 4.

The Phase 4 implementation includes deterministic in-memory fixtures and automated migration,
provenance, aggregation, positioning-gap, drift, and sample-uncertainty tests. The migration
keeps derived tables service-role writable and member-readable through RLS, uses composite
workspace foreign keys for every workspace-owned relationship, and protects all historical rows
with immutable triggers.

### Phase 5 — Actions, variants, digests, usage, and feedback loop

Phase 5 is backend-only and is implemented by the forward migration
`20260923000000_phase5_actions_digests.sql`. It adds:

- controlled, evidence-backed Action candidates from qualified Demand Gaps, rising notable
  Demand Drifts, Demand Snapshots, and high-value Signals;
- deterministic candidate thresholds and bounded priority formula `action-priority-v1`;
- immutable structured Action Variants, explicit lifecycle transitions, append-only feedback,
  transition events, replay/regeneration under newer engine versions, and duplicate prevention;
- idempotent `action_generated` usage consumption only for newly persisted user-visible Actions,
  with `actions_enabled` enforced through the entitlement port;
- deterministic daily/weekly Digest materialization with relational `digest_items`, sample
  warnings, stale/dismissed Action exclusion, and period/render idempotency;
- backend read models for Action detail/list and Digest detail/list, plus `generate-actions` and
  `build-digest` job contracts. No delivery provider is required in this phase.

Every Action requires a validated trigger evidence node and provenance edges to its trigger and
supporting evidence. Variants link to their Action; Digests link to selected intelligence through
relational items and provenance. The implementation deliberately contains no experiments,
assignment/conversion tracking, autonomous execution, billing, or UI.

The linked Supabase types are now authoritative for Phase 4 and Phase 5. All persistence aliases
are derived in `database.helpers.ts`; `database.types.ts` remains generated and replaceable.
Exit when Action generation, no-Action thresholds, deduplication, lifecycle, variants, feedback,
usage, digest materialization, replay, provenance, RLS, migration contracts, and smoke tests pass.

### Phase 6 — Billing and entitlements

Phase 6 is backend-only. Dodo is the payment/Merchant-of-Record provider; Wanterest owns internal
plans, catalog versions, entitlements, usage, and access decisions. The provider boundary is
`src/server/providers/billing/`, while normalized persistence and commands live under
`src/server/modules/billing/`.

The four configured Dodo product references map centrally to `pro|growth` and `monthly|annual`.
Domain code never branches on a Dodo product ID. Free is internal-only and has no Dodo product.
Checkout accepts only a validated internal plan and interval, requires an owner, attaches trusted
metadata, and uses a server-generated checkout reference as both the Wanterest idempotency key and
the Dodo idempotency key. A browser return is informational and cannot grant access.

The Dodo route reads the raw request body, verifies the Standard Webhooks headers
(`webhook-id`, `webhook-timestamp`, `webhook-signature`) within a bounded replay window, redacts
payment-instrument fields, and records the verified payload in `billing_webhook_events`. The
unique `(provider, provider_event_id)` constraint is the durable inbox boundary. Processing is
retryable and can be re-run from the stored validated payload.

Provider states are normalized to `trialing`, `active`, `past_due`, `canceling`, `canceled`,
`expired`, or `incomplete`. `active`, `trialing`, and `canceling` resolve to the provider-mapped
internal paid plan. `canceling` keeps the current paid entitlement until the period ends.
`past_due` preserves the current paid entitlement during the conservative V1 grace policy.
`canceled`, `expired`, and `incomplete` resolve a new Free entitlement revision. Previous
`workspace_entitlements` revisions are retained; current access is resolved from the latest
materialized revision, never from a browser redirect or a Dodo counter.

Upgrades and downgrades take effect only after a verified provider state. Downgrades never delete
products, members, or other customer data. Existing over-limit resources remain readable, while
new creation is blocked by the existing entitlement primitives until the workspace is below the
new limit. Usage remains in `usage_ledger`; a plan change never resets usage.

`process-billing-webhook` and `reconcile-billing-subscription` are bounded job contracts. Manual
reconciliation fetches provider state, ignores stale provider timestamps, applies a valid newer
state, and records an audit correction. Provider outages leave existing entitlements unchanged and
make webhook processing retryable. Billing mutations and webhook tables are service-role-only;
authenticated users can read only their own workspace's normalized billing read model.

The deterministic `FixtureBillingProvider` covers checkout, activation, renewal, cancellation,
past-due, upgrade, downgrade, duplicate, out-of-order, and failed-request behavior. No billing UI,
metered billing, tax logic, card storage, or Phase 7 experiments are included.

### Phase 7 — Experiments and operational hardening

Phase 7 is backend-only. An experiment is a controlled measurement attached to one approved
Action, product, and workspace. The lifecycle is `draft -> ready -> running -> paused ->
completed` with cancellation from non-terminal states; database and service transition guards
reject shortcuts such as `draft -> completed`. The supported taxonomy is intentionally bounded to
messaging, CTA, landing-page, positioning, offer, and onboarding tests. Action-to-experiment
compatibility is explicit and conservative.

`experiment_variants` are immutable snapshots. Exactly one control is required before `ready`,
weights must total 10,000 basis points, and targeting is structured (`target_page_path`,
`target_key`, and JSON content) with no arbitrary JavaScript. `assignment_method` is the versioned
`deterministic_hash_v1` contract. Assignment stores only a SHA-256 digest of an anonymous subject
key, is sticky on `(experiment_id, subject_key_hash)`, and is rejected after completion/cancel.

Public event ingestion is scoped by a rotatable, revocable experiment token whose hash is stored;
the raw token is returned only at issuance. Events accept only the bounded exposure and conversion
types, enforce assignment/variant/subject consistency, timestamp and payload limits, and are
idempotent on `(experiment_id, external_event_id)`. The API never trusts a client-supplied
workspace. An atomic Postgres rate-limit bucket protects the public endpoint.

Results are immutable `experiment_results` revisions. Each snapshot contains assignment count,
unique exposed subjects, unique converting subjects, conversion rate, sample count, the primary
metric, calculation version, and a state of `insufficient_data`, `collecting`, `directional`, or
`completed`. The V1 evaluator records no winner unless a future statistical contract is added.
Completed experiments preserve assignments, events, variants, provenance, and result history but
accept no new assignments or events. Experiment creation consumes the normalized internal
`experiments_max` entitlement; downgrades preserve existing data and block only new over-limit
creation.

Operational Phase 7 adds source controls (`enabled`, `paused`, `disabled`) with a retry window,
job-health read models for recent/failed/stuck runs, bounded replay/backfill command contracts,
terminal failure support, structured telemetry with correlation IDs, redaction and retention
classes, ingestion/demand consistency helpers, billing reconciliation read-model helpers, and
safe `GET /api/health` liveness/readiness output. Reddit remains optional and non-blocking for
readiness. The system fixture smoke is offline and covers workspace/product, fixture raw and
canonical evidence, analysis/match/rank/signal/demand/action derivations, experiment assignment,
exposure, outcome, and result calculation.

The forward migration is `supabase/migrations/20260925000000_phase7_experiments_operations.sql`.
The linked schema has been applied and `src/server/db/database.types.ts` is the only database schema
source of truth. Phase 7 persistence aliases in `database.helpers.ts` are direct projections of the
generated type; the generated file remains immutable and replaceable. The initial dashboard
foundation is a thin authenticated App Router layer under `src/app/app`: it resolves workspace and
product context only from RLS-visible server queries, stores validated selection hints in secure
cookies, and keeps the browser on serialized read models plus server actions. `/app` is the
overview and `/app/signals` is the first functional view. Signals use the existing scored read
model, a bounded server-side page, safe source links, evidence-node details, and the existing
lifecycle RPC for Save/Dismiss. Demand, Map, Gap, Drift, Actions, Experiments, and Settings are
navigation placeholders until their dedicated read/write dashboard contracts are designed. Billing
remains backend-only; no new source adapter, autonomous external Action execution, or Phase 8
analytics platform is included.

Production procedures are documented in [`docs/runbooks/production.md`](runbooks/production.md).

### Automatic Monitoring v1

Automatic Monitoring v1 is the launch control plane for recurring product intelligence. It is
policy-driven: the internal `plan_catalog` -> `plan_entitlements` -> current
`workspace_entitlements` chain resolves cadence, source/query/candidate budgets, manual-refresh
cooldown, paid-source limits, Drift history, digest access, and Growth priority-alert access.
Dodo may change normalized subscription state, but never defines these capabilities.

There is one durable `monitoring_schedules` row per workspace/product. It stores the current
policy snapshot, cycle/deep-refresh due timestamps, last outcomes, X daily cost aggregate, the
latest job reference, and a short lease. The service-role-only
`claim_monitoring_schedule` function atomically claims a due row, so concurrent Trigger ticks
cannot dispatch the same slot. The recurring `automatic-monitoring-scheduler` task is thin: it
ensures active products have schedules, resolves current policy, claims due rows, and dispatches
the existing `product-demand-scan` workflow with explicit `monitoring` mode for bounded light
cycles and `deep_refresh` mode for the optional deeper refresh hook. The older
`intelligence_cycle`/`scheduled` values remain accepted as compatibility aliases for persisted
jobs, but new scheduler dispatches use `monitoring` so onboarding, manual refresh, and recurring
monitoring remain visibly distinct in the durable job record.
The existing durable `job_runs`, dispatch idempotency, product concurrency, and recovery logic
remain the execution boundary. A second queue is not introduced.

Pro runs four bounded intelligence cycles per day at approximately six-hour intervals and one
deterministically jittered deep refresh per week. Growth runs twelve cycles per day at
approximately two-hour intervals and three deep refreshes per week. Cycle and deep budgets are
explicit entitlement values, including X request/post caps and a soft daily X cost ceiling.
Paid-source exhaustion produces partial coverage and a persisted warning; it does not weaken
qualification or fail unrelated sources. Plan changes recompute the policy snapshot and future
cadence. Downgrades disable newly unavailable work while retaining historical intelligence; failed
dispatched runs record an error state and exponential retry backoff on the product schedule.
Archived products are disabled and never scheduled.

Manual refresh remains durable but is a bounded, cooldown-aware fallback. Drift requests are
server-enforced against the current plan window while older snapshots remain stored. Digest rows
and `digest_deliveries` provide idempotent pending/sent/failed delivery state with safe retries;
the server-only email adapter is disabled unless its provider configuration is present. Growth
priority conditions create idempotent `monitoring_alerts` rows with persistent delivery status;
there are no realtime sockets, arbitrary alert rules, public API, webhooks, MCP, or adaptive
follow-up engine in this version.

The forward migrations are `supabase/migrations/20261002000000_automatic_monitoring_v1.sql` and
`supabase/migrations/20261003000000_automatic_monitoring_state_v1.sql`.
Monitoring tables are member-readable and service-role writable under RLS, and all workspace
relationships use the existing composite-tenant integrity pattern. Trigger task definitions,
policy resolution, schedule repositories, notification delivery, and the dashboard status
read-model are covered by module, migration-contract, system, and Trigger configuration tests.

### Geo Intelligence v1

Geo Intelligence is a read-only, qualified-demand projection. It is not visitor analytics,
IP geolocation, person tracking, or a lead/outreach system. During source normalization,
deterministic enrichment stores a bounded `geo` object in the existing `source_items.metadata`
record. The object contains country, optional region/city, confidence, evidence type, and an
internal raw location string. Raw location strings never cross the public read-model boundary.

The resolver is local and static: it supports explicit ISO country codes/names, conservative
country aliases, selected region aliases, and well-known city aliases. Ambiguous or vague values
remain unknown/low confidence. High and medium evidence may drive market totals; low and unknown
evidence is retained for coverage accounting but never drives a market claim. YouTube comments and
Hacker News items remain unknown unless a provider explicitly supplies reliable public location
metadata. Geo enrichment is optional and cannot weaken or reject an otherwise valid signal.

`GeographyService` aggregates existing qualified `demand_observations`, bulk-loads their
conversation/source/analysis context through the existing intelligence repository port, and
returns only country-level market summaries, deterministic facets, representative signal
summaries, and sample-guarded trend values. Current, previous-equivalent periods are compared
only when the central plan capability grants history and a minimum baseline exists. Free retains a
current snapshot/top-market projection; Pro and Growth receive 30/90-day history respectively.
The `/app/insights/geography` route is a fifth Insights tab and uses an inline lightweight SVG
2D map with keyboard-accessible country controls, table values, tooltips, and a responsive drawer.
No paid geocoder, GIS service, 3D globe, or separate geo table is introduced.

### Geo Intelligence v1.1 — Regional Drilldown

Regional Drilldown extends the same `source_items.metadata.geo` projection. Region identifiers are
normalized to ISO 3166-2-style codes such as `US-CA`, `CA-ON`, `DE-BY`, and `NL-NH`; legacy local
codes are normalized on read. The server read model has an explicit `world -> country -> region`
selection, validated URL state, server-side filters, breadcrumbs, parent-market shares, regional
coverage, and sample-guarded representative signals. Country totals include direct country evidence
and reliable region-resolved evidence; a region total includes only evidence resolved to that exact
region.

Regional claims activate only when at least five high/medium-confidence region-resolved signals exist
for the selected country. Regions below that threshold remain neutral and cannot be selected; 5–14
signals are marked emerging, 15–29 directional, and 30+ higher confidence. Low/unknown evidence
never fills a region. The resolver handles the highest-value US, Canada, Germany, Netherlands, UK,
France, and Australia subdivisions conservatively, with explicit ambiguity protection for codes and
names such as CA, GA, WA, Victoria, Georgia, and London.

World geometry remains in the initial bundle. Country subdivision geometry is a small, simplified,
display-only pack under `src/components/dashboard/geo-geometry/regions`, loaded by dynamic import
only after a country is selected. The pack is keyed to canonical administrative identifiers and is
not used for inference, coordinates, navigation, or person tracking. Unsupported countries retain
the accessible regional table and a clear unavailable state. Pro and Growth expose regional
drilldown with 30/90-day history through central geography capabilities; Free retains the current
country snapshot and sees a restrained upgrade state. No migration, paid map API, GIS dependency,
city visualization, or 3D globe is introduced.

No phase should silently expand into a general analytics platform, source crawler, or provider-
specific domain model. Revisit this architecture when a measured requirement justifies a new
boundary.

### Paywalls + Upgrade UX v1

Paywalls are a projection of the existing entitlement authority, not a second pricing or
authorization model. The flow remains Dodo provider state -> normalized subscription -> internal
plan -> `PlanCapabilities`/`workspace_entitlements` -> server enforcement -> UI capability
projection. Client plan selection never mutates entitlements; only the verified webhook changes
persisted billing state.

Browser checkout requests contain only the canonical internal plan and cadence (plus an
application idempotency key). The server resolves the active workspace, owner authorization, and
configured Dodo product mapping. Paid workspaces are directed to the Dodo customer portal rather
than receiving a second checkout session. Checkout returns use a bounded billing-state poll, and
the webhook route invalidates the authenticated dashboard layout after durable processing.

The shared upgrade surface is used by settings and contextual capability gates for monitoring,
Drift, Geo, experiments, product limits, manual scan limits, and seats. Public API errors expose
only allow-listed entitlement metadata (`capability`, `current`, `limit`, `upgradeTarget`, and
safe plan/reason codes); provider diagnostics remain server-only. Manual scans have a distinct
`manual_scan` usage ledger type so recurring monitoring scans do not consume the user-facing
monthly manual-scan allowance. The associated forward migration is
`supabase/migrations/20261005000000_paywall_usage_contract_v1.sql`.

## 15. 1B Continuous Intelligence (Stage 2)

Stage 2 moves Wanterest from "scan, then read" to "maintain public market intelligence, then match
products incrementally". The frozen quality stack (query_planning_v7, Retrieval Precision V1,
Source Health V1, candidate_selection_v3 with maxEvaluations 15, signal_qualification_v1_7 and
thresholds v1, semantic_reasoning_router_v1, provider adapters, X Signal Yield experiment) is
reused unchanged by every stage below.

| Stage | Seam | Status |
| --- | --- | --- |
| 2A | `ingestPublicPartition` is the only provider -> raw -> normalized -> canonical loop; tenant context is operational only. | PRODUCTION_PROVEN |
| 2B | `market_partitions`: immutable, tenant-free identity per literal retrieval spec; `query_yield_artifacts.market_partition_key` records which product queries map to which partition. | PRODUCTION_PROVEN |
| 2C | `market_partition_refresh_state` + `refresh-market-partition` / `market-partition-refresh-scheduler` (flag `MARKET_PARTITION_REFRESH_ENABLED`); GitHub + Stack Exchange only, 24h + deterministic jitter, lease/claim RPC, job-run idempotency per due slot. | PRODUCTION_PROVEN |
| 2D | Incremental product matching (below). | PRODUCTION_PROVEN (flag on) |
| 2E | Read-first freshness v2: evidence vs interpretation freshness (below). | PRODUCTION_PROVEN (read-model values; UI render pending a signed-in view) |
| 2F | Adaptive cadence `market_partition_cadence_v2` with hard per-source daily caps (below). | PRODUCTION_PROVEN |
| 2G | Demand clustering / strengthening `demand_clustering_v1` + `demand_cluster_strength_v1` (below, flag `DEMAND_CLUSTERING_ENABLED`). | PRODUCTION_PROVEN (identity, lifecycle exclusion, provenance, tenancy, idempotency; corroboration awaiting natural evidence) |

### Stage 2D — Incremental product matching

Problem: a refreshed partition persisted new public evidence, but products only received it on
their next full product scan.

Interest: a product is interested in a partition when one of its own scans executed a query that
maps to that partition inside a 14-day window (`query_yield_artifacts`, workspace-scoped, RLS).
No new interest table: the artifact row is the durable, explainable relationship (which scan,
which query plan). Stage 2D adds `query_yield_artifacts.discovery_provenance`, the exact
conversation-independent discovery provenance template the product's query produced (query plan,
family, surface, concepts, compiled GitHub pain / X competitor anchors). It is derived with the
same function as scan provenance, so the frozen Retrieval Precision filters see byte-identical
product context. Artifacts without it (pre-2D) are skipped (`provenance_missing`), never guessed.

Flow: `refresh-market-partition` succeeds with evidence and stores the (<=10) conversation ids it
persisted on its job run -> dispatches `match-refreshed-partition` (idempotency key = refresh job
run id; flag `INCREMENTAL_PRODUCT_MATCHING_ENABLED`, re-checked at run time; queue concurrency 1)
-> `matchRefreshedPartitionIncrementally` loads interest, selects at most 20 products (newest
interest first, deterministic) -> per product: load the product by the artifact's own
(workspace_id, product_id), drop conversations the product already has a `product_matches` row
for, and run the unchanged `processScanCandidates` with maxLlmEvaluations 15 -> Map/Gap/Drift
re-aggregation only if new signals materialized. Read-first reads `signals` directly, so results
are visible on the next read without a scan.

Idempotency: `job_runs` with unique (job_type, idempotency_key): one GLOBAL
`match-partition-incremental` row per refresh job (workspace/product null; stores fanout,
skips and per-product results) and one PRODUCT PRIVATE `match-product-incremental` row per
(refresh job, product). A succeeded fanout or product row short-circuits replays; after a partial
failure only the failed products re-run. Analyses, matches, evaluations, rankings and signals keep
their existing fingerprint/natural-key idempotency.

Invariants: no provider calls; no writes to global partition identity/state; no product without
recorded interest is loaded or evaluated; hard caps of 20 products per refresh, 50 candidate
conversations and 15 evaluations per product; thresholds and selection unchanged.

Rollback: set `INCREMENTAL_PRODUCT_MATCHING_ENABLED=false` (queued runs also no-op). The migration
`20261014000000_incremental_product_matching_v1.sql` is additive (one nullable column, two job
types); leaving it in place is safe.

Deferred to 2E/2F: read-first `lastSuccessfulRefreshAt` still reflects product scans only;
interest is not yet plan-weighted; Free products are matched because matching makes no provider
calls (deterministic engines; shadow reasoning keeps its own gate).

Gate record (25 Sep 2026): commit d2c2c1a; Trigger 20260925.5; Vercel dpl_6vuKZHkWLoAFdM4eGevq7Mc3g5Rj;
migration 20261014000000 applied; `INCREMENTAL_PRODUCT_MATCHING_ENABLED=true` in Trigger prod.
- Flag off: refresh job bf6d8e42 stored 17 conversation ids on a tenant-free job; no dispatch;
  zero product-scoped writes.
- Flag on, legacy interest: fanout 0bbbc341 skipped the only interested product
  (`provenance_missing`); replay returned `already_succeeded`; zero product-scoped writes.
- Flag on, positive path: after a user scan (job f0d01cbb) recorded provenance (10/13 queries; HN
  and G2 are ineligible sources), refresh 0be0a87a of the GitHub pain_first partition (10 items,
  6 raw-new) auto-dispatched fanout 1447dfd9 -> product job 3c2cea21 for Linear only: 10 refreshed
  conversations, 4 already matched and skipped, 6 candidates, 1 selected by candidate_selection_v3
  with the product's GitHub pain anchors, 1 evaluation (signal_qualification_v1_7 /
  thresholds_v1 -> weak_candidate, so no ranking/signal, correctly). Deltas: +1 evaluation,
  +1 match, +1 analysis; signals/rankings/snapshots/usage unchanged. The other workspace product
  (Checkoutleak) was not touched. Provider cost 0 (GitHub), matching latency 5.8s for the
  product, 7.0s fanout. Replay run_06gdeg1rpme2dijhga4eo8lo01 returned `already_succeeded` with no
  writes (job attempt counts stay 1).
- Not observed in production: a qualifying incremental candidate. Materialization is the
  unchanged product-scan path and is covered by tests; read-first reads `signals` directly.

### Stage 2E — Evidence freshness vs interpretation freshness (`read_first_freshness_v2`)

Problem found in the post-2D product read pass: read-first freshness was one number - the age of
the newest persisted signal - and "last updated" counted only full product scans. After 2D a product
whose market was re-checked minutes ago but produced no new qualifying demand read as "stale /
refresh due", and the refresh action would start another paid provider scan for nothing.

Seam: read model only; no migration, every timestamp already exists. `ReadFirstIntelligenceService`
returns, additively:

- `freshness.evidence.lastRetrievedAt`: latest of the last product scan and the last successful
  Stage 2C refresh of any partition this product has interest in (partition set taken from the
  product's own RLS-scoped `query_yield_artifacts`; only a timestamp crosses from global state).
- `freshness.evidence.newestPublishedAt`: newest current signal publication time.
- `freshness.interpretation {state, lastCheckedAt, lastCheckSource}`: latest of the last product scan
  and the last succeeded `match-product-incremental` job for this product.
- `freshness.signalsUpdatedAt`, `freshness.demandViewUpdatedAt` (snapshot/gap/drift creation).
- `freshness.state` keeps its v1 meaning (evidence age).
- `freshness.refreshDue = state != fresh AND interpretation.state != fresh` - strictly narrower than
  v1, so v2 can only remove refresh enqueues, never add them.

UI copy distinguishes "Up to date - no new qualifying demand since the last signal" and "Market
checked - no qualifying demand yet" from genuinely stale intelligence. Rollback: revert the commit;
nothing persisted changes.

### Demand Drift foundation — drift comparability v1 (`drift_comparability_v1`)

Defect (production evidence, 25 Sep 2026): every one of the 50 persisted drift pairs compared two
90d snapshots created ~1.6h apart with 99.9% window overlap, because drift used "the latest two
snapshots" and every rebuild mints a snapshot ending now. Those rows only read stable/insufficient
because samples were small; with volume they would have produced cosmetic "rising" trends.

Fix (`src/server/modules/demand-intelligence/drift-comparability.ts`):
- Writes: drift is computed only between day-anchored (UTC midnight) adjacent windows of equal
  length - current `[anchor - W, anchor)` vs previous `[anchor - 2W, anchor - W)` - and only when
  Wanterest was already persisting demand intelligence for the product before the previous window
  started (`monitoringStartedAt` = first snapshot). Otherwise the rebuild records
  `Drift <window> skipped: insufficient_history` and writes nothing. Evidence is assigned to windows
  by publication time (`observed_at`), snapshots are fingerprint-idempotent, so at most one drift
  pair per window per day.
- Reads: `getDemandDrift`, read-first, Action generation and digests only use drift rows whose
  snapshots are adjacent and equal-length (`selectComparableDrifts` / `isComparableDriftRow`).
  Legacy overlapping rows remain as history and are never surfaced.
- Engine formulas (`demand-drift-v1`, minimum sample 5, significance) are unchanged.

Expected production state: no drift is shown until a product has two full windows of observed
history (7d: ~14 days after first intelligence). That is correct - no fabricated trends.

### Stage 2F — Adaptive cadence (`market_partition_cadence_v2`)

Replaces the fixed 24h + jitter success cadence of Stage 2C with a bounded, deterministic policy
(`adaptiveMarketPartitionCadence`, `market-partition-refresh.policy.ts`):

- Per-source bounds: GitHub base 12h (min 6h, max 7d); Stack Exchange base 24h (min 12h, max 7d).
- Novelty (raw new / raw items) >= 0.5 halves the interval, >= 0.2 multiplies it by 0.75.
- Consecutive zero-new refreshes back off x2, x4, x8, x16 (capped); any new item resets the streak.
- Three or more interested products multiply the interval by 0.75.
- Plan entitlement is intentionally not an input: a public partition is retrieved once for everyone.
  Plan-aware priority belongs to product matching/refresh requests, not duplicated retrieval.
- Next due = completion time + cadence + the existing deterministic per-partition jitter.

Hard ceilings: the scheduler selects at most 5 partitions per hourly tick AND never more than a
rolling-24h per-source cap (GitHub 120, Stack Exchange 60) counted from `refresh-market-partition`
job runs, which are tagged with their source at creation so in-flight work counts. X and YouTube stay
outside automatic refresh. Kill switch: `MARKET_PARTITION_REFRESH_ENABLED=false` (and 2D's
`INCREMENTAL_PRODUCT_MATCHING_ENABLED` for downstream fanout).

Timestamp semantics (handoff follow-up #3): `last_attempt_at` stays the claim time; `last_success_at`
/ `last_failure_at` and every next-due computation use the time the work actually finished.

Migration `20261015000000_market_partition_adaptive_cadence_v1.sql` adds global, service-role-only
state: `consecutive_zero_new`, `last_raw_items`, `last_raw_new_items`, `last_cadence_seconds`,
`cadence_policy_version`, plus a partial index for the daily-budget lookup. Each refresh job's stored
result records the full cadence decision (factors, clamp, next due) for audit.

Gate records (25 Sep 2026):
- 2E - commit 82ef440, Vercel production. For the Linear product the repository inputs are: last
  scan 06:23:50, last incremental match 06:26:23, last evidence retrieval 06:25:41, newest current
  signal publication 14 Sep. v1 would report stale + refresh due (would enqueue a paid scan); v2
  reports evidence `state=stale`, interpretation `fresh` via `incremental`, `refreshDue=false`.
  Read-model only; no migration.
- Drift comparability - commit 7d201e4, Trigger 20260925.6. Controlled rebuild
  run_06gdeii66b8n9d2bttdhtvsr01 wrote 3 current-window snapshots and 0 drift rows (50 legacy
  overlapping rows unchanged, never surfaced) with warnings `Drift 7d/30d/90d skipped:
  insufficient_history` (monitoring started 21 Sep; first honest 7d drift from 5 Oct).
- 2F - commit 972636c, migration 20261015000000 applied, Trigger 20260925.7. Refresh
  run_06gdek1ke02rhkf2uad8v6j301 (Stack Exchange pain_first, 0 items): attempt 06:45:56 (claim),
  success 06:45:59 (completion), zero-new streak 1, cadence 48h (24h x 2), next due 27 Sep 06:50:59
  (5 min jitter), job tagged `stack-exchange` at creation, decision stored on the job, lease cleared,
  no incremental dispatch (0 conversations). Rolling 24h use: GitHub 5/120, Stack Exchange 1/60.

### Stage 2G — Demand clustering and strengthening (`demand_clustering_v1`)

Architecture decision (approved for local implementation, 25 Sep 2026). Goal: repeated, real,
qualified evidence for the same underlying demand strengthens one durable, product-private demand
object instead of producing disconnected signals or being silently dropped as a duplicate.

Review findings that shaped the design:
- `demand_themes` are produced by `FixtureDemandThemeEngine` (a fixed CRM/workflow keyword
  taxonomy) and are only materialized when a product has no themes yet, so later observations never
  receive memberships. Themes are therefore not a safe durable identity and are left unchanged.
- `demand_observations` are one row per extracted phrase (pain, outcome, buyer language, ...). They
  are free-text facets, so grouping on them would either fragment (exact text) or merge fuzzily.
- `signals` are one per `product_matches` row; `findDuplicateSignal` suppresses near-duplicate
  content without recording it. Signals remain the per-evidence surface and are not changed.
- The frozen qualification (`signal_qualification_v1_7`) already persists, per evaluation,
  `matched_profile_concepts` (stable Demand Profile v2 keys, ordered by profile confidence then key),
  `primary_intent` and `demand_target_type`. These are deterministic, versioned, product-scoped
  primitives and are reused as-is (no embeddings, no LLM, no threshold change).

Durable demand object: `demand_clusters`, one row per (workspace, product, clustering version,
cluster key). A cluster is immutable identity only; strength lives in append-only state rows.

Identity (`demand_clustering_v1`, pure, `demand-clustering.policy.ts`). Only evaluations with
`decision = qualified` whose stored qualification passes `canMaterializeQualifiedSignal` are
eligible. Cluster key = `concept:<anchor>|intent:<family>|target:<scope>` where
- anchor = the first `matched_profile_concepts` key as persisted on the evaluation (normalized to
  `[a-z0-9_]`). Evidence with no matched profile concept is not clustered (`no_profile_concept`).
- family = primary intent grouped as `switch` (switching_intent, alternative_search,
  renewal_reconsideration), `evaluate` (comparison_intent, vendor_evaluation, purchase_research,
  recommendation_request), `capability` (feature_requirement), `pain` (explicit_pain, unmet_need,
  problem_solution_search), `unspecified` (unknown).
- scope = `product` (demand_target_type scanned_product), `implementation`, or `market`
  (category, third_party_product, unknown).

Identity vs metadata: concept, intent family and target scope are identity. Pain/outcome phrases,
alternatives (source products), exact intent, secondary concepts, source, geography and time are
metadata only; source drives corroboration, time drives staleness. Geography is not an input in v1.
One evaluation joins exactly one cluster per version (anchor only), so an item that matches several
concepts is never double counted. False merges are avoided because two items merge only when they
match the same product-profile concept key with the same intent family and target scope; different
products can never share a cluster (key and FKs are product-scoped).

Memberships (`demand_cluster_memberships`): immutable, one per (workspace, product, version,
match evaluation), recording the assignment rationale (anchor, all matched concepts, primary intent,
family, target type/scope, qualification and threshold versions). Evidence provenance edges link
each membership to its evaluation, conversation, source item, signal (if any) and cluster.

Strength (`demand_cluster_strength_v1`) is computed from distinct evidence, never processing count.
A membership contributes unless it is `evaluation_superseded` (the match's current evaluation is a
newer one: re-evaluation or loss of relevance), `signal_invalidated` / `signal_retracted`,
`stale` (evidence time older than 90 days), `duplicate_conversation`, or `duplicate_content`
(same source content hash as an earlier contributing member). Dismissed, saved and archived signals
still count: they are inbox states, not evidence validity, and the read model reports the mix.
Components persisted on every state: distinct evidence count n, distinct source count s, average
qualification demand quality q, evidence factor `1 - 0.5^n`, source factor (1 when s >= 2, else
0.85), score `q x evidence factor x source factor`, and level `inactive | single | repeated |
corroborated` (corroborated requires n >= 2 from >= 2 sources).

History: `demand_cluster_states` is append-only with a per-cluster `sequence`, `previous_state_id`
and an input fingerprint over the contributing/excluded membership sets. A recompute with the same
sets appends nothing; any change (new evidence, invalidation, supersession, staleness) appends a new
state linked to its predecessor and to every contributing (`strengthened_by`) and excluded
(`excluded_membership`, with reason) membership through evidence provenance. Nothing is updated or
deleted (immutability triggers on all three tables).

Execution: `rebuildDemandIntelligenceForScan` (scan and 2D incremental paths) runs
`clusterProductDemand` after observations when `DEMAND_CLUSTERING_ENABLED=true`. It reads the
product's qualified evaluations (bounded to the newest 500), creates missing clusters/memberships,
then recomputes one state per cluster. No provider or LLM calls. Failures are warnings and never
fail the scan. Lifecycle changes take effect on the next rebuild. Idempotency: deterministic IDs
plus unique keys `(workspace, product, version, cluster_key)`, `(workspace, product, version,
match_evaluation_id)` and `(workspace, cluster, strength_version, sequence)`.

Tenancy: all tables are workspace-owned with non-null `workspace_id`, composite FKs
`(workspace_id, product_id, cluster_id)` and `(workspace_id, product_id, match_evaluation_id)` (an
additive unique key on `product_match_evaluations (workspace_id, product_id, id)` backs the latter),
RLS enabled with member-only select, and writes through the service role only. Public
conversations stay global and are referenced, never copied.

Read model: `DemandClusteringService.getDemandClusters` returns each cluster's identity, label,
latest state (level, score, components, source/intent/alternative/lifecycle mixes, exclusions,
first/last evidence) and member evidence with contribution status, and a plain-language "why grouped"
explanation. It is not yet wired into read-first or the dashboard (Layer 9).

Minimum honest production proof: with the flag on, a real rebuild for an active product clusters
its existing qualified evaluations; SQL shows memberships = eligible evaluations, one state per
cluster, provenance edges to real evaluations/conversations; replay appends zero rows; an
evaluation superseded or invalidated produces a new state with the member excluded; no rows for
other products. Strengthening (n >= 2) can only be proven once real repeated evidence exists;
until then the stage is IMPLEMENTED_NOT_PROVEN for strengthening.

Gate record (25 Sep 2026):

- **Deploy.** Production SHA `0e87958017a1978c01c0cd0d123d5d9b9f66589e` (pushed to `origin/main`
  after local typecheck/lint/full-suite pass, 896 passed / 9 skipped / 0 failed). Supabase
  migration `20261016000000_demand_clustering_v1.sql` applied (only pending migration; dry-run
  matched). Trigger.dev prod version `20260925.8`, worker `worker_cmugzrskmcwmk0voceg81jx1g`,
  deployed with `--external-id 0e87958017a1978c01c0cd0d123d5d9b9f66589e`. Vercel production
  `dpl_4VD49RXrSNF2dadFGNaoQdbnpvWJ` built from the same commit (build log: `Cloning
  github.com/michelpronkk-oss/wanterest (Branch: main, Commit: 0e87958)`), aliased to
  `app.wanterest.com`, READY. `/api/health` returned `status=ok, liveness=ok, readiness=ok`.
- **Schema/RLS proof.** All three tables reachable by the service role (baseline 0/0/0 before
  enablement); `anon` denied with Postgres `42501 permission denied`, matching the migration's
  `revoke all ... from anon, authenticated; grant select ... to authenticated` plus
  `is_workspace_member` RLS policy. Flag read back from Trigger prod as absent before enablement
  (equivalent to default `false`), then `DEMAND_CLUSTERING_ENABLED=true` after `env set`.
- **Controlled rebuild.** Task `rebuild-product-demand-intelligence` (no scan, no provider calls,
  `evaluationIds: []`) run for Linear (`8b7a4189-...-1502dc2be82a` / `c5946172-...-08aedc9294cd`):
  run `run_06gdhh9jk5dcgpr1j66n7kq201`, 13:33:17-13:34:56 UTC. Result: 11 evaluations considered,
  1 cluster created, 11 memberships created, 1 state appended, 0 unclustered.
- **Deterministic identity.** All 11 of the workspace's qualified evaluations share
  `matched_profile_concepts: ["jira"]` and a `primary_intent` of `switching_intent` or
  `alternative_search` (both map to family `switch`) with `demand_target_type` absent/`unknown`
  (schema default, maps to scope `market`) — so all 11 independently compute the same key. Stored
  cluster: `concept:jira|intent:switch|target:market`, `label = "Jira - switching demand"`. Every
  membership's persisted `assignment` JSON recomputes to that identical key; hand-verified against
  the policy before the rebuild ran, then confirmed against the actual stored rows afterward.
- **Lifecycle proof (live, not synthetic).** Cross-referencing each evaluation against its match's
  `current_match_evaluation_id` showed only 1 of 11 is still the current evaluation for its match;
  the other 10 were superseded by later re-evaluations that all resolved `decision: "weak"` (the
  existing "a non-qualifying re-evaluation archives the active signal" lifecycle behavior). The one
  current evaluation's signal has `lifecycle_status: "invalidated"`. Resulting state:
  `strength_level: "inactive"`, `distinct_evidence_count: 0`,
  `exclusions: {"evaluation_superseded": 10, "signal_invalidated": 1}`,
  `lifecycle_mix: {"archived": 8, "dismissed": 2, "invalidated": 1}` (11 memberships' signal
  states). `evaluation_superseded` and `signal_invalidated` are proven live; `stale` and
  `duplicate_conversation`/`duplicate_content` have no live case today — see
  `tests/modules/demand-clustering-service.test.ts` for those paths (`LIVE_CASE_UNAVAILABLE`).
- **Negative merge.** No live counter-example exists: every qualified evaluation in the workspace
  (Checkoutleak is archived and has none) shares the same concept/intent-family/target-scope, so
  production cannot show two real evaluations landing in different clusters today. Covered by
  `tests/modules/demand-clustering-policy.test.ts` (different concept, intent family and target
  scope each produce a different key) — `LIVE_CASE_UNAVAILABLE` for a live two-cluster split.
- **Strengthening.** 11 real memberships landed in one cluster (multi-evidence grouping is proven),
  but every membership is excluded (superseded or invalidated), so `distinct_evidence_count = 0`
  and corroboration (`n >= 2` contributing, `>= 2` sources) is not observed.
  `MULTI_EVIDENCE_STRENGTHENING: AWAITING_NATURAL_EVIDENCE` — specifically, awaiting either new
  qualified evidence or a currently-valid (non-superseded, non-invalidated) qualified evaluation,
  not merely repeated evidence in general.
- **Replay/idempotency.** Same task re-triggered without reusing the idempotency key (a fresh
  Trigger-level execution, not a dedup short-circuit): run `run_06gdhi3ar1rikh0drq99n1qg01`,
  result `clustersCreated: 0, membershipsCreated: 0, statesAppended: 0` on the same 11
  evaluations. Row counts unchanged (clusters 1, memberships 11, states 1, provenance edges 67
  before and after); cluster id, state id, sequence (1) and input fingerprint all identical.
- **Tenancy.** All rows carry Linear's workspace/product; 0 rows for Checkoutleak; total rows
  across the whole database (1 / 11 / 1) equal Linear's rows exactly, so no other
  workspace/product has any Stage 2G row.
- **Side effects.** 0 `job_runs`, 0 new `query_yield_artifacts`, 0 new
  `product_match_evaluations`, 0 new `raw_source_items` created during either rebuild — no
  provider calls, no candidate selection, no qualification, no product-demand-scan.
- **Performance.** 11 evaluations considered, 1 cluster processed, bounded well within
  `DEMAND_CLUSTERING_MAX_EVALUATIONS = 500` and the task's `maxDuration = 1800`.
- **Frozen systems.** `git diff origin/main..0e87958 --stat` (pre-push) touched only
  `.env.example`, `env.ts`, the new `demand-intelligence/demand-clustering.*` module,
  `demand.orchestration.ts` (additive clustering call), `demand-intelligence/index.ts`, the
  migration, tests, and this doc. No frozen file (`query_planning_v7`, Retrieval Precision V1,
  Source Health V1, `candidate_selection_v3`, `signal_qualification_v1_7`/thresholds,
  `semantic_reasoning_router_v1`, provider adapters, product-scan budgets) was touched. No
  embeddings, no new LLM calls, no threshold change.

## 16. Layer 9 — Market intelligence views

### Layer 9A — Demand Map v2 (`demand_map_v2`)

Architecture decision (approved 25 Sep 2026). Read-side correctness change only: no migration, no
Trigger change, no new writes of any kind.

Problem found in review: the legacy Map (latest 30d `demand_snapshot` + fixture themes, phrases,
alternatives) is built from `demand_observations`, which are extracted once per qualified evaluation
and never re-checked against lifecycle. In production the 30d snapshot reported "8 qualified
signals" for Linear while Stage 2G proved every underlying evaluation superseded (10) or invalidated
(1). Snapshot/theme data therefore cannot represent *current* demand.

Contract:
- **Current demand source of truth:** Stage 2G clusters + live read-time lifecycle validation.
- **Historical context:** legacy snapshot themes / buyer language / alternatives only, labelled
  "Historical evidence (not lifecycle-filtered)" and collapsed by default. Never used to fill the
  current section, never counted in current headline numbers.
- **Map item = demand concept, not a cluster row.** Clusters are rolled up by
  `anchor_concept_key`; intent family and target scope are facets. Stable identity:
  `(workspace_id, product_id, clustering_version, anchor_concept_key)`.
- **Read-time validation:** a membership counts only if the latest persisted state lists it as
  contributing (`strengthened_by`) *and*, at read time, its evaluation is still the match's
  `current_match_evaluation_id`, its signal is not `invalidated`/`retracted`, and its evidence is
  inside the 90-day window relative to *now*. Anything failing is excluded from current counts and
  flags the concept `updatePending` (persisted state is older than lifecycle). Persisted exclusions
  are never revived.
- **Current concept** requires >= 1 live contributing membership (distinct by conversation).
  Inactive concepts are excluded from current counts and ranking and appear only under
  "Previously observed" with exclusion reasons; provenance/history is retained.
- **Exposed per concept:** label, status, active evidence count, active source count, source mix,
  intent-family and target-scope mixes, level (`single`/`repeated`/`corroborated`, same rule as
  `demand_cluster_strength_v1` applied to live counts), first/last active evidence, oldest state
  computed-at, exclusions by reason, up to 3 buyer-language phrases taken only from live contributing
  evaluations' observations, and a cluster -> membership drill-down with evidence node IDs. No new
  composite score.
- **Ranking:** active evidence count, then active source count, then most recent active evidence
  (concept key as final deterministic tie-break).
- **Empty state:** no current concept => "No current demand confirmed", with an honest reason
  (previously observed evidence no longer valid, or none clustered yet). Existing scan-state empty
  states (no scan / running / completed with nothing) are unchanged.
- **Overview:** the "Market state" line becomes cluster-led; remaining legacy cards are labelled
  historical.
- **Performance:** no per-cluster state reads. Batched reads: clusters, memberships, latest states
  (one bounded query, reduced to latest per cluster), state contribution edges, product-match and
  signal lifecycle (chunked `in` queries), buyer-language observations for live contributors only.
  The existing Stage 2G `getDemandClusters` N+1 is fixed with the same batched reads.
- **Rollout:** `DEMAND_MAP_V2_ENABLED` (Vercel runtime). Off => legacy Map/Overview unchanged.
  Rollback = flag off.
- **Out of scope (Layer 9B decision):** lifecycle-aware snapshot aggregation, Gap, Drift, Actions,
  Digests. Their current legacy behaviour is documented technical debt; 9A creates no actions or
  other downstream writes and does not change action generation.
- **Geography** later becomes a facet over live contributing members; never part of cluster or
  concept identity.
- **Production proof:** Linear signed in with the flag on shows "No current demand confirmed", Jira
  under "Previously observed" (10 superseded / 1 invalidated), legacy numbers only inside the
  historical section; SQL cross-check of counts vs `demand_cluster_states` and live lifecycle; zero
  row-count change in any table across page loads; no cross-workspace visibility.

Gate record (25 Sep 2026) — **LAYER 9A: PRODUCTION_PROVEN**

- **Deploy.** Implementation SHA `bf6413a77d674bf38e113c40818d3282030b4bff` (local typegen,
  typecheck, lint, build and full suite passed: 926 passed / 9 skipped / 0 failed). Flag-off
  deployment `dpl_3xUXJ7SZcP9nSg5U1JEBsSewZgp4` (same commit, READY, health ok) is the rollback
  baseline. `DEMAND_MAP_V2_ENABLED=true` set in Vercel production only, same commit redeployed:
  `dpl_ABKne9PksGoMdLA4WQTpRzeKDMrF`, READY, serving `app.wanterest.com`; `/api/health`
  `status=ok, liveness=ok, readiness=ok`. No migration; Trigger not redeployed (stays `20260925.8`).
- **Manual signed-in UI proof (Linear).** Current demand concepts 0, current distinct evidence 0,
  current sources 0, last current evidence "—"; "No current demand confirmed" renders; Jira appears
  only under "Previously observed (1) - not current demand" as "10 items, none current" with
  "10 re-evaluated below the qualification bar · 1 invalidated"; "Historical evidence (not
  lifecycle-filtered)" renders separately; legacy evidence is not presented as current demand.
  Overview market state: "No current demand confirmed." Visual styling is out of scope for 9A.
- **Read model.** The deployed read path (`DemandMapService` + legacy `getDemandMap`, commit
  `bf6413a`) run read-only against production: `current = []`, totals 0/0/0; previously observed
  concept `jira` (identity `demand_clustering_v1` + `jira`), cluster
  `concept:jira|intent:switch|target:market`, 11 memberships over 10 distinct conversations (one
  conversation evaluated twice), 0 contributing, latest persisted state sequence 1 (`inactive`),
  `updatePending = false`. Legacy 30d snapshot carried only as `not_lifecycle_filtered`
  (8 qualified signals / 7 conversations), absent from every current total.
- **SQL reconciliation.** All 11 memberships belong to Linear's workspace/product; live
  `product_matches.current_match_evaluation_id` excludes 10 (`evaluation_superseded`), live signal
  lifecycle excludes `d0faa8a3` (`signal_invalidated`); current = 0, historical = 11, exclusions
  10 / 1 — identical to the persisted Stage 2G state, so the read-time check agreed with storage.
- **Zero writes.** Read path executed through a client wrapper that throws on insert/upsert/update/
  delete (completed), plus repeated page requests: counts of `demand_clusters` 1,
  `demand_cluster_memberships` 11, `demand_cluster_states` 1, `demand_snapshots` 171,
  `demand_observations` 85, `demand_themes` 1, `demand_gaps` 53, `demand_drifts` 50,
  `evidence_nodes` 6951, `evidence_provenance` 13911, `actions` 0, `signals` 10,
  `product_match_evaluations` 180, `job_runs` 1010, `query_yield_artifacts` 359,
  `raw_source_items` 230 — identical before and after.
- **No provider/LLM/Trigger side effects.** Only scheduled `automatic-monitoring-scheduler` and
  `monitoring-notification-delivery` runs occurred in the validation window (15:25-15:34 UTC); no
  scan, rebuild, candidate selection, qualification, LLM or provider activity.
- **Tenancy.** Unauthenticated `/app/insights/map` and `/app/insights` return 307 to `/login`.
  Every product-owned read filters on `workspace_id` and `product_id` (fake-client contract test and
  the production run). CROSS_WORKSPACE LIVE CASE: UNAVAILABLE (single production workspace);
  covered by `demand-map-service` / `demand-map-supabase-reads` tests.
- **Performance.** One query per table (clusters, memberships, states, provenance, product matches,
  signals; buyer language skipped with no live contributors), ~570 ms from a remote client for 1
  cluster / 11 memberships / 1 concept; no per-cluster state loop.
- **Rollback.** `DEMAND_MAP_V2_ENABLED=false` + redeploy returns Map and Overview to the legacy path
  with no schema or data change (flag tests; flag-off deployment observed first). Flag left on.
- POSITIVE CURRENT-DEMAND LIVE CASE: AWAITING_NATURAL_EVIDENCE.
- Known legacy debt for 9B: 30d snapshots have had 0 snapshot themes since at least
  24 Sep 22:29 UTC (predates 9A), so the historical theme table is empty; the app home page still
  reads legacy drift.

### Layer 9B — Lifecycle-aware downstream intelligence (`downstream_intelligence_v2`)

Architecture decision (approved 25 Sep 2026). Read-side correctness change, plus one write-side
change (pausing legacy Action generation). No migration.

Problem: qualified-evaluation lifecycle (superseded, invalidated, retracted) leaks into
`demand_observations` at scan time and is never re-checked. Themes, snapshots, Gap, Drift and
Actions all inherit this. Production's legacy Gap page shows a `switching_intent` gap (score 0.05,
1 mention) built entirely from the same 10 superseded / 1 invalidated evaluations Stage 2G and
Layer 9A already proved invalid. Theme identity is also not durable (`switching_intent` is an
intent, not a concept; legacy 30d snapshots have had 0 themes since before 9A).

**Decision: option D, a staged hybrid.**
- **9B (this stage, no migration):** one shared currentness resolver (extracted from the 9A Map
  service, not duplicated), lifecycle-aware Gap v2 and Drift v2 derived from it at read time,
  automatic Action generation from legacy (non-lifecycle-verified) bases paused, Digests filtered
  through the same resolver. Legacy data is kept, never rewritten, and shown only as labelled
  history.
- **9C (deferred):** persisted, append-only concept market state and a new Action trigger type with
  a lifecycle-verified concept basis, which is what allows Actions to be generated again. Frozen
  "what we believed then" drift history is also 9C.
- Rejected: (A) making the legacy snapshot/theme pipeline itself lifecycle-aware — the theme
  identity is independently broken and wouldn't produce meaningful concepts. (B) switching
  everything straight to clusters — Drift needs windowed comparison and Actions need a persisted,
  database-accepted basis; neither exists yet without 9C's migration.

**Canonical identity** (shared with Layer 9A, not reinvented): `(workspace_id, product_id,
clustering_version, anchor_concept_key)`.

**Canonical currentness** (one definition, reused everywhere via `lifecycleExclusionReason`, not
duplicated): a Stage 2G membership counts as current only if the latest persisted state lists it as
contributing, **and**, re-checked at read time: it is still the match's current evaluation, its
signal is not invalidated or retracted, and its evidence is <=90 days old (relative to now). Counted
once per conversation. Historical is everything else, plus all legacy snapshot/theme/gap/drift
data. No subsystem may define "current" independently.

**Gap v2** (`demand_gap_v2`, not persisted): computed only for current concepts. 0 current evidence
=> "No current gap evidence". 1-4 current evidence => directional only, no score. >=5 => a score
using the existing frozen `calculateGapScore` formula fed live inputs (share of current evidence
across current concepts, the existing frozen `calculatePositioningWeight`, high-intent share from
switch/evaluate intent families, and the existing sample-quality bucketing thresholds). Legacy gap
rows remain visible only as labelled, collapsed history.

**Drift v2** (`demand_drift_v2`, not persisted): per concept, buckets currently-valid (canonical
currentness) evidence into adjacent, day-anchored windows using the existing frozen
`driftAnchor`/`planDriftComparison`/`isComparableSnapshotPair`, and the existing frozen
`calculateDriftDirection`/`calculateSignificance`/`calculateGrowthRate`. Both windows need >=5 valid
items before a direction is assigned; otherwise "insufficient" / "No comparable current movement".
`monitoringStartedAt` comes from one new bounded read (`getEarliestSnapshotTimestamp`, a single
`limit(1)` query), preserving the existing monitoring-history requirement without an unbounded
history scan. Accepted trade-off: a historical window's count can shrink if its evidence is later
invalidated (frozen "what we believed then" history is 9C); and because currentness caps evidence
at <=90 days old, a 90d-window comparison's older leg will typically show "insufficient" once both
legs must be current — this is an honest consequence of one shared currentness definition, not a
bug. Legacy drift is never presented as current.

**Actions:** with the flag on, `generateActionsForScan` does not generate from legacy gap, drift,
snapshot-fallback or geography triggers (none of them have a lifecycle-verified concept basis, and
legacy theme keys cannot be reliably mapped to Stage 2G concept identity). It records the explicit
warning `no_lifecycle_verified_basis` and creates no substitute. No Action schema change. Existing
persisted Actions are never deleted, rewritten, dismissed or mutated; on read, with the flag on,
every existing Action (none of whose trigger types carry a verified concept basis in 9B) is labelled
`basisLifecycleStatus: "not_verified"` in the read model only. With the flag off, the label is
`"not_applicable"` and generation is unchanged.

**Digests:** with the flag on, `Phase4DigestSource` excludes legacy theme/gap/drift candidates
entirely and excludes signal candidates that are not current per the same shared
`lifecycleExclusionReason` (invalidated, retracted, superseded, or the signal's own evidence stale).
No new concept-based digest items are added yet. With the flag off, behaviour is unchanged.

**Surfaces:** Gap and Drift pages show a v2 current section plus legacy collapsed under "Historical
evidence (not lifecycle-filtered)". Home's Rising/Cooling uses Drift v2 only (no current movement =>
nothing shown, no legacy fallback). The Overview's "Biggest change" and "Largest positioning gap"
cards switch to v2 content; its other legacy-derived cards keep the Layer 9A historical labelling.
Geography is labelled "not lifecycle-filtered" only; no rework. No UI redesign.

**Flag:** `DOWNSTREAM_INTELLIGENCE_V2_ENABLED`, read in both Vercel (pages) and Trigger
(`generateActionsForScan`, digest builds), default `false`. Off => byte-for-byte existing behaviour.
On => 9B semantics active and legacy Action generation paused.

**Performance:** reuses the 9A batched currentness read (500-evaluation and 5,000-state bounds
preserved). No new N+1. The only new read is the single bounded `getEarliestSnapshotTimestamp`. No
provider or LLM calls. Legacy-history display continues to reuse the existing, unmodified legacy Gap
and Drift services (same precedent as the 9A Map's legacy section) rather than rewriting them.

**Frozen and unchanged:** Stage 2G identity and strengthening, `calculatePositioningWeight`,
`calculateGapScore`, `calculateDriftDirection`, `calculateSignificance`, `calculateGrowthRate`,
`drift_comparability_v1`'s window/anchor rules, the Action schema and engine, qualification,
candidate selection, provider adapters, source budgets, and lifecycle write semantics.

Gate record (25 Sep 2026) — **LAYER 9B: PRODUCTION_PROVEN**

- **Deploy.** Architecture SHA `8427d291f91efac6c5b72059e72738b95988c6f9`, implementation SHA
  `adfb6d36028ffd484ecc6c33f16364041c7a2915` (local typegen, typecheck, lint, build and full suite
  passed: 962 passed / 9 skipped / 0 failed). Flag-off baseline: Vercel `dpl_2bhHSmp9Mwtxr9UoBL63oCfopV4b`
  and Trigger `20260925.9`, both from the implementation SHA, `DOWNSTREAM_INTELLIGENCE_V2_ENABLED`
  confirmed absent in both beforehand. `DOWNSTREAM_INTELLIGENCE_V2_ENABLED=true` set in both Vercel
  and Trigger production; Vercel redeployed to `dpl_B4LdAMsXriGXymEH71sh3GNSQqfh` (same commit,
  aliased to `app.wanterest.com`); Trigger correctly needed no rebuild (env vars are read at
  runtime) and stayed on version `20260925.9`. `/api/health` `status=ok, liveness=ok, readiness=ok`.
  No migration; no Stage 2G/qualification/candidate-selection/provider/budget/lifecycle-write file
  touched (confirmed via `git diff` scope).
- **Manual signed-in UI proof (Linear).** Gap: "No current gap evidence", no fabricated scored or
  directional opportunity, legacy `switching_intent` gap only under collapsed
  historical/not-lifecycle-filtered. Drift: "No comparable current movement", no legacy Rising/
  Cooling or snapshot drift presented as current, insufficient-history state truthful. Home: no
  current Rising/Cooling trend from legacy drift. Overview: "Largest positioning gap" and "Biggest
  change" both reflect the v2 no-current-evidence result; remaining legacy-derived cards stay
  labelled historical. Geography: labelled "Not lifecycle-filtered" only, unchanged otherwise.
- **Linear currentness reconciliation.** Re-verified live (not assumed): `demand_cluster_states`
  shows `strength_level: "inactive"`, `distinct_evidence_count: 0`, `contributing_membership_count: 0`,
  `excluded_membership_count: 11`, `exclusions: {"evaluation_superseded": 10, "signal_invalidated": 1}`
  — identical to Stage 2G's and Layer 9A's prior proof. The deployed read path (write-blocked
  client) run against production reproduced this independently: Gap v2 `hasCurrentEvidence: false,
  items: []`; Drift v2 `comparable: false, reason: "insufficient_history"` for all three windows
  (7d/30d/90d) — output was byte-identical (aside from the timestamp) before and after enabling the
  flag, proving determinism and that enabling it caused no side effect. Map, Gap v2 and Drift v2 all
  resolve from the same `DemandCurrentnessService` read; no subsystem has its own definition of
  current.
- **Zero-write proof.** 16 tables (`demand_clusters`, `demand_cluster_memberships`,
  `demand_cluster_states`, `demand_snapshots`, `demand_observations`, `demand_gaps`, `demand_drifts`,
  `actions`, `digests`, `digest_items`, `digest_deliveries`, `monitoring_alerts`, `signals`,
  `product_match_evaluations`, `query_yield_artifacts`, `raw_source_items`, `job_runs`,
  `evidence_nodes`, `evidence_provenance`) identical before and after the enable-and-validate
  window; the read-model script itself used a client wrapper that throws on any insert/upsert/
  update/delete and completed without throwing.
- **No provider/LLM side effects.** Only the pre-existing scheduled `automatic-monitoring-scheduler`
  and `monitoring-notification-delivery` ran in the validation window, both on the prior Trigger
  version `20260925.8` — no scan, candidate selection, qualification, or LLM activity attributable
  to 9B.
- **Bounded reads.** One query per table for the combined Gap v2 + Drift v2 read (`product_snapshots,
  demand_clusters, demand_cluster_memberships, demand_cluster_states, evidence_provenance,
  product_matches, signals, demand_snapshots`); the single `demand_snapshots` query is the new
  bounded `limit(1)` `getEarliestSnapshotTimestamp`, not the unbounded `listSnapshots`. No
  per-concept loop. ~2s round-trip for 1 cluster / 11 memberships / 1 concept.
- **Rollback.** Flag-off baseline observed first, before enablement; flag-off tests prove
  byte-identical behaviour; `DOWNSTREAM_INTELLIGENCE_V2_ENABLED=false` in both runtimes plus a
  redeploy returns to that baseline with no schema/data change. Flag left **on** in both runtimes.
- LIVE_ACTION_PAUSE_GATE: UNREACHABLE_BEHIND_PLAN_GATE — `actions_enabled=false` (Free plan)
  short-circuits `generateActionsForScan` before the 9B gate; not bypassed. Proven instead: flag
  active in Trigger prod, deployed source is the implementation SHA, the source-contract test
  confirms the gate precedes every legacy read, production Action count stayed at 0.
- LIVE_EXISTING_ACTION_LABEL_CASE: UNAVAILABLE (0 Actions in production). Proven by test: an
  Action's stored row is `toEqual`-identical before/after reading it with the flag on; only the read
  model gains `basisLifecycleStatus: "not_verified"`.
- LIVE_DIGEST_V2_CASE: UNAVAILABLE_MONITORING_DISABLED — `monitoring_enabled=false` and
  `digest_enabled=false` for the workspace (verified live); monitoring was not enabled to force
  this. Proven instead: deployed source contains the v2 filtering and shared-resolver call, flag
  active, local tests prove invalidated/retracted/superseded and legacy-candidate exclusion
  (mutation-tested), digest/delivery counts stayed at 0.
- CROSS_WORKSPACE LIVE CASE: UNAVAILABLE (single production workspace); covered by the tenancy test.
- POSITIVE CURRENT-DEMAND LIVE CASE: AWAITING_NATURAL_EVIDENCE.
- All three Drift windows are presently blocked by insufficient monitoring history (earliest
  snapshot 2026-09-21, four days of history), a stronger and more conservative honest result than
  the 90d-specific case. The separate 90d canonical-currentness-cap limitation (a 90d window's older
  leg exceeds the <=90-day currentness bound) is proven by `demand-drift-v2-policy.test.ts` but
  cannot yet be isolated live because the monitoring-history gate fails first for every window.

## 18. Layer 9C — Persisted concept market state + Action basis (`concept_market_state_v1`)

Architecture decision (approved 25 Sep 2026, revised twice before implementation for four
corrections plus a final Action-basis guardrail — see below). Adds durable, append-only,
lifecycle-verified concept history, and the persisted basis future Actions may reference. Layer
9A/9B's read paths are unchanged: pages keep reading live via `DemandCurrentnessService`; 9C is a
write-side addition that does not become the page source in this stage (Option A, confirmed).

### Core principle

9B answers "what is valid current demand right now?" (read-time, re-derived every time). 9C
additionally answers "what did Wanterest validly believe at time T, based on what evidence?"
(write-time, frozen forever). A state written at time T remains immutable even if the evidence
behind it is later superseded, invalidated, retracted, or goes stale; a later lifecycle change can
only produce a new state, never rewrite the old one.

### Concept and state identity

Concept identity is unchanged: `(workspace_id, product_id, clustering_version, anchor_concept_key)`.
`clustering_version` is a first-class, persisted column on every 9C table (not implied through a
join), so two clustering versions can never share one concept's history:

- Concept market state: `(workspace_id, product_id, clustering_version, anchor_concept_key,
  concept_market_state_policy_version, sequence)`.
- Concept gap state: the same tuple plus `gap_state_policy_version`, with a composite FK to its
  exact market-state row.
- Concept drift state: the same tuple plus `drift_state_policy_version` and `window` (window is
  part of this identity, never of concept identity).
- Action basis: the specific `concept_market_states.id` (and, when gap/drift-triggered, the
  specific `concept_gap_states.id` / `concept_drift_states.id`) recorded as `trigger_id` +
  `trigger_evidence_node_id`, via the same generic evidence-node trigger mechanism every existing
  Action trigger type already uses.

### Append-only semantics

Effective change = input-fingerprint change; identical recomputation appends nothing. Sequence +
`previous_state_id` chain, identical to Stage 2G's `demand_cluster_states`. Immutability triggers
reject `update`/`delete` on all three tables, same pattern. No lifecycle write ever appends a state
directly — only a materialization run appends, and only if the fingerprint changed. A concept with
zero current evidence still receives a state ("inactive"/"no current demand"); this is its
tombstone, not a separate mechanism.

### Persisted objects, statuses, and what is deliberately not semantic input

Three tables, one materialization run per rebuild:

- `concept_market_states` — one row per (concept, sequence): current evidence count, distinct
  source count, source/intent-family/target-scope mix, strength level, first/last evidence time,
  exclusion summary, `input_fingerprint`. Reuses the Layer 9A/9B roll-up
  (`DemandCurrentnessService` + `buildDemandMap`) directly — 9C never re-derives currentness with
  separate logic.
- `concept_gap_states` — one row per (concept, sequence), FK to one market state and one
  `product_snapshots` row (already immutable/versioned; reused as the frozen positioning basis, no
  new positioning table). `status: "no_current_demand" | "directional" | "scored"` — all three are
  persisted whenever materialization runs and a positioning basis exists (an immutable record of
  "checked, found nothing executable" is itself valuable; absence of a row would be ambiguous with
  "never checked"). If no positioning snapshot exists yet, gap materialization is skipped that
  cycle with a warning, matching the existing precondition-skip pattern in
  `rebuildDemandIntelligenceForScan`. Only `status = "scored"` may become an Action basis.
- `concept_drift_states` — one row per (concept, window, sequence). Never "total market-state count
  at T1 vs T2" (that would recreate the overlapping-window problem `drift_comparability_v1` already
  fixed). Instead it freezes the exact comparison computed once at materialization time via the
  frozen `driftAnchor`/`planDriftComparison`/window-bucketing logic Drift v2 already uses:
  `previous_period_start/end`, `current_period_start/end`, `comparable`/`comparability_reason`,
  `monitoring_started_at_basis`, frozen current/previous evidence and source counts, `direction`,
  `significance`, `share_delta`, `growth_rate`. A non-comparable result is persisted too (symmetric
  with Gap's "checked, found nothing"). The `market_state_id` FK on a drift row is lineage only
  (which materialization run produced it) — never a semantic input to its frozen numbers, which
  come directly from bucketing currently-valid membership evidence into the two frozen windows.

### Provenance (evidence_nodes / evidence_provenance only, no JSON-only lineage)

- `concept_market_states` -> `derived_from_cluster_state` -> every relevant Stage 2G
  `demand_cluster_states` evidence node rolled into the concept; -> `strengthened_by` -> every
  contributing membership's evidence node; -> `excluded_member` (`measurement: {reason}`) -> every
  non-contributing but considered membership's evidence node. The `exclusions` jsonb column is a
  fast-read summary, never a substitute for these edges — a zero-evidence state must remain fully
  traceable to the real evidence that was considered and excluded (Stage 2G's own existing
  `strengthened_by`/`excluded_membership` pattern, applied one level up at the concept roll-up).
- `concept_gap_states` -> `derived_from_market_state` -> its market state's node; ->
  `uses_positioning` -> the `product_snapshots` evidence node.
- `concept_drift_states` -> `current_window_member` / `previous_window_member` -> every
  membership's evidence node that fell in each frozen window at materialization time; ->
  `derived_from_market_state` (lineage only); -> `supersedes_state` -> its own `previous_state_id`'s
  evidence node.

### Fingerprints (idempotency)

- Market state: sha256 of `{policyVersion, clusteringVersion, anchorConceptKey, sorted
  [(membershipId, clusterId, contributes, reason)]}` across every relevant cluster.
- Gap state: sha256 of `{policyVersion, marketStateId, marketStateInputFingerprint,
  productSnapshotId, productSnapshotContentHash}` — includes the market state's own fingerprint,
  not just its id.
- Drift state: sha256 of `{policyVersion, comparabilityVersion, clusteringVersion,
  anchorConceptKey, window, all four period boundaries, monitoringStartedAtBasis, sorted
  currentWindowMemberIds, sorted previousWindowMemberIds}` — full frozen membership sets, never
  counts alone and never just the two state ids. Because `driftAnchor(now)` moves forward daily, a
  new day naturally produces new boundaries and a new fingerprint even with unchanged evidence; a
  same-day replay with unchanged evidence appends nothing.

### Materialization triggers

Added as one more step inside the existing rebuild path (`rebuildDemandIntelligenceForScan`),
immediately after Stage 2G clustering — the same additive, non-fatal, flag-gated pattern Stage 2G
itself uses. Not triggered by lifecycle writes directly (no new event infrastructure, per Layer
9B's precedent) and not a separate scheduler. A lifecycle change becomes a new persisted state at
the next rebuild that touches the product (manual scan or 2D-incremental dispatch) — the same
cadence Stage 2G already relies on.

### Action basis — live-validated at write time

A persisted state being latest, recent, and above the evidence threshold is not sufficient by
itself: lifecycle can change between materialization and the next rebuild. Immediately before any
concept-based Action is written (plan gate first, always):

Gap basis (two independently-changing inputs — demand and positioning):
1. `actions_enabled` plan gate.
2. The referenced `concept_market_states` row must be the latest for its concept.
3. Run `DemandCurrentnessService` live for this concept; recompute the same market-state
   fingerprint function materialization uses (one implementation, called twice).
4. Require live fingerprint == persisted market-state fingerprint; otherwise stop with
   `basis_currentness_mismatch`.
5. Load the current positioning snapshot using the exact same semantics
   `currentPositioningSnapshot` (Gap v2) already uses.
6. Require `concept_gap_states.product_snapshot_id == current positioning snapshot id`;
   otherwise stop with `basis_positioning_mismatch`.
7. Only then: eligibility (latest sequence, `status = "scored"`, existing
   `actionCandidateIsQualified` thresholds unchanged, staleness, idempotency) -> write.

Drift basis:
1. Plan gate first.
2. The referenced `concept_drift_states` row must be the latest for `(workspace, product,
   clustering_version, anchor_concept_key, drift_state_policy_version, window)` — an older
   immutable drift belief remains valid history but can never become a new Action basis once a
   newer drift state exists for the same window.
3. Its `market_state_id` must resolve to the latest eligible concept market state.
4. The same live currentness-fingerprint check as the gap path.
5. Existing `actionCandidateIsQualified` drift thresholds (rising, notable/strong, unchanged) ->
   write.

On any mismatch: the persisted state is never mutated, and no replacement is materialized inline —
materialization stays a single writer (the rebuild path only), so a mismatch just means this cycle
skips; the next normal rebuild produces a state a later Action-generation pass can use. No new
source-diversity threshold is introduced anywhere in this stage.

### Action schema — smallest change, existing rows untouched

Two new `actions.trigger_type` values, `concept_gap` and `concept_drift`, added to the existing
check constraint (additive `drop constraint if exists` / `add constraint`, same pattern already
used twice). Two new `evidence_nodes` node types (`concept_gap_state`, `concept_drift_state`, plus
`concept_market_state` for the market state's own node) and entity tables (`concept_gap_states`,
`concept_drift_states`, `concept_market_states`) added to those two existing check constraints,
same additive pattern Stage 2G already used. `validate_action_trigger()` gets two more `case`
branches (`concept_gap` -> `concept_gap_states`, `concept_drift` -> `concept_drift_states`) — no
new column on `actions`, no bespoke per-type FK. Every existing Action row
(`demand_gap`/`demand_drift`/`demand_snapshot`/`signal`) stays valid and untouched;
`actionCandidateIsQualified` and `ActionTriggerType`'s existing thresholds are extended to also
recognize `concept_gap`/`concept_drift` as equivalent to the `demand_gap`/`demand_drift`
branches — the same numbers, not new ones.

### Action generation flow

DOWNSTREAM_INTELLIGENCE_V2_ENABLED=false -> legacy behaviour (rollback, unchanged).
DOWNSTREAM_INTELLIGENCE_V2_ENABLED=true, CONCEPT_ACTIONS_ENABLED=false -> paused (Layer 9B's proven
state, unchanged). DOWNSTREAM_INTELLIGENCE_V2_ENABLED=true, CONCEPT_ACTIONS_ENABLED=true -> legacy
triggers remain prohibited; eligible, live-validated concept_gap / concept_drift bases may
generate Actions. Legacy gap/drift/snapshot/geography triggers are never silently re-enabled.

### Digests

Deferred beyond noting the intended shape (not implemented in 9C): a concept newly becoming
`scored`, newly `rising` with notable/strong significance, or transitioning into inactive — each
only on the materialization that produced the transition, to avoid noise. No delivery/notification
redesign.

### Zero-current-demand production reality (honest, not manufactured)

Production Linear's expected first 9C state: `concept_market_states` — 0 contributing, 11 excluded
(10 `evaluation_superseded`, 1 `signal_invalidated`), with 1 `derived_from_cluster_state` edge and
11 `excluded_member` edges (fully traceable, zero `strengthened_by` edges); `concept_gap_states` —
`status: "no_current_demand"`, framed against Linear's real, existing `product_snapshots` row;
`concept_drift_states` — `comparable: false, comparability_reason: "insufficient_history"` for all
three windows (monitoring history since 2026-09-21 is not yet 14 days deep, matching Layer 9B's
already-proven live result). None of this is manufactured; it is the honest, fully-provenanced
record of what materialization actually found.

### Feature flags

`CONCEPT_MARKET_STATE_ENABLED` (gates materialization writes) and `CONCEPT_ACTIONS_ENABLED` (gates
concept-based Action generation; requires `DOWNSTREAM_INTELLIGENCE_V2_ENABLED=true` to do
anything). Both default `false`. No new read-side flag — pages do not read 9C state in this stage.
Rollout order: migration -> deploy (flags off) -> `CONCEPT_MARKET_STATE_ENABLED=true`, prove
materialization -> only then `CONCEPT_ACTIONS_ENABLED=true`.

### Performance and tenancy

Materialization reuses `DemandCurrentnessService`'s existing bounds (500 evaluations via Stage
2G's cap, 5,000 states via `DEMAND_CLUSTER_STATE_READ_LIMIT`) — no new unbounded read. Prior-state
lookups are always `order by sequence desc limit 1` (or a small bounded N for lookback), never a
full history scan. No provider, discovery, or LLM calls. Every new table carries non-null
`workspace_id`/`product_id`, composite `(workspace_id, product_id, id)` FKs throughout (including a
new additive `product_snapshots_workspace_product_id_key unique (workspace_id, product_id, id)`,
the same kind of additive key Stage 2G already added to `product_match_evaluations`), RLS enabled
with `revoke ... from anon, authenticated` / `grant select to authenticated` / `grant all to
service_role` and member-select via `is_workspace_member(workspace_id)` — identical to Stage 2G's
proven migration pattern.

### Legacy compatibility

`demand_snapshots`, `demand_gaps`, `demand_drifts`, `demand_themes`, existing `actions` rows, and
Stage 2G's own tables are never rewritten. 9C reads Stage 2G's states as input and writes new,
separate tables; the legacy Gap/Drift pipeline and Layer 9A/9B's read paths keep running unchanged.

### Explicitly out of scope for 9C

Geography facets on concept state; a second independent reconciliation scheduler; frozen-history
backfill for drift comparisons predating 9C; Digest delivery/notification redesign; any UI for
concept history; source/provider/qualification/discovery/pricing changes; new LLM reasoning; Layer
10 product expansion.

Gate record (25 Sep 2026) — **LAYER 9C: PRODUCTION_PROVEN**

- **Deploy.** Architecture SHA `628915a`, implementation SHA `0a1f5eaad2dde94ac626b2c8c96ad772a3413b06`
  (local typegen, typecheck, lint, build and full suite passed: 1005 passed / 9 skipped / 0 failed).
  Migration `20261017000000_concept_market_state_v1.sql` applied to the linked production project —
  confirmed in `supabase migration list` remote history; schema verified live: `concept_market_states`,
  `concept_gap_states`, `concept_drift_states` exist; `product_snapshots_workspace_product_id_key`
  composite uniqueness present; `evidence_nodes_node_type_check`/`entity_table_check` extended with
  the three new node/table pairs; `actions_trigger_type_check` extended with `concept_gap`/
  `concept_drift`; `validate_action_trigger()` carries both new branches unchanged from the existing
  ones; RLS enabled on all three tables with an `authenticated` member-select policy and no anon
  policy (default-deny); composite `(workspace_id, product_id, …)` tenancy FKs present on every
  cross-table reference; `BEFORE UPDATE`/`BEFORE DELETE` immutability triggers present on all three.
  Flag-off deploy: Vercel `dpl_2SPgGnJLCtZ9aJzXBmndKQ23aWGp` (aliased `app.wanterest.com`), Trigger
  version `20260925.10` / deploy `kghloj1v` / external-id `0a1f5eaad2dde94ac626b2c8c96ad772a3413b06`;
  both new flags confirmed absent beforehand in Trigger production; health `status=ok, liveness=ok,
  readiness=ok`. Flag-off regression: 9C table counts `0/0/0`; Stage 2G (1 cluster, 11 memberships)
  and Actions (0) unchanged — the materialization block is gated behind
  `CONCEPT_MARKET_STATE_ENABLED === "true"` at the orchestration entry point, so no 9C code path
  executes while the flag is off, structurally, not merely by observation.
- **Controlled Linear rebuild** (Trigger run `run_06gdjup85i2qredhdgre5eak01`, via the existing
  `rebuild-product-demand-intelligence` task with empty `evaluationIds`/`signalIds` — persisted
  evidence only, no discovery/provider call) produced exactly the predicted result: **market
  state** — 1 row, `anchor_concept_key: "jira"`, `clustering_version: "demand_clustering_v1"`,
  `sequence: 1`, `previous_state_id: null`, `distinct_evidence_count: 0`,
  `contributing_membership_count: 0`, `exclusions: {"evaluation_superseded": 10,
  "signal_invalidated": 1}`; independently recomputed `liveMarketStateFingerprint` equals the
  stored `input_fingerprint` byte-for-byte. **Provenance** — 1 `derived_from_cluster_state` + 11
  `excluded_member` edges (10 carrying `evaluation_superseded`, 1 carrying `signal_invalidated`),
  0 `strengthened_by`; every edge's source resolves to a real `demand_cluster_memberships` or
  `demand_cluster_states` row (no JSON-only lineage). **Gap state** — `status: "no_current_demand"`,
  `gap_score: null`, correct `market_state_id`/`product_snapshot_id`
  (`0b1c68c8-ba96-4c96-b152-a20493702d51`, matching Linear's live `current_snapshot_id`);
  `derived_from_market_state` + `uses_positioning` provenance present. **Drift states** — one row
  per window (7d/30d/90d), all `comparable: false` / `comparability_reason: "insufficient_history"`
  (monitoring history began 2026-09-21, four days old), distinct per-window fingerprints, a single
  lineage-only `market_state_id` (never `current_market_state_id`/`previous_market_state_id`), each
  with its own `derived_from_market_state` edge.
- **Replay/idempotency** (Trigger run `run_06gdk0p78bvd5irph88ilvqp01`, identical payload): created
  0 new rows (`marketStatesCreated/gapStatesCreated/driftStatesCreated: 0/0/0`); table counts,
  row IDs, sequence numbers, and fingerprints byte-identical before and after.
- **Immutability.** A live `UPDATE` against the production market-state row was rejected with
  `concept_market_state_history_is_immutable`; the row was confirmed unchanged afterward. A live
  `DELETE` attempt was blocked by the platform's own production-safety classifier before it reached
  the database — not bypassed, not retried. The `DELETE` arm rests on the same installed
  `BEFORE DELETE` trigger (confirmed present via `information_schema.triggers`, using the identical
  `prevent_concept_state_mutation()` function that rejected the `UPDATE`) plus the passing migration
  contract test.
- **Currentness and positioning basis match.** `BASIS_CURRENTNESS_MATCH: PROVEN` — a fresh
  `liveMarketStateFingerprint` recompute (read-only, no Action created) equals the persisted
  `concept_market_states.input_fingerprint` exactly. `BASIS_POSITIONING_MATCH: PROVEN` —
  `concept_gap_states.product_snapshot_id` equals the positioning snapshot Gap v2's own selection
  semantics (`current_snapshot_id`, falling back to the latest) currently resolves to, exactly.
  BASIS_CURRENTNESS_MISMATCH and BASIS_POSITIONING_MISMATCH remain AWAITING_NATURAL_EVIDENCE live;
  both are proven by `concept-action-service.test.ts`'s deterministic mismatch cases.
- **Action non-eligibility (flag off).** Linear's persisted basis is honestly ineligible: the gap
  state's `status: "no_current_demand"` is filtered out by `concept-action.service.ts`'s
  `.filter(row => row.status === "scored")` before eligibility scoring ever runs; all three drift
  states' `comparable: false` is filtered by the equivalent drift guard. Production `actions` count
  is 0. `CONCEPT_ACTIONS_ENABLED=true` was attempted and was blocked by the platform's own
  production-safety classifier (feature-flag write in the Action-generation path) — not bypassed,
  not retried, and the user was not asked to enable it manually. This is intentional, not a 9C
  defect: production Linear has `actions_enabled=false` (Free plan) and
  `action.orchestration.ts:30-31` runs that plan-gate `getWorkspaceEntitlement` check before either
  the concept-Action branch or the legacy pause reason — the concept-Action path is structurally
  unreachable in production today regardless of `CONCEPT_ACTIONS_ENABLED`. Recorded:
  `LIVE_CONCEPT_ACTION_PATH: UNREACHABLE_BEHIND_PLAN_GATE`;
  `CONCEPT_ACTIONS_ENABLED: FALSE / NOT ENABLED IN PRODUCTION`. No commercial entitlement was
  changed to manufacture this proof.
- **Legacy Action safety.** `DOWNSTREAM_INTELLIGENCE_V2_ENABLED=true` confirmed live; legacy
  `demand_gap`/`demand_drift`/snapshot-fallback/geography Action bases remain paused per Layer 9B;
  9C added a new path only and never reopened them; production `actions` count stayed at 0 across
  the entire validation window.
- **Side effects.** `mcp__trigger__list_runs` for the full validation window shows only the two
  `rebuild-product-demand-intelligence` runs plus unrelated pre-existing scheduled jobs
  (`automatic-monitoring-scheduler`, `monitoring-notification-delivery`, `market-partition-refresh-
  scheduler`) — no discovery, candidate-processing, or Action-generation task ran. At the data
  level: `raw_source_items`, `source_items`, `product_matches`, `product_match_evaluations` all
  show 0 new rows created during the window. The only legitimate writes were the 9C states/evidence
  nodes/provenance edges on the first rebuild; the replay wrote nothing.
- **Tenancy.** Every 9C row belongs to exactly one workspace (`8b7a4189-…`) and one product
  (`c5946172-…`); only one production workspace exists today, so `CROSS_WORKSPACE LIVE CASE:
  UNAVAILABLE` — covered instead by the composite-FK schema proof and the deterministic
  cross-product/cross-workspace tenancy tests.
- **Performance.** Controlled rebuild: 1 concept considered, 1 market state / 1 gap state / 3
  drift states created, 12 provenance edges on first materialization (0 on replay), ~1.5 minutes
  wall time. The currently-active materialization path is fully bounded: every per-concept state
  lookup (`latestMarketState`/`latestGapState`/`latestDriftState`) is a `.limit(1)` query; the
  underlying evaluation read remains capped at `DEMAND_CLUSTERING_MAX_EVALUATIONS = 500` and the
  Stage 2G state-batch read at `DEMAND_CLUSTER_STATE_READ_LIMIT = 5000`, both unchanged. One
  observation, not a live defect: the batch `listLatestMarketStates`/`listLatestGapStates`/
  `listLatestDriftStates` reads (used only by `ConceptActionService`, which is currently disabled)
  read all historical sequence rows for one product before deduping client-side to latest-per-
  concept, with no row cap analogous to Stage 2G's `DEMAND_CLUSTER_STATE_READ_LIMIT`. This does not
  affect any currently active code path and is not a genericity defect; worth a bound before the
  Action path is ever enabled at scale.
- **9A/9B read-path preservation (Option A).** Zero references to any 9C module or table exist in
  `src/app` or `src/components`. `getDemandGapV2Query`/`getDemandDriftV2Query` call the live
  `downstreamService()` (Layer 9B); `getDemandMapV2Query` calls the live `DemandMapService` (Layer
  9A). 9C rows are not the page source; they exist for historical belief, provenance, audit, and a
  future Action/Digest basis only.

**GENERICITY: PROVEN**

- **Hard-code audit (B1).** Zero occurrences of `Linear`/`linear`/`Jira`/`jira` or the production
  workspace/product UUIDs in any 9C production file, orchestration file, or the migration. The one
  match found repo-wide (`market-context.fixtures.ts`) is a pre-existing, unrelated calibration
  fixture for a different (pre-9C) classifier, using "Jira"/"Linear"/"Orbit"/"Plane" as generic
  example company names in test data — not production logic.
- **Generic identity (B2).** Confirmed by source: `concept_market_states`/`concept_gap_states`/
  `concept_drift_states` identity is exactly `(workspace_id, product_id, clustering_version,
  anchor_concept_key, policy_version, sequence)`. `anchorConceptKey` originates from Stage 2G's
  `demandClusterIdentity` (`concepts[0]`, the first normalized profile concept — data-driven, no
  product-name dependency) and is used everywhere in 9C purely as an opaque lookup/grouping key,
  never as a literal-value branch condition (grepped for `anchorConceptKey ===`/`anchor_concept_key
  ===` across `src/`: every match is a parameterized equality comparison, never a hard-coded string).
- **Multi-workspace/multi-product (B3).** Existing test `"never leaks another product's or
  workspace's evidence into a concept's market state"` plus a new test added this session,
  `"never merges the same anchor concept key across different products or workspaces"`
  (`tests/modules/concept-market-state-service.test.ts`, generic `"pricing"` concept across two
  products in one workspace and one product in a second workspace): three separate rows, three
  distinct IDs, each `latestMarketState` lookup resolves only to its own product/workspace. The
  pre-existing `"rejects a gap/drift state forged to reference another product's market state"`
  test proves the composite-FK tenancy rejection live at the repository layer.
- **Multi-concept roll-up (B4).** New test `"rolls multiple Stage 2G clusters sharing one anchor
  concept (different intent/target) into one market concept state, while unrelated anchors stay
  separate"` — three generic concepts (`pricing`, `api_access`, `reporting`), with `pricing` seeded
  from two clusters differing in `intent_family`/`target_scope`: they roll into one market-concept
  state (`contributing_membership_count: 2`) while `api_access`/`reporting` remain separate rows.
  Confirmed by source: `demand-map.policy.ts` groups clusters by `anchorConceptKey` alone for the
  concept roll-up, independent of `intent_family`/`target_scope`, which remain Stage 2G's own
  cluster-level differentiators.
- **Multi-signal lifecycle (B5).** Fully covered by the pre-existing, generic (`"sprint_planning"`)
  `demand-currentness-service.test.ts` test `"covers every exclusion reason: superseded,
  invalidated, retracted, stale, duplicate conversation"`. `concept-market-state.service.ts` itself
  contains zero conditional branches on any lifecycle-reason string (grepped) — it records whatever
  `contributes`/`reason` `DemandCurrentnessService` determines, opaquely, so it structurally
  inherits that already-proven genericity rather than needing to re-test it.
- **Multi-source (B6).** `source_mix`/`distinct_source_count` are pure pass-throughs from
  `buildDemandMap`'s own generic computation (`concept.sourceMix`/`concept.activeSourceCount`);
  `concept-market-state.service.ts` and `.policy.ts` contain zero references to `source_key` at
  all. The pre-existing replay test already mixes two sources (`github`, `bluesky`) without any
  source-conditional behavior.
- **Gap genericity (B7).** `conceptGapStatus(activeEvidenceCount)` takes only a count — its
  signature has no concept parameter at all — already tested exhaustively (0 → `no_current_demand`,
  1–4 → `directional`, ≥5 → `scored`) in `concept-market-state-policy.test.ts`, generic by
  construction.
- **Drift genericity (B8).** `materializeDriftStatesForWindow` calls `planDriftComparison({window,
  now, monitoringStartedAt})` — a pure function with no concept parameter; `anchorConceptKey` is
  used only as a map key for per-concept window-member lookup. Period-boundary/comparability logic
  is the same pre-existing `drift-comparability.ts` module shared with legacy Drift v1/v2.
- **Action genericity (B9).** `concept-action.service.ts` contains zero product-name or
  source-provider branches (confirmed by source read and by the B1 grep sweep). Eligibility depends
  only on: latest-state match, staleness, live currentness-fingerprint match, positioning match
  (gap), `actionCandidateIsQualified`'s existing frozen thresholds, and the caller's plan gate.
- **Signal scope (B10).** Confirmed by construction: Stage 2G only clusters `decision === "qualified"`
  evaluations (`demand-clustering.repository.ts`'s `.eq("decision", "qualified")` filter), and
  `DemandCurrentnessService` further filters by lifecycle validity before anything reaches 9C. A raw
  discovered source item never becomes market state on its own.

**Test-only commit:** `30d3e17e2d6384df43a1aa7f859dc5c637ca420b` (`test: prove Layer 9C
product-agnostic behavior`) — two new deterministic tests only, no production code changed; Vercel's
GitHub integration auto-deployed this commit (contains no runtime behavior change); Trigger was not
redeployed.

**Pending / unavailable, none of which block this verdict:**
ACTIVE CONCEPT STATE, SCORED GAP STATE, COMPARABLE PERSISTED DRIFT, BASIS_CURRENTNESS_MISMATCH LIVE
CASE, BASIS_POSITIONING_MISMATCH LIVE CASE, and MULTI-SOURCE PERSISTED STRENGTHENING are all
AWAITING_NATURAL_EVIDENCE; CONCEPT-BASED ACTION CREATION is UNREACHABLE_BEHIND_PLAN_GATE; CROSS_
WORKSPACE LIVE CASE is UNAVAILABLE (single production workspace).

**PERSISTED CONCEPT MARKET STATE: PRODUCTION_PROVEN.**
**PERSISTED GAP / DRIFT BASIS: PRODUCTION_PROVEN.**
**ACTION BASIS SAFETY: PRODUCTION_PROVEN.**
**GENERIC PRODUCT/SIGNAL ARCHITECTURE: PROVEN.**
**CONCEPT ACTION EXECUTION PATH: UNREACHABLE_BEHIND_PLAN_GATE.**
**CONCEPT_ACTIONS_ENABLED: FALSE / NOT ENABLED IN PRODUCTION.**

## 19. Layer 9D — Lifecycle-aware Geography (`GEOGRAPHY_V2_ENABLED`)

Architecture decision (approved 25 Sep 2026). Answers "where is CURRENT, lifecycle-valid demand
coming from?" using the exact same canonical currentness already proven in Stage 2G/9A/9B/9C — no
second definition of current is introduced.

### Core principle

Geography is a **facet** over demand evidence, never part of concept/cluster/Gap/Drift/market-state
identity. `pricing` remains one concept; US/UK/Canada are breakdowns of it, not separate concepts
(`pricing_us` never exists). The existing geo evidence model is unchanged: explicit-only extraction
(`provider_country`, `structured_metadata`, `review_region`, `public_profile_location`,
`explicit_thread_context`), never inferred from language/writing style/names/provider/product
identity; `language_only` stays non-reliable; unknown stays unknown; source/provider never defines
location (no `github = US`-style shortcut). `reliableLocation`/`regionReliableLocation` (extracted
from `geography.service.ts`, unchanged logic) become the one shared reliability predicate for both
the legacy and the v2 model.

### Currentness

Current Geography is derived, read-time, from `DemandCurrentnessService.getCurrentness()` +
`buildDemandMap()` — the identical call 9A's Map and 9C's materialization already make. A
conversation contributes to current Geography only through a Stage 2G membership where
`contributes === true`; superseded evaluations, invalidated/retracted signals, and stale evidence
(>90 days) contribute zero, by construction (they never appear in `buildDemandMap`'s `current`
bucket). No new lifecycle rule is written.

### Product-wide dedupe (Guardrail 1)

The same conversation may legitimately evidence more than one concept. Concept-scoped Geography
dedupes by `conversation_id` **within** that concept only (a conversation may legitimately appear
again under a different concept's own Geography). Product-wide Geography dedupes by
`conversation_id` **across all current concepts first** — the member set is built once, uniquely
keyed by conversation id, before any geography aggregation runs; product-wide totals are never the
sum of per-concept totals. Invariant: product-wide geographic evidence count <= canonical distinct
current conversations for the product; a concept's geographic evidence count <= that concept's
`activeEvidenceCount`.

### No current-geo trend (Guardrail 2)

Current Geography is a point-in-time distribution. The legacy current-vs-previous-window trend
calculation is not reused for it and no rising/cooling/growth/decline claim is produced from the v2
current model. Legacy trend remains available only inside the clearly labelled historical,
not-lifecycle-filtered section. True lifecycle-aware Geographic Drift (frozen period-over-period
geography, mirroring 9C's frozen drift boundaries) is explicitly deferred to a future stage.

### Read model

A new `CurrentGeographyReadModel` (product-wide by default, optional `anchorConceptKey` scope):
`generatedAt`, `clusteringVersion`, `currentnessPolicyVersion`, `anchorConceptKey`,
`currentEvidenceCount`, `knownLocationCount`, `unknownLocationCount`, `reliableCoveragePercent`,
`countries[]` (`countryCode`, `countryName`, `currentEvidenceCount`,
`percentageOfAllCurrentEvidence`, `percentageOfKnownLocationEvidence`, gated `regions[]`,
`representativeSignals[]` sourced only from current contributing members), `diagnostics`. Deliberate
naming departs from the legacy `qualifiedSignalCount` vocabulary (which could imply all
historically-qualified evidence counts) in favor of explicit `current*` terms. Unknown location
evidence is always part of the truthful denominator: `unknownGeoSignalCount` is reported and
`reliableCoveragePercent` is computed over known-only and labelled as such; a percentage of *all*
current evidence is exposed separately. No city-level precision is exposed (no reliable source
supports it).

### Historical Geography

The existing legacy raw-window `GeographyService`/`aggregateGeoIntelligence` path is unchanged and
stays available, labelled "historical / not lifecycle-filtered," reusing the same
`HistoricalEvidenceSection` collapsible pattern 9A already uses for the Map. Current and historical
counts are never blended; historical data never fills an empty current section. With zero current
contributing evidence (Linear today), current Geography honestly reports an empty state ("No current
geographic demand confirmed") rather than presenting legacy numbers as current.

### Deferred (not built in 9D)

Geographic Drift (frozen historical geography snapshots would be needed first); geographic Gap
segmentation (regional opportunity claims); any new Geography Action trigger (`concept_geo`,
`concept_gap_geo`, or equivalent) — legacy geography-based Action generation stays paused exactly as
9B left it; Geography as descriptive context on an already-eligible 9C concept Action (future work,
not 9D); a concept-selector UI (backend/read-model capability only in 9D).

### Persistence

None. No migration, no new table, no new evidence nodes solely for Geography. Current Geography
derives entirely from already-persisted canonical evidence (Stage 2G memberships +
`source_items.metadata.geo`), matching the strong default from the architecture review — schema is
not added merely because 9C introduced persisted state.

### Provenance

Read-time traversable, not stored as new edges: concept/product -> Stage 2G membership -> evaluation
-> conversation -> primary source item -> `source_items.metadata.geo` -> explicit location basis.
Every `representativeSignals` entry resolves back to a real conversation/source id from the current
contributing member set only.

### Tenancy, performance, genericity

Every v2 read is scoped by `workspace_id`/`product_id`; an optional `anchorConceptKey` filter applies
inside that scope only, never across products/workspaces. Reuses the already-batched
conversation/source-item bulk loads (`intelligence.listConversations`/`listSourceItems`, `.in(...)`
queries, no N+1); the currentness read is bounded exactly as 9A/9C already proved. No provider or
LLM calls. No product-name/source-provider branch anywhere in the new code; concept identity and
geography resolution both remain generic by construction (opaque `anchorConceptKey`, opaque
`countryCode`).

### Feature flag

`GEOGRAPHY_V2_ENABLED`, default false/absent, Vercel/read-side only (the Geography page's server
component; no Trigger task executes this read path). Flag off: existing Geography behavior
byte-identical. Flag on: current lifecycle-aware Geography renders first, legacy Geography renders
below as clearly labelled historical context. Rollback: flag false, no schema/data to revert.

### Layer 9 completion

A successfully production-proven 9D closes Layer 9: every user-facing current-demand claim (Map,
Gap/Drift, Actions, Geography) now traces back to the one canonical `DemandCurrentnessService`
definition. Geographic Drift/Gap segmentation remain deliberately-scoped future enhancements on top
of an already-correct foundation, not outstanding Layer-9 correctness gaps.

## 20. Layer 9D — Production proof and Layer 9 closeout

Production validation completed 25 Sep 2026.

### Release records

- Architecture commit: `f98b8e1e7e86fd98fa89a3b108d00dac402cda33`
- Implementation commit: `81772c6f390ceb6450f1de71537bb1d87b3b0b71`
- Flag-off Vercel deployment: `dpl_2hJZ4xvVNwxVQKYFQaEHLe4YneBc`, READY.
- Flag-on Vercel deployment: `dpl_8YwwujRmDiFxozhqjqprEk9uMn9A`, READY, built from
  implementation commit `81772c6f390ceb6450f1de71537bb1d87b3b0b71`.
- `GEOGRAPHY_V2_ENABLED=true` in Vercel Production only. Trigger was not redeployed and does not
  consume Geography v2.
- Both deployments passed `/api/health` with `status=ok`, `liveness=ok`, and `readiness=ok`.

### Production validation result

The deployed-equivalent server/read path was executed against production Supabase for Linear
(`product_id = c5946172-6bef-45c0-a5da-08aedc9294cd`). Product-wide and concept-scoped reads both
returned:

- `currentEvidenceCount = 0`
- `knownLocationCount = 0`
- `unknownLocationCount = 0`
- `countries = []`

The current section therefore truthfully reports **No current geographic demand confirmed**. The
legacy Geography section remains explicitly labelled historical / not lifecycle-filtered and does
not fill the empty current section. Manual signed-in production UI validation confirmed the same
result: no current country, historical separation is visible, and no current Rising, Cooling,
trend, or growth claim is shown.

### Canonical currentness reconciliation

Linear's canonical Stage 2G truth was re-read from production:

- 1 cluster
- 11 memberships considered
- 10 `evaluation_superseded`
- 1 `signal_invalidated`
- 0 current contributing evidence

Geography v2 uses the same `DemandCurrentnessService` and `buildDemandMap` currentness as Map,
Gap v2, Drift v2, and 9C market state. No Geography-specific lifecycle definition was introduced.

### Dedupe, scope, evidence, and denominators

- Product-wide dedupe keys current members by `conversation_id` before geographic aggregation;
  the deterministic generic multi-concept test passes. **PRODUCT-WIDE MULTI-CONCEPT LIVE CASE:
  UNAVAILABLE.**
- Concept-scoped reads support optional `anchorConceptKey` inside the requested workspace/product;
  deterministic positive scope tests pass. No selector UI was required for 9D.
- Location evidence remains explicit-only through the existing extractor and resolver. Language-only
  evidence is not reliable country evidence; provider identity does not define geography; unknown
  remains unknown; city precision is not invented; region output retains the existing reliability
  and five-signal sample gate.
- The read model exposes `currentEvidenceCount`, `knownLocationCount`, `unknownLocationCount`,
  `reliableCoveragePercent`, `percentageOfAllCurrentEvidence`, and
  `percentageOfKnownLocationEvidence`. Unknown evidence remains in the all-current denominator;
  deterministic positive denominator tests pass.
- Current Geography is point-in-time only. It contains no current trend, rising, cooling, growth,
  or percentage-change contract. Legacy trend remains confined to historical Geography.

### Zero-write and side-effect proof

Repeated Geography v2 reads left all relevant production counts unchanged. The before/after counts
were: `demand_clusters=1`, `demand_cluster_memberships=11`, `demand_cluster_states=1`,
`concept_market_states=1`, `concept_gap_states=1`, `concept_drift_states=3`,
`demand_observations=85`, `signals=10`, `product_match_evaluations=180`, `evidence_nodes=7120`,
`evidence_provenance=14494`, `actions=0`, `raw_source_items=230`, and
`query_yield_artifacts=359`.

The Geography v2 path is read-time only: no provider retrieval, discovery, product scan, candidate
selection, qualification, LLM call, demand rebuild, Trigger task, migration, persistence write, or
new provenance edge was observed or introduced. The source path contains no Geography v2 Trigger
consumer.

### Tenancy, performance, genericity, and rollback

- Every read is workspace/product scoped; the concept filter cannot escape that scope. **CROSS-
  WORKSPACE LIVE CASE: UNAVAILABLE.** Deterministic tenancy tests pass.
- Currentness reads are bounded; conversations and source items are loaded in bulk; no N+1 or
  unlimited historical scan occurs in the current path; no provider or LLM cost is incurred.
- The 9D production code contains zero Linear, Jira, production UUID, or workspace UUID logic and
  remains generic across workspace, product, concept, source, and country.
- The observed flag-off deployment and deterministic flag tests prove rollback to legacy Geography
  with no schema change, data change, or Trigger change. Production remains on
  `GEOGRAPHY_V2_ENABLED=true` after successful validation.

### Frozen-system verification

Layer 9D changed none of Stage 2G identity or strengthening, 9A Map semantics, 9B Gap/Drift
semantics, 9C persisted state semantics, Action generation, plan/pricing, query planning, retrieval
precision, source health, candidate selection, qualification thresholds, reasoning, provider
adapters, or lifecycle writes. No migration, new LLM work, or source change was made.

**LAYER 9D: PRODUCTION PROVEN.**

**LAYER 9: COMPLETE.**

Deferred Geographic Drift, Geographic Gap segmentation, Geography Actions, city precision, concept
selector UI, and premium UI/UX remain non-blocking future enhancements. No Layer 10 is started.

## 21. Layer 10 — Actions (`actions_lifecycle_v1`)

Architecture decision (approved 25 Sep 2026 after one review and two amendments). Layer 10 moves
Wanterest from "understand the market" to "take controlled action on verified market
intelligence" without letting Actions outrun the evidence behind them. It builds only on the
Layer 9C persisted, lifecycle-verified basis; Layer 9 itself is not reopened.

### What an Action is

An Action is a workspace/product-owned **proposal**: a concrete, deterministic response to exactly
one persisted 9C basis (`concept_gap` or `concept_drift`), plus the human decision on it and the
human's own execution record. Recommendation fields are immutable (database-enforced); lifecycle
fields are mutable only through audited transitions. Wanterest **proposes**; in Layer 10 a human
**approves, starts and completes** the work (`executionMode = "manual"`). Wanterest never claims it
executed anything. There is no connector, executor abstraction, or autonomy in Layer 10; approval
policy is the constant `human_required_v1`.

### Canonical concept Action identity

- A concept Action belongs to `(workspace_id, product_id, trigger_clustering_version,
  trigger_concept_key)`, where `trigger_concept_key` is the opaque 9C `anchor_concept_key` and
  `trigger_clustering_version` is the basis row's `clustering_version` — Layer 9's canonical concept
  identity, preserved. A concept under a later clustering version is never blocked by an open Action
  of an earlier version that happens to share the anchor key.
- `actions.trigger_clustering_version` and `actions.proposal_fingerprint` are additive nullable
  columns. `actions_concept_identity_check` requires both (plus a valid sha256 fingerprint) for
  `concept_gap`/`concept_drift` and requires them to be null for legacy trigger types.
  `validate_action_trigger()` additionally verifies that the referenced basis row belongs to the
  same workspace/product and carries the same `clustering_version` and `anchor_concept_key`
  (`action_concept_identity_mismatch`). Both new columns are immutable generated fields.
- **One open Action per concept:** partial unique index `actions_one_open_concept_action` on
  `(workspace_id, product_id, trigger_clustering_version, trigger_concept_key)` where
  `trigger_type in ('concept_gap','concept_drift') and status in ('proposed','approved',
  'in_progress')`. `trigger_type` is deliberately not part of the slot: Gap and Drift compete for
  one semantic Action per concept.
- Legacy creation idempotency is unchanged (`action:{product}:{trigger_type}:{trigger_id}:{engine}`).
  Concept Actions append the proposal fingerprint
  (`action:{product}:{trigger_type}:{basis_state_id}:{engine}:{proposal_fingerprint}`): still
  replay-stable, and a changed proposal on an unchanged basis row can never resolve to the Action
  it replaces.

### Safe bases

Only `concept_gap` (scored) and `concept_drift` (comparable, rising, notable/strong) may create
Actions. `concept_market_states` is supporting provenance and the currentness anchor only. Legacy
`demand_gap`/`demand_drift`/`demand_snapshot`/`signal`/geography bases stay paused while
`DOWNSTREAM_INTELLIGENCE_V2_ENABLED=true`. Eligibility thresholds are the existing, frozen
`actionCandidateIsQualified` numbers; no source-diversity threshold is introduced.

### Canonical cross-type selector

One pure function, `selectCanonicalConceptCandidate(identity, inputs, now)`, returns
`{ state: "pending", reason }` or `{ state: "settled", candidate | null }`. It is the only priority
implementation and is used by generation, write-side reconciliation, the list and detail read
models, approve and start. Inputs are batched: latest market state, latest gap state, latest drift
state per supported window (7d/30d/90d), the live `DemandCurrentnessService` roll-up, the current
positioning snapshot (`current_snapshot_id`, else latest version) and the product. Order:

1. No market state, or market state older than the existing 90-day `staleBefore` → settled, null.
2. Live currentness fingerprint ≠ persisted market-state fingerprint → `pending("currentness")`.
3. **Materialization-lag guardrail.** Incomplete 9C materialization is never read as "no
   candidate":
   - a positioning snapshot exists but no gap state is linked to the latest market state →
     `pending("gap_materialization")`;
   - a supported drift window has no state, or its latest state is linked to an older market
     state and does not reproduce from the live roll-up (same pure drift-fingerprint function 9C
     materialization uses; a legitimately unchanged drift window is recognised, not treated as
     lag) → `pending("drift_materialization")`.
4. The latest gap state references an older positioning snapshot than the current one →
   `pending("positioning")`.
5. Eligible scored Gap (linked, positioning current, qualified) wins.
6. Otherwise the best eligible Drift: strong before notable, then 7d, 30d, 90d, then state id.
7. Nothing eligible → settled, null.

Pending never writes: no expiry, no Gap→Drift fallback, no supersession. A candidate carries its
basis type/row, window, generation input, `proposal_fingerprint` and a **basis guard** (the latest
market, gap and per-window drift state ids the decision used). An open Action whose clustering
version differs from the active one is reported `pending("clustering_version_unsupported")`.

### Proposal continuity fingerprint (`action_proposal_continuity_v1`)

The existing `input_fingerprint` hashes state ids and continuous scores, so it changes with every
new state and cannot express "same proposal". `proposal_fingerprint` hashes only what changes the
deterministic recommendation: continuity version, action engine version, basis policy version,
trigger type, clustering version, concept key, product name, action type, target key, and the
sample-quality bucket, plus — Gap — product snapshot id and content hash, or — Drift — direction and
significance. State ids, drift period boundaries, drift window and raw scores are excluded, so a
daily drift state or a window switch with the same meaning keeps the same fingerprint; a new
positioning snapshot or a sample-bucket change produces a new one. Gap and Drift fingerprints never
collide (trigger type is included).

### Continuity (write-side reconciliation)

Per concept, against the selector result:

| Selector | Open Action | Result |
| --- | --- | --- |
| pending | any | no write |
| settled, no candidate | proposed / approved | **expired** (`stale_at` set) |
| settled, no candidate | in_progress | unchanged (read model: `invalid`) |
| candidate, same fingerprint | any open | keep; `revalidated_by` provenance to the new basis; one idempotent `revalidated` event per new basis |
| candidate, different fingerprint | proposed / approved | atomically **superseded** by a replacement built from the candidate |
| candidate, different fingerprint | in_progress | unchanged, `proposalCurrent=false`; replacement waits until it closes |
| candidate | none open | create, subject to re-proposal rules |

Superseded means a replacement committed in the same transaction; expired means the settled
selector found nothing eligible. `in_progress` is never auto-expired or auto-superseded. Cross-type
cases follow directly: Drift→Gap and Gap→Drift supersede (different fingerprints), Gap→Gap and
Drift→Drift carry forward unless the semantic proposal changed.

**Re-proposal after a human close.** After a *user* dismissal or a completion, a new Action for the
same concept is created only if the candidate fingerprint differs from the closed Action's or a
persisted non-qualifying state (same trigger type, same window for drift) exists with a sequence
after the closed Action's basis (bounded ascending lookup, limit 100; hitting the cap counts as no
break and is reported as a warning). System expiry, supersession and usage rejection never
suppress.

### Atomic writes (service-role-only RPCs)

- `create_concept_action(p_action, p_supersede_action_id, p_expected_status, p_basis_guard, ...)`:
  one transaction. It locks the old Action (`FOR UPDATE`), takes a transaction advisory lock on
  `(workspace_id, idempotency_key)`, and resolves any existing Action by that key **first** — the
  replay identity is `(workspace_id, idempotency_key)`, never a caller UUID, so a retry after a lost
  response, network uncertainty or a concurrent call returns the stored row. Otherwise it checks the
  basis guard, compare-and-sets the old status, supersedes it, inserts the evidence node and the
  new Action together, sets `superseded_by_action_id`, writes `triggered_by`/`supersedes_action`
  provenance and events, and consumes `action_generated` usage exactly once. Any failure (including
  usage refusal or the one-open index) rolls back everything: no orphan evidence node, and never a
  superseded Action without a resolvable replacement.
- `transition_action(...)`: locks the row, compare-and-sets the expected status, enforces the
  lifecycle matrix, re-checks the basis guard for approve/start of concept Actions
  (`action_basis_changed`), re-checks active non-viewer membership for user actors, writes the
  `action_events` row and, for users, the `audit_log` row in the same transaction.

### Lifecycle

`proposed → approved | dismissed | expired` (and legacy-only `superseded`); `approved →
in_progress | dismissed | expired` (legacy-only `superseded`); `in_progress → completed |
dismissed`. Terminal: `completed`, `dismissed`, `superseded`, `expired`. Concept supersession only
happens through `create_concept_action`. `expired` is system-only and sets `stale_at`.

### Authorization (fixes the service-role IDOR)

The browser sends only `actionId`, `toStatus` and an optional note (≤1000 chars, event metadata
only). The server requires a user, loads the Action through the user's RLS-scoped client (absent →
`NOT_FOUND`, identical for non-existent and cross-tenant ids), derives `workspace_id`/`product_id`
from the row, verifies active membership through RLS and the role (viewer: read only;
member/admin/owner: approve/start/complete/dismiss), performs plan/revalidation checks, and only
then calls the service-role RPC. A browser-supplied `workspaceId` authorizes nothing. System
expiry/supersession is server-owned.

### Approve / start revalidation

Immediately before approve or start: authorize, require `actions_enabled`, run the selector, require
a settled candidate whose `proposal_fingerprint` equals the Action's, then call `transition_action`
with the candidate's basis guard. Pending → reject without a write. Settled with no candidate →
system expiry (if still proposed/approved), then reject. Different fingerprint → reject ("a newer
recommendation replaces this one"). Legacy-basis Actions cannot be approved or started while
`DOWNSTREAM_INTELLIGENCE_V2_ENABLED=true` (read and dismiss only). Complete and dismiss require
auth, membership and role only — no plan gate, no basis check — because they record what the human
already did or chose.

### Live read model

Every open concept Action on the list and on the detail view carries a derived `basisStatus`
(`valid` | `update_pending` | `invalid`), `proposalCurrent` and `allowedTransitions`, computed by the
same selector over one batched, read-only, bounded load per product (no writes, no provider or LLM
calls, no per-Action N+1). Pending → `update_pending`; settled null → `invalid`; candidate → `valid`
with `proposalCurrent = fingerprint equality`. An old Drift Action with a newer canonical Gap reads
`valid` / `proposalCurrent=false` and cannot be approved or started until reconciliation replaces
it. Page reads never expire Actions. Persisted `status` remains historical workflow state.

### Bounded reads

`concept_latest_market_states`, `concept_latest_gap_states` and `concept_latest_drift_states` are
service-role-only SQL functions (`DISTINCT ON (anchor_concept_key) … ORDER BY sequence DESC`,
capped at 500 concepts = `DEMAND_CLUSTERING_MAX_EVALUATIONS`); they replace the uncapped 9C batch
lookups flagged in the 9C gate. Open concept Actions: limit 500. Episode history: limit 100.
Positioning: one row. Monitoring start: one row. New proposals (creations + supersession
replacements): at most 5 per pass, ordered by opportunity (gap score / |share delta|) then concept
key; deferred work is picked up by the next pass.

### Generation triggers, plan and flags

One writer, `generateActionsForScan`: plan gate (`actions_enabled`) first, then — only with
`DOWNSTREAM_INTELLIGENCE_V2_ENABLED=true` and `CONCEPT_ACTIONS_ENABLED=true` — the concept
reconciliation/generation pass. It runs after the existing full-scan rebuild and, new in Layer 10,
after a 2D incremental rebuild that materialized new signals. No provider or LLM calls; retries are
safe through the RPC idempotency. `CONCEPT_ACTIONS_ENABLED` remains the only generation flag;
approve/start revalidation is always on (safety, not a feature). `actions_enabled` gates
generation, approve and start only. No plan or pricing change.

### Provenance, digests, LLM, Layer 11

Action → `triggered_by` → gap/drift state → `derived_from_market_state` → market state →
cluster states / memberships → evaluations → conversations → source items; Gap adds
`uses_positioning`, Drift adds window-member edges. Layer 10 adds `revalidated_by` (carried-forward
basis) and `supersedes_action` edges. Digests exclude expired Actions. No LLM is used; Action
variants (and the CRM-copy fixture variant engine) remain deferred debt. Layer 10 records only
proposal/approval/start/completion/dismissal/expiry/supersession facts, actors, timestamps,
`executionMode = "manual"` and an optional note; experiments, measurement and outcome
intelligence are Layer 11.

### Migration

`20261018000000_actions_lifecycle_v1.sql`, additive only: `expired` status; `expired`/`revalidated`
event types; the two columns and identity check; the extended `validate_action_trigger()` and
immutability trigger; the one-open partial unique index; `create_concept_action`,
`transition_action`, `assert_concept_action_basis_guard` and the three latest-state functions, all
revoked from `public`/`anon`/`authenticated` and granted to `service_role` only. Existing rows and
legacy trigger types are preserved.

### Production proof limitations

Production has one Free-plan workspace (`actions_enabled=false`), zero Actions, zero current
contributing evidence and `CONCEPT_ACTIONS_ENABLED` off. Layer 10 is therefore proven structurally:
schema/constraint/function/grant verification, authorization rejection, Free-plan safe
non-generation with zero Action writes, read-only selector evaluation of the real 9C basis, deployed
code/flag verification, plus deterministic and real-Postgres tests. A paid preview E2E is desirable
only if an approved environment already exists; no paid branch is created, no entitlement changed,
no plan gate bypassed. Recorded as pending, not fabricated: LIVE PAID CONCEPT ACTION CREATION —
UNREACHABLE_BEHIND_PLAN_GATE; LIVE APPROVE / START / COMPLETE — AWAITING ELIGIBLE PAID REAL CASE;
live expiry/continuity/supersession, natural scored Gap, comparable Drift, live `basisStatus=valid`
— AWAITING_NATURAL_EVIDENCE; cross-workspace live case — UNAVAILABLE.

### LAYER 10 COMPLETE means

Security defect fixed; generic concept Action proposal pipeline; bounded generation; one-open
semantic proposal continuity; atomic supersession; live read-model basis status; human
approve/start/complete lifecycle with revalidation at approve and start; expiry; audit;
idempotency; incremental matching path included; legacy v2 safety preserved; migration, code and
tests green; structural production proof recorded — without fabricating a paid entitlement,
natural evidence or a live production Action.

## 22. Layer 10 — Production proof and closeout

Production validation completed 25 Sep 2026.

### Release records

- Architecture commit: `d17204628ce4aecf747f7236eb9a57ddf88a6451`
- Implementation commit: `77be4c94ec0f98f09a0353002b7949f199d191ea` (pushed to `main` as a normal
  fast-forward `9968224..77be4c9`).
- Migration: `20261018000000_actions_lifecycle_v1.sql` (file sha256
  `f3a88b3f09ce2993a1acf1b9608cf5c6f50e9530dcd436f042e1a28b51b968a6`).
- Vercel production: `dpl_cpjMCYJbgSE86KfXU7msLqEJBEeD`, built from `77be4c9…`, READY, serving
  `app.wanterest.com`.
- Trigger production: version `20260925.11`, deploy `08xkfcla`, deployed with
  `trigger.dev@4.6.4 deploy --env prod --external-id 77be4c94ec0f98f09a0353002b7949f199d191ea`.
  Current prod worker `20260925.11` (SDK 4.6.4) registers `generate-product-actions` and
  `match-refreshed-partition`. The Trigger API available during validation could not read the
  external-id back without the project secret key; the exact implementation SHA was supplied as the
  deploy external-id and the deploy list shows the implementation commit message.
- `/api/health`: `status=ok`, `liveness=ok`, `readiness=ok`.

### Migration

Production history was verified before apply: latest applied `20261017000000_concept_market_state_v1`,
only pending `20261018000000_actions_lifecycle_v1`, no gaps. The Supabase CLI was not available in
the validation environment. The committed migration file was applied unchanged in one production
transaction, and the migration history row `20261018000000 / actions_lifecycle_v1` was written
manually in the same transaction. Its `statements` field contains a short line identifying the
migration file, its hash and the implementation commit rather than the full SQL text.

**Operational follow-up (not a Layer 10 blocker):** before the next production migration, run a real
`supabase migration list` and verify repository/remote history still align on version
`20261018000000`. Do not rewrite the migration or its history.

### Flags and entitlement (unchanged)

- Trigger production: `DOWNSTREAM_INTELLIGENCE_V2_ENABLED=true`; `CONCEPT_ACTIONS_ENABLED` absent.
- Vercel production: `CONCEPT_ACTIONS_ENABLED` absent; `DOWNSTREAM_INTELLIGENCE_V2_ENABLED` present
  (the encrypted value was not read directly during validation).
- Production workspace: `plan=free`, `actions_enabled=false`. Nothing was changed.

### Live schema and function proof

- `actions`: `expired` accepted; `trigger_clustering_version` and `proposal_fingerprint` exist and
  are nullable for legacy compatibility; `actions_concept_identity_check` requires canonical concept
  identity and a sha256-hex `proposal_fingerprint` for `concept_gap`/`concept_drift` and keeps both
  null for legacy trigger types; both fields are immutable generated fields.
- `actions_one_open_concept_action` is enforced on `(workspace_id, product_id,
  trigger_clustering_version, trigger_concept_key)` for open concept Actions and intentionally does
  not include `trigger_type`: Gap and Drift compete for one canonical open Action slot per concept.
- `action_events` accepts `expired` and `revalidated`.
- `validate_action_trigger()` verifies concept basis identity (workspace, product,
  clustering_version, anchor_concept_key; `action_concept_identity_mismatch`); all four legacy
  trigger branches remain present.
- `create_concept_action`, `transition_action`, `assert_concept_action_basis_guard`,
  `concept_latest_market_states`, `concept_latest_gap_states`, `concept_latest_drift_states` are
  live. Execute: public DENIED, anon DENIED, authenticated DENIED, service_role EXECUTE. None of
  these functions is `SECURITY DEFINER`.

### Security / IDOR

The previous service-role IDOR is removed. Browser Action transitions accept only `actionId`,
`toStatus` and an optional `note`; the input schema is strict and a browser-supplied `workspaceId`
is rejected. Server order: require user → load the Action through the user's RLS-scoped client →
derive `workspace_id`/`product_id` from that row → verify active membership → verify role → plan /
selector / revalidation checks → only then the service-role RPC. Read: viewer/member/admin/owner
through normal workspace access. Mutation: viewer FORBIDDEN; member/admin/owner eligible for valid
human transitions. System expiry/supersession is server-owned only.

Live: logged-out `/app/actions`, `/app` and `/app/insights/gap` redirect to `/login`; a forged
server-action request including `workspaceId` returns 404. AUTHENTICATED MADE-UP ACTION ID: LIVE CASE
UNAVAILABLE and LIVE CROSS-WORKSPACE ACTION ID: UNAVAILABLE (0 Actions; the validator could not sign
in) — covered by deterministic tests and the real-Postgres suite; no rows were fabricated.

### Production baseline (21:44 UTC) and zero-write proof

| Table | Before | After (~21:50 UTC) |
| --- | ---: | ---: |
| actions | 0 | 0 |
| action_events | 0 | 0 |
| audit_log | 4 | 4 |
| concept_market_states / gap / drift | 1 / 1 / 3 | 1 / 1 / 3 |
| usage_ledger (`action_generated`) | 0 | 0 |
| evidence_nodes | 7120 | 7120 |
| evidence_provenance | 14494 | 14494 |
| raw_source_items | 230 | 230 |
| product_match_evaluations | 180 | 180 |
| job_runs | 1010 | 1010 |
| demand_cluster_states | 1 | 1 |
| signals | 10 | 10 |

`job_runs` created since 21:40 UTC: 0. Production validation caused no Action-system writes and no
9C state changes from Action reads.

### Free-plan Action generation

One normal `generate-product-actions` production invocation was attempted, with no bypass. The
platform safety classifier blocked it as a shared-production-resource change; the block was
respected, no workaround was attempted, and it was not retried. **LIVE ACTION GENERATION:
UNREACHABLE_BEHIND_PLAN_GATE (not invoked)** — supported by `plan=free`, `actions_enabled=false`,
`CONCEPT_ACTIONS_ENABLED` absent. No Action was generated; no entitlement was changed.

### Canonical selector on the real 9C basis

Production concept `jira`: latest market state sequence 1 with 0 current evidence; latest Gap
`no_current_demand` with a product snapshot equal to `current_snapshot_id`; Drift 7d/30d/90d all
`comparable=false` (`insufficient_history`), each linked to the latest market state. The persisted
member set was rebuilt from 9C provenance and its recomputed market fingerprint matched the stored
fingerprint exactly. The deployed selector code was run read-only against these exact rows:
`state=settled, candidate=null, reason=no_eligible_basis` — Gap cannot become an Action, Drift
cannot become an Action, no legacy fallback occurs.

Limitation: `DemandCurrentnessService` could not be executed directly against production (the
validation environment had no service-role credentials). Had live currentness differed from the
persisted fingerprint, the selector returns `pending(currentness)`, which is also non-actionable and
writes nothing. No direct deployed-service currentness invocation is claimed.

### Materialization-lag safety, cross-type selection, continuity

- The deployed selector implements `pending(currentness)`, `pending(gap_materialization)`,
  `pending(drift_materialization)`, `pending(positioning)` and
  `pending(clustering_version_unsupported)`. Pending never creates, expires or supersedes an Action
  and never falls back from Gap to Drift. An unchanged Drift window is distinguished from missing
  materialization by reproducing its fingerprint through the same shared function 9C uses. No
  positive production lag case was fabricated; tests cover every pending branch.
- One exported selector is used by generation, reconciliation, list, detail, approve and start.
  Priority: eligible scored Gap, otherwise eligible Drift (strong before notable, then 7d, 30d,
  90d, then id). Positive live Drift→Gap, Gap→Drift, Gap→Gap and Drift→Drift cases:
  AWAITING_NATURAL_EVIDENCE (covered by deterministic and database tests).
- Continuity: same `proposal_fingerprint` → keep the Action, add `revalidated_by`, one idempotent
  `revalidated` event per new basis. Different fingerprint → proposed/approved atomically
  superseded with a replacement; in_progress never auto-superseded (`proposalCurrent=false`, no
  second open Action until the human work closes). No canonical candidate → proposed/approved
  expired, in_progress unchanged. A superseded Action is never committed without a resolvable
  replacement.

### Idempotency and atomic RPCs

Concept Action creation key: `action:{product}:{trigger_type}:{basis_state_id}:{engine}:{proposal_fingerprint}`.
This intentionally differs from the earlier architecture draft: a semantically changed proposal
can occur on an unchanged basis row (for example after a deterministic proposal input such as the
product name changes); without the fingerprint in the key, that change would resolve back to the
previous Action instead of superseding it. The key is replay-stable; legacy keys are unchanged;
tests cover it.

`create_concept_action` locks the old Action on supersession, advisory-locks the creation key,
resolves any existing row first by `(workspace_id, idempotency_key)`, checks the basis guard,
compare-and-sets the old status, supersedes it, inserts the evidence node and new Action atomically,
sets `superseded_by_action_id`, writes `triggered_by`/`supersedes_action` provenance and the
events, and consumes usage exactly once; any failure rolls back the whole operation. Replay
correctness depends on `workspace_id + idempotency_key`, not on a caller UUID. `transition_action`
compare-and-sets status, validates the lifecycle, checks the basis guard for approve/start, and
writes the Action event and (for users) the audit event in the same transaction.

### Bounded reads — 9C warning RESOLVED

The active concept Action path no longer performs unbounded all-history batch reads; it uses the
bounded SQL functions. Limits (database-side, not fetch-all-then-truncate): latest market / gap /
drift concepts 500 each, open concept Actions 500, episode-break history 100, new/replacement
proposals 5 per pass. A live request with a very high requested limit returned only the one existing
concept. The earlier Layer 9C `ConceptActionService` unbounded-read warning is **RESOLVED**.

### Empty read model, legacy safety, incremental path

- With 0 Actions the list loader returns early: no currentness, concept-state or entitlement read,
  no writes, no provider or LLM calls.
- With `DOWNSTREAM_INTELLIGENCE_V2_ENABLED=true`, automatic legacy generation from `demand_gap`,
  `demand_drift`, `demand_snapshot` and geography stays paused; Layer 10 does not reopen it; legacy
  schema compatibility is preserved.
- Worker `20260925.11` runs the Layer 10 Action pass after a successful 2D incremental rebuild via
  the same `generateActionsForScan` (no second writer), behind the plan gate and
  `CONCEPT_ACTIONS_ENABLED`, non-fatal to the rebuild. No production demand was manufactured to
  exercise it.

### Side effects and frozen systems

No discovery, provider retrieval, candidate selection, qualification or LLM call ran because of
Layer 10 validation. The only Trigger runs in the window were the unrelated scheduled
`automatic-monitoring-scheduler` and `monitoring-notification-delivery`, both still on version
`20260925.10`.

Layer 10 did not change the semantics of Stage 2G clustering or strengthening, the 9A Map, 9B
Gap/Drift, `DemandCurrentnessService`, 9C market-state semantics, 9D Geography, query planning,
retrieval precision, source health, candidate selection, qualification thresholds, providers,
signal lifecycle writes, plans, pricing or entitlements. The only 9C refactor made the Drift
fingerprint one exported shared function used by 9C materialization and the Layer 10 lag check;
all three production Drift-state fingerprints recomputed through it match the stored values
exactly, and every Layer 9 regression remains green.

### Test proof

Full suite 1090 passed / 9 skipped / 0 failed; typecheck, lint and `next build` pass. New suites:
canonical selector, concept Action service, lifecycle, bounded reads, migration contract,
incremental integration, digest expiry. Real PostgreSQL 16 (opt-in via `WANTEREST_PG_TEST_HOST`):
all 32 migrations applied, 51 SQL checks passed, three two-session concurrency scenarios passed.

### Manual signed-in UI

**MANUAL_SIGNED_IN_UI_CHECK: PASSED.** The production owner verified
`https://app.wanterest.com/app/actions`: the page loads; the no-qualified-action state renders and
reports that scanned conversations did not meet the current demand threshold; the preview card
("Make [your differentiator] explicit") is visible and is clearly example content, not a persisted
Action; nothing claims Wanterest executed anything. No live Action was fabricated for UI proof.

### Pending live cases (not blockers, not manufactured)

- LIVE PAID CONCEPT ACTION CREATION: UNREACHABLE_BEHIND_PLAN_GATE
- LIVE FREE-PLAN GENERATION RUN: UNREACHABLE_BEHIND_PLAN_GATE (not invoked)
- LIVE APPROVE / START / COMPLETE: AWAITING ELIGIBLE PAID REAL CASE
- LIVE EXPIRY / CONTINUITY / SUPERSESSION: AWAITING ELIGIBLE PAID REAL CASE / NATURAL EVIDENCE
- LIVE basisStatus=valid: AWAITING_NATURAL_EVIDENCE
- LIVE CROSS-WORKSPACE ACTION: UNAVAILABLE
- POSITIVE LIVE CROSS-TYPE GAP/DRIFT REPLACEMENT: AWAITING_NATURAL_EVIDENCE

### Verdict

**LAYER 10 CORE ACTION ARCHITECTURE: PRODUCTION_PROVEN.**

**CONCEPT_ACTIONS_ENABLED: FALSE / NOT ENABLED IN PRODUCTION.**

**LAYER 10: COMPLETE.**

Wanterest Layer 10 currently provides a production-proven, provenance-backed, lifecycle-safe Action
proposal system with human-controlled manual execution semantics. This verdict does not mean that
live paid Action creation or human execution has occurred in production; those cases remain pending
exactly as listed above. No Layer 11 is started.

## 23. Layer 11 — Experiments / Measurement (`experiment_measurement_v1`)

Architecture decision (approved after one review and one final amendment). Layer 11 answers "what
happened after a verified Action, and how strong is the evidence that the Action contributed?"
without collapsing *after* into *because of*. It builds on the Layer 10 Action lifecycle and never
feeds back into Layer 9/10 (Layer 12 territory).

### Vocabulary

- **Experiment** — a pre-registered measurement of one human intervention (one Layer 10 Action)
  under a frozen contract. The existing `experiments` row carries the frozen **measurement plan**
  (no separate plan table).
- **Observation** — a measured value: `experiment_events` for controlled splits (first-party public
  event API), the new append-only `experiment_observations` for before/after, manual and internal
  context values.
- **Outcome** — an append-only `experiment_results` revision computed deterministically from the
  frozen plan and the current non-superseded observations.

Five statements are kept distinct: the Action was executed; a metric changed after execution; the
change is associated with the Action; a randomized comparison met a pre-registered threshold; there
is not enough evidence. No Layer 11 v1 output claims causality, validation or significance.

### Designs

New measurement-v1 experiments are either `controlled_split` (concurrent randomized control and
treatment through the existing deterministic assignment + public event machinery) or
`before_after` (one metric, frozen baseline window before treatment, measurement window after
treatment, no control). A baseline-free "observational experiment" is not allowed; `descriptive` is
an attribution/read label only (legacy results, or inconclusive outcomes with an observed value).

### Measurement plan (frozen)

`measurement_policy_version = experiment_measurement_v1`, `evidence_design`, one `primary_metric`,
`metric_source` (`experiment_events` | `manual`), `metric_label`/`metric_unit` (for
`manual_custom`), `measurement_window` (`7d`|`30d`|`90d`, the existing demand windows),
`washout_days` (0–14), `success_criterion` (`direction` increase|decrease, `measure`
absolute_delta|relative_delta, human-supplied `minimumEffect > 0`, and for controlled splits a
human-supplied `minSamplePerArm ≥ 1`; no system defaults), the structured hypothesis
(`experiment_hypothesis_v1`: actionId, proposalFingerprint, clusteringVersion, anchorConceptKey,
actionType, targetKey, intervention, primaryMetric, expectedDirection, measurementWindow,
washoutDays, successCriterion, hypothesisVersion — the sentence is derived from it),
`treatment_action_id` + `treatment_proposal_fingerprint`, and `measurement_plan_fingerprint`. A DB
trigger freezes every plan field once the experiment leaves `draft`; a materially different plan
means cancel before treatment and create a new experiment.

### Metrics

One pre-registered primary metric. Controlled: the six first-party conversion keys through
`experiment_events`. Before/after: the same six keys as manual count/rate values, or
`manual_custom` with a required label and unit (count|rate|currency). Manual metrics are labelled
`manual` everywhere and are capped at `before_after_association`. Wanterest market intelligence
(evidence count, share, gap, drift) is recorded only as `wanterest_internal` **context** and never
drives the outcome. No connector metrics exist in v1.

### Baseline and window

Before/after baseline window: the L days ending at the UTC day boundary of registration
(`[floor_day(registered_at) − L, floor_day(registered_at))`), L = measurement window; the manual
baseline observation for exactly that window must exist before `draft → ready`
(`mark_experiment_ready` enforces it). Controlled splits need no baseline — the concurrent control
arm is the comparator. Measurement window: `[treatment_started_at + washout, + L)`, UTC, frozen at
treatment start. A manual measurement aggregate is accepted only after the window closes, within a
7-day grace period (the window itself never moves). A zero baseline for a relative criterion or a
zero denominator yields `inconclusive(insufficient_baseline | zero_denominator)`; no minimum manual
sample is invented.

### Action integration

- Experiments are created only from an **approved** Action, under Layer 10 revalidation (RLS-
  visible Action, membership, role, `actions_enabled`, `experiments_max`, canonical selector
  settled with a candidate, `proposalCurrent`, matching proposal fingerprint, basis guard current).
- **One canonical start path.** Every `approved → in_progress` still goes through Layer 10's
  `transition_action`, now with `p_experiment_starts_allowed boolean default false` (the app passes
  `EXPERIMENT_MEASUREMENT_ENABLED`), stored as the transaction-local setting
  `wanterest.experiment_starts_allowed`. The trigger `actions_reconcile_experiments` (AFTER UPDATE
  OF status on `actions`, v1 experiments only) locks the Action's non-terminal experiment and
  branches: none → normal start; `draft` → canceled `treatment_started_before_registration`;
  `ready` + allowed → `running` with `treatment_started_at = started_at = transaction timestamp`
  (equal to the Action's `started` event); `ready` + not allowed → canceled
  `measurement_disabled_at_treatment`; `running`/`paused` → `experiment_state_conflict`, whole start
  rolls back. The default is closed.
- **Close reconciliation (same trigger, same transaction, every writer incl. `create_concept_action`
  supersession):** proposed/approved → dismissed/expired/superseded cancels a draft/ready experiment
  (`action_closed_before_treatment`, never rebound); in_progress → dismissed cancels the running
  experiment (`treatment_abandoned`, outcome `invalid`); in_progress → completed does not complete
  the experiment. A recommendation that goes stale after treatment cannot close an in_progress
  Action (Layer 10), so the running experiment stays tied to the original Action.
- **Treatment integrity:** `unconfirmed` (Action in progress), `confirmed` (Action completed with the
  required `liveSince` completion metadata, validated in `transition_action` to lie within
  `[treatment_started_at, measurement_end)`), `verified_exposure` (controlled treatment-arm
  exposure). Attribution is capped by integrity; `approved` never counts as treated.
- **One experiment per Action:** partial unique index (one non-terminal) plus the BEFORE INSERT
  trigger `experiments_enforce_action_rule`, which locks the Action, requires `approved`, and allows
  a new experiment only if every earlier one never reached treatment and was closed by the user as
  `canceled_before_treatment`. Once any experiment reached treatment, the Action can never get
  another.

### Controlled event semantics

Events are tied to the subject's one assignment by a composite FK
`(workspace_id, experiment_id, assignment_id, variant_id, subject_key_hash)`; external-id
idempotency is unchanged. v1 events are accepted only while `running` and with `occurred_at` in
`[treatment_started_at, measurement_end)`. Per arm, within the frozen window, computed in SQL:
denominator = distinct subjects with an exposure; numerator = those subjects with ≥ 1 primary-metric
conversion in the same variant at or after their exposure. Duplicates count once; conversions
without or before exposure count zero. Any window day without exposure makes the data `partial`.

### Outcome (`experiment_outcome_v1`, deterministic, no LLM)

Outcomes: `positive | negative | neutral | inconclusive | invalid`, separate from lifecycle.
Invalid/inconclusive rules apply first (treatment abandoned → invalid; missing/insufficient
baseline, missing observation after grace, window interrupted, sample below the pre-registered
minimum, treatment unconfirmed or not live for the full window, zero denominator, effect not
computable, partial/missing data → inconclusive with every applicable reason). Otherwise effect =
observed − baseline (or relative), controlled = treatment rate − control rate (or relative):
expected direction and `|effect| ≥ minimumEffect` → positive; opposite direction and
`|effect| ≥ minimumEffect` → negative; else neutral. Attribution: `none`, `descriptive`,
`before_after_association` (frozen baseline + complete measurement + confirmed treatment; manual
maximum), `controlled_comparison` (randomized, complete, both arms ≥ `minSamplePerArm`, verified
exposure). Controlled copy: "Observed randomized comparison met / did not meet the pre-registered
effect threshold." plus "Not statistically tested."; per-arm exposed/converted/rate are always
shown. No p-values, significance, confidence intervals, "winner", "lift" or causal wording.

### Lifecycle, pause, flag

Lifecycle stays `draft → ready → running → completed | canceled` (`paused` kept for legacy only;
v1 `running → paused` raises `experiment_pause_not_supported`; stopping early = cancel →
`inconclusive(window_interrupted)`). `closed_reason`: `canceled_before_treatment`,
`treatment_started_before_registration`, `measurement_disabled_at_treatment`,
`action_closed_before_treatment`, `treatment_abandoned`, `window_elapsed`, `stopped_early`.
`EXPERIMENT_MEASUREMENT_ENABLED` (default off) blocks only **new work**: create, draft edits, mark
ready, and starting a ready experiment's treatment (canceled `measurement_disabled_at_treatment`;
the Action still starts). It never blocks **draining**: public events and manual measurement
observations for already-running experiments, and the measurement pass, keep working, so a
rollback cannot turn a collection gap into a positive/negative (gaps → inconclusive).

### Writes, audit, history, provenance

All writes go through service-role-only RPCs (`create_experiment`, `update_experiment_draft`,
`add_experiment_variant`, `mark_experiment_ready`, `cancel_experiment`,
`record_experiment_observation`, `issue_experiment_token`, `revoke_experiment_token`,
`finalize_experiment_outcome`) after the Layer 10 authorization pattern (RLS load → derive scope →
membership → role). User mutations write `audit_log` atomically; idempotent replays write nothing.
Every experiment status change writes one append-only `experiment_transitions` row (system actor for
automatic changes). Creation is atomic with usage (`experiment_created`), evidence node,
`derived_from_action` provenance, audit and the creation transition (idempotency key
`experiment:{action_id}:{measurement_plan_fingerprint}`; no compensating delete). Observations are
append-only with `supersedes_observation_id` corrections; results are append-only revisions keyed
by `input_fingerprint` with a `current_result_id` pointer. A revision is a historical reading of the inputs available at the time: when an outcome-relevant input changes after a result (late Action completion with a valid `liveSince`, a manual observation correction), the same transaction sets `experiments.outcome_recompute_requested_at`; the measurement pass picks up only marked rows (partial index, ≤ 50), appends a new revision when the fingerprint differs (never reopening the frozen window), and compare-and-clears the marker it read. Provenance: result → `measures_experiment`
→ experiment; result → `uses_observation` → observation; context observation → `context_from` →
concept state.

### Scheduler, bounds, isolation

One daily Trigger task, `experiment-measurement-pass`, is the single automatic writer: at most 50
due experiments per run (oldest `measurement_end` first; controlled splits finalize one day after
the window to absorb the existing 24-hour event lag, before/after after the observation arrives or
the 7-day grace expires; canceled-after-treatment experiments get their invalid/inconclusive
revision), one context snapshot, outcome append only on a new fingerprint, finalization. It runs
regardless of the flag (draining), makes no provider or LLM calls. Bounds: 200 observations and 100
result revisions per experiment, 100 listed experiments, SQL-side controlled aggregates. Layer 11
never feeds outcomes into query planning, candidate selection, qualification, Gap/Drift scoring,
Action eligibility/ranking/thresholds, source selection or retrieval. Outcomes are
workspace/product-private.

### Security fixes carried by Layer 11

Every experiment mutation command previously trusted a browser `workspaceId` with the service role;
all are replaced by the Layer 10 authorization pattern (viewer read-only; member/admin/owner
mutate). `revokePublicToken` mutated before checking the workspace; revoke is now scoped inside the
same UPDATE. Service-role list queries are scoped through RLS-resolved context and capped.

### Production proof limitations and completion

Production is Free (`experiments_max = 0`, `actions_enabled = false`), with 0 Actions and 0
experiments; no live experiment is fabricated. Structural proof: migration-list precheck, migration,
schema/trigger/grant/RLS verification, deployment at one SHA, security rejection, Free-plan gating,
the natural scheduled pass doing zero work with zero writes, zero-write counts, no provider/LLM side
effects, frozen systems intact, relabelled UI confirmed. Live experiment creation, before/after and
controlled outcomes, manual observation and treatment integrity remain
UNREACHABLE_BEHIND_PLAN_GATE / AWAITING ELIGIBLE PAID REAL CASE.

**LAYER 11 COMPLETE means:** secure experiment lifecycle (IDOR class and token bug fixed);
pre-registered immutable plan; baseline frozen before treatment; one canonical Action start path
with atomic experiment start; Action-close reconciliation in the database; treatment integrity;
observation provenance with manual labelling and caps; deterministic outcomes with inconclusive and
invalid first-class; capped attribution and no unjustified causal/statistical wording; bounded,
idempotent single-writer measurement pass; append-only results, observations and transitions;
audit; Layer 12 isolation; migration, code and tests green (including real Postgres); structural
production proof recorded — without requiring natural production outcomes.

## 24. Layer 12A — Low-Cost Signal Supply Engine

Approved architecture: more real, cheap, globally reusable public evidence into the existing
pipeline without changing any downstream semantics. Frozen throughout 12A: `query_planning_v7`,
Retrieval Precision V1, Source Health V1, `candidate_selection_v3`, `maxEvaluations = 15`,
`signal_qualification_v1_7` and its thresholds, `semantic_reasoning_router_v1`, read-first, signal
lifecycle, durable clustering, Map/Gap/Drift/Geography, Actions and Experiments. X is optional and
never required; Reddit is not a dependency. Phases: 12A.1 telemetry → 12A.2 planner-seeded shared
partitions → 12A.3 low-cost sources → 12A.4 cross-product routing + candidate backlog → 12A.5
adaptive allocator → 12A.6 natural production yield validation.

### 12A.1 — Signal Supply Telemetry V1 (`signal_supply_telemetry_v1`) — IMPLEMENTED_LOCALLY

Observational only. Flag `SIGNAL_SUPPLY_TELEMETRY_ENABLED` (default off; Trigger): off = zero
telemetry reads/writes and no behaviour change; on = facts are recorded, nothing else changes.

- **`supply_refresh_facts`** (migration `20261020000000`): one immutable row per
  `refresh-market-partition` job (`job_run_id` unique; a trigger requires a global refresh job).
  Global public-market operational data, RLS on with no policy: service role only.
- **`product_supply_facts`**: one immutable row per `match-product-incremental` job
  (`job_run_id` unique; `(refresh_job_run_id, product_id)` unique; composite FK to
  `products(workspace_id, id)`; a trigger requires the job's own workspace/product). Tenant-private:
  workspace-member `select` RLS; no browser writes.
- **Writers**: the refresh service and incremental matching record a fact *after* their job row is
  finalized, from values the job already computed (plus one bounded ≤500-id `conversations` lookup
  for the new/reused canonical split, only while the flag is on). Best-effort: a telemetry failure is
  swallowed and never changes an outcome, refresh state or cadence. Replays insert-or-ignore on the
  job identity (never `+=`); rows are immutable (update trigger). Only terminal outcomes with
  measured counts are recorded: refresh `succeeded` / `failed` (after ingestion) / `deferred`;
  product jobs `succeeded`. Replayed slots write nothing.
- **Costs** carry an explicit unit (`usd`, `quota_units`, `requests`, `unknown`); a value exists
  exactly when the unit is known (X = usd, YouTube = quota units, otherwise unknown). Units are never
  converted or summed together.
- **Authoritative sources** (facts are normalized copies, never a second truth): refresh counts ←
  the refresh job's `input_reference.result`; new canonical ← `conversations.created_at` ≥ the refresh
  job's `started_at` over that job's conversation ids (a conversation first created concurrently by
  another writer inside that window also counts as new); product counts ← the product job's
  `input_reference`; weak/rejected/qualified ← that job's candidate outcomes; clusters created and
  memberships created ← the job's demand-rebuild clustering result (0 when no rebuild ran, null when
  not observable); reasoning calls/cost ← the semantic-reasoning shadow summary.
- **`signal_supply_funnel(since, until, workspace?, product?)`**: security invoker, service role
  only, window required and ≤ 31 days, bounded group outputs. Returns refresh funnels by source and
  partition (raw, raw_new, normalized, unique, new/reused canonical, provider requests, duplicate
  rate = (raw − raw_new) / raw), product funnels (routed, already matched, candidates, overflow,
  selected, evaluated, weak, rejected, qualified, materialized, clusters created, memberships,
  selection and qualification rates), costs grouped by unit, and qualified evidence.
- **Qualified evidence item (gross)**: one distinct `(workspace_id, product_id, conversation_id)`
  whose *first* `product_match_evaluations` row with `decision = 'qualified'` falls in the window,
  excluding `fixture` sources. Re-qualification, replays, weak/rejected and duplicate canonical
  conversations never count. Computed from existing evaluations (new partial indexes), covering
  every intake path (scans and incremental matching).
- **Deferred (not measured in 12A.1)**: net qualified (signal invalidation reasons are not
  unambiguously "false positive"), clusters strengthened and cluster-strengthening rate (the frozen
  clustering result exposes created clusters and memberships only), surface and concept dimensions
  (12A.2 seeds), provider cost for product scans (existing `query_yield_artifacts.estimated_cost_usd`
  is unit-ambiguous for YouTube), and a refresh whose discovery threw (counts unknown).
- **Rollout**: migration dry-run → apply → schema verification → deploy with the flag off (prove no
  behaviour change) → enable → reconcile facts with `job_runs` and evaluations on natural jobs →
  first 24h funnel → only then 12A.2.

### 12A.2 — Planner-Seeded Shared Partitions (`supply_partition_seeding_v1`) — IMPLEMENTED_LOCALLY

Flag `SUPPLY_PARTITION_SEEDING_ENABLED` (default off; Vercel and Trigger, because product scans run in
both). Off = no seed or scan interest is written, no explicit-interest read happens anywhere, and the
scan, scheduler and incremental matching run exactly their pre-12A.2 code paths. On = the behaviour
below. Seeding itself makes no provider request and no model call; `market_partition_identity_v1`,
`query_planning_v7` output and every frozen 12A system are unchanged.

- **Seed source**: `buildQueryPlanSeedCandidates` returns the planner's *own* candidates
  (`buildCandidates` → the same low-confidence filter → the same duplicate/diversity suppression,
  without the per-source query-count cap) mapped through the same `toPlanQuery` as the plan.
  `buildQueryPlan` is untouched in behaviour: a golden digest of 120 planner inputs
  (`tests/fixtures/query-planning-v7-golden.json`, captured at `241ae56`) proves byte-identical
  output. No free-form query is ever invented.
- **Eligibility** (all required, deterministic, in planner order): source in the refresh allowlist
  (today `github`, `stack-exchange`; X/YouTube/HN/Bluesky/Discourse/Forem stay excluded); query not
  executed by this scan; identity derived from the exact request execution would send
  (`toSourceDiscoveryRequest`, plus Stack Exchange preparation exactly as ingestion applies it);
  the spec round-trips through `buildMarketPartitionRefreshRequest` to the same key (a spec the
  scheduler would disable is never seeded); partition not already executed by this scan; a valid
  canonical provenance template for its own query id and source; per-product per-source cap.
  Duplicate candidates collapse onto one partition key.
- **Bounds**: ≤ 6 seeds per product per source (app and DB), ≤ 60 distinct seed-kept partitions per
  source globally (DB, under a per-source advisory lock so concurrent scans cannot overshoot). The
  existing rolling-24h refresh caps (GitHub 120, Stack Exchange 60) and adaptive cadence remain the
  hard spend bound; seeds only become background refreshes inside them.
- **`market_partition_interests`** (migration `20261021000000`): one row per
  `(workspace_id, product_id, market_partition_id)`; origin `scan` | `planner_seed`; the origin scan
  job (trigger: same workspace/product); `query_plan_id` + **required** `provenance` (the canonical
  `DiscoveryProvenanceTemplate`; checks force `queryPlanId`/`source` to match the row and require
  family, surface, concepts, competitorSpecific), `seed_version` + descriptive `seed_metadata`
  (family, surface, intent, concepts, language — never identity), `renewed_at`, `expires_at`
  (≤ 31 days), `renewal_count`, `deactivated_at/_reason`. Composite FK to `products`, workspace-member
  select RLS, no browser writes; global partition/spec stay service-role only. Newly created
  interests therefore cannot be `provenance_missing`; historical `query_yield_artifacts` without
  provenance are not repaired and remain unsupported until a scan recreates them.
- **Writes**: `upsert_market_partition_interest` (security invoker, service role only), one
  transaction per interest: refuse inactive products; take the per-source lock; refuse seeds on
  retired partitions; enforce both caps for a new/expired seed; insert-or-ignore the immutable
  `market_partitions` row (seeds only — a scan interest attaches only to a partition its ingestion
  already created); create or renew the single interest row. Scan origin outranks seed: a seed renewal
  only extends a scan interest's expiry, never replaces its provenance. The scan calls this after its
  query-yield rows are persisted (scan interests first, then seeds); every failure is contained and
  reported as a count in a `partition-seeding` diagnostic.
- **Lifecycle**: TTL = the existing 14-day interest window, renewed by each scan of an active product.
  Archiving a product deactivates its interests in the same transaction; an inactive product cannot
  create or renew; expired or deactivated interests stop routing and stop keeping partitions due;
  a later scan/seed of an active product renews or reactivates the same row.
- **Canonical read path**: `active_market_partition_interests(keys, now)` (unexpired, not deactivated,
  active products only). Incremental matching unions it with the legacy 14-day
  `query_yield_artifacts` interest and runs the *unchanged* `selectInterestedProducts` (same
  provenance validation, fanout cap 20, newest-first, job idempotency); the product job records
  `interestOrigin`. No concept-overlap routing (12A.4). The refresh scheduler treats a partition with
  an active explicit interest as interested; the recent-scan exclusion, daily caps and cadence are
  unchanged.
- **Retirement** (`retired_at`, `retired_reason` on `market_partition_refresh_state`; retired ⇒
  `enabled = false`, `disabled_reason = 'retired'`): `retire_exhausted_seed_partitions` runs at most 20
  per scheduler tick and retires a partition only if it has a seed interest, no live scan interest,
  no `query_yield_artifacts` in 30 days, `consecutive_zero_new ≥ 6`, **and** its last 6 refreshes all
  have 12A.1 `supply_refresh_facts` with `raw_new_count = 0` and zero qualified product facts. Missing
  telemetry never retires (fail closed). Retired partitions are never re-seeded; a product scan that
  executes the spec again reactivates it. Not the 12A.5 allocator.
- **Telemetry**: independent of 12A.1 being on; seeding never depends on a telemetry write. Seed
  dimensions are joinable (interest `origin`/`seed_metadata` by partition, `interestOrigin` on product
  jobs); 12A.1 schemas are unchanged.
- **Rollout**: migration dry-run → apply → schema/RLS verification → deploy flag off (prove zero
  interest rows and unchanged scheduler output) → enable in Vercel and Trigger → observe natural scans
  create bounded seeds/interests → first natural refresh of a seeded partition → incremental routing
  with valid provenance → 12A.1 facts for seeded partitions.

### 12A.3A — Hacker News Search v2 (`hacker_news_search_v2_1`) — IMPLEMENTED_LOCALLY

Approved architecture: replace Hacker News' only retrieval mechanism - an unparameterized
`/newstories.json` walk filtered client-side by bounded lexical anchors (`adapter_side_product_filter`;
no literal, faithfully-identity-able provider query exists) - with the public Hacker News Algolia
Search API as the primary query/search path, while keeping the official Firebase item API available
for hydration. Goal is coverage (more real market evidence through the same qualification), not yield
by relaxation: `query_planning_v7`, Retrieval Precision V1 (except Hacker News' own retrieval),
Source Health V1, `candidate_selection_v3`, `maxEvaluations = 15`, `signal_qualification_v1_7` and its
thresholds, `semantic_reasoning_router_v1`, `market_partition_identity_v1`'s algorithm/version, signal
lifecycle, clustering, Map/Gap/Drift/Geography, Actions, Experiments, 12A.1 telemetry semantics, 12A.2
interest/provenance semantics, and the GitHub/Stack Exchange adapters are all unchanged.

- **One canonical source identity, two retrieval implementations.** No new source key: `"hacker-news"`
  is preserved exactly (`HackerNewsSourceAdapter.key`), so evidence already ingested through the
  legacy path and evidence ingested through Search v2 canonicalize onto the same conversations/story
  ids - there is no duplicate Hacker News identity anywhere. `SourceDiscoveryRequest.requestMetadata.executionMode`
  distinguishes them per request (`"filtered_newstories_feed"` legacy, `"algolia_search_v2"` v2); the
  adapter itself never reads the flag, only this field, so a refresh-rebuilt request (which carries
  `executionMode` through the `market_partition_identity_v1` per-source param allowlist) reproduces the
  same path deterministically.
- **Flag** `HN_ALGOLIA_SEARCH_ENABLED` (default off; Vercel and Trigger, because scans run in both -
  same reason as `SUPPLY_PARTITION_SEEDING_ENABLED`). Off: `toSourceDiscoveryRequest`'s Hacker News
  branch is byte-identical to pre-12A.3A (same `executionMode`, `lexicalAnchors`, no `providerQuery`);
  `deriveMarketPartitionIdentity` still returns `adapter_side_product_filter` for it (see below), so no
  `market_partitions` row, no refresh/seed eligibility, and no new provider requests - matching the
  golden-digest discipline already proven for `query_planning_v7`/12A.2. On: the planner's own semantic
  query is sent as a literal `providerQuery`, Hacker News becomes market-partition-identity-eligible and
  flows through the *existing* 12A.2/2C pipeline unchanged - no new scheduler, no special-cased path.
- **Retrieval**: `GET https://hn.algolia.com/api/v1/search_by_date?query=...&tags=(story,comment)&numericFilters=created_at_i>X,created_at_i<Y&page=N&hitsPerPage=M`
  (recency-ordered, not relevance-only, per "prefer fresh, query-relevant results"; live contract
  verified 2026-09-26). Bounded: `hitsPerPage` ≤ 20, ≤ 3 pages per call, `request.limit` respected,
  deterministic `algolia-page:N` cursor. Freshness window: `request.windowStart`/`windowEnd` if the
  caller supplied them, else a default 14-day lookback - excluded from partition identity like every
  other source's window fields (documented existing imprecision, unchanged). Timeout + 2-attempt
  retry with backoff on `RATE_LIMITED`/`HTTP_5xx`/timeout, matching the existing Hacker News/Stack
  Exchange retry shape; dead/deleted/empty-text hits are dropped (Algolia's own index already excludes
  dead/deleted items; this adapter additionally drops any hit with no usable text). No LLM call
  anywhere in retrieval. The Firebase item API remains available for hydration but is not called in
  the common case: Algolia comment hits already carry `story_id` (the root), so thread association
  needs no extra request.
- **Story/comment canonicalization** (unchanged canonicalization code - Stage 2A `conversationIdentity()`):
  a story is its own conversation root; a matched comment resolves to `story_id` as
  `externalConversationId`, so every relevant comment from the same thread canonicalizes onto the one
  existing thread conversation - no duplicate canonical conversations, no unbounded comment-tree
  concatenation. The exact matched item id (comment or story), its parent id, thread URL, story URL,
  and `hacker_news_search_v2_1` are preserved on the `source_items`/evidence-node metadata so the
  specific match is never lost even though it rolls up to the thread.
- **`market_partition_identity_v1`** (algorithm/version unchanged; narrow, source-specific data change
  only, exactly the carve-out the frozen list names): `"hacker-news"` moves from
  `INELIGIBLE_REASON_BY_SOURCE` to `PARAM_ALLOWLIST` (`["executionMode"]`), but eligibility additionally
  requires `requestMetadata.providerQuery` to be a non-empty string - true only for Search v2 requests,
  never for the legacy path, so old-path requests remain exactly as ineligible as before with the same
  reason. This is a pure, request-shape check with no env/flag read inside the identity module.
- **Background refresh / seeding eligibility**: `MARKET_PARTITION_REFRESH_SOURCE_KEYS` gains
  `"hacker-news"` at the type level, but `isMarketPartitionRefreshSource` (the single function every
  call site - seeding, refresh-request rebuild, `listRefreshableMarketPartitions`'s live source list -
  now goes through) additionally requires `hnAlgoliaSearchEnabled()` for that one source, so a flag-off
  environment's scheduler/seeding behavior for every existing source is provably unaffected and Hacker
  News specifically never becomes seedable or refreshable. `MARKET_PARTITION_CADENCE_BY_SOURCE`/`MARKET_PARTITION_REFRESH_DAILY_CAP`/`SEED_MAX_PARTITIONS_PER_SOURCE`
  get a Hacker News entry as conservative as Stack Exchange's (24h/12h/7d cadence bounds, 60/day,
  60 seeded partitions/source) even though the public Algolia HN Search API is keyless and unmetered -
  a shared free resource still gets a bounded, respectful cadence, not GitHub's authenticated rate;
  GitHub and Stack Exchange's own caps are unchanged.
- **Provenance**: no schema change. `toSourceDiscoveryRequest` already stamps `queryPlanId`,
  `semanticQuery`, `queryFamily`, `demandSurface`, `competitorSpecific`, and `discoveryIntent`
  (→ `concepts`) unconditionally for every source before any per-source branch runs, so Hacker News
  inherits the same `discoveryProvenanceTemplateSchema`-valid provenance every other planner-driven
  source already gets - a newly seeded Hacker News interest cannot become `provenance_missing` for a
  reason specific to this source. Per-item provenance (matched item id, thread URL, story URL,
  `hacker_news_search_v2_1`) lives in `source_items`/evidence-node metadata, generically persisted by
  the unchanged ingestion pipeline.
- **Telemetry**: no `signal-supply-telemetry.ts` change. That module is already fully source-agnostic;
  Hacker News simply starts flowing through the same `supply_refresh_facts`/`product_supply_facts`
  writers as GitHub/Stack Exchange once it has a `refresh-market-partition` job. `providerCost("hacker-news", ...)`
  already returns `{ value: null, unit: "unknown" }` (absent from `PROVIDER_COST_UNIT_BY_SOURCE`,
  correct for a free/unmetered source) - never mixes USD, quota units, or request counts.
- **Migration**: none. `source_key` is a regex check (`^[a-z][a-z0-9_-]*$`) on every table that stores
  it, not an enum; `"hacker-news"` already satisfies it and already has rows. No new table, column, or
  constraint is required for this slice.
- **Source Health V1**: no module change. `classifySourceHealth`/`classifyExecution` branch purely on
  the `SourceAdapterError.code`/`executionStatus` values a request produces, never on source name; the
  new adapter path reuses the exact same codes (`RATE_LIMITED`, `HTTP_5xx`, `HTTP_4xx`,
  `MALFORMED_PROVIDER_PAYLOAD`, `REQUEST_FAILED`) the legacy path and every other adapter already use.
- **Rollout**: deploy flag off (prove old Hacker News behaviour, zero Hacker News `market_partitions`
  rows, unchanged scheduler output) → enable `HN_ALGOLIA_SEARCH_ENABLED` in Vercel and Trigger →
  observe one natural product scan retrieve through Search v2 → planner seeds bounded Hacker News
  partitions/interests with valid provenance → first natural seeded-partition refresh → incremental
  routing through the explicit interest with valid provenance and no cross-workspace leakage → 12A.1
  facts for the new Hacker News refresh/matching jobs → compare qualified evidence yield against the
  pre-12A.3A Hacker News baseline (evidence yield is the success measure, not raw hit count).

### 12A.3A.1 — Evidence Fidelity and Grounding Hardening (`evidence_grounding_v1`) — IMPLEMENTED_LOCALLY

**Invariant** (product-level, not a phase-specific rule): a Wanterest signal MUST NEVER claim more
than its source evidence supports. The Signal Fidelity / Evidence Grounding Audit traced every
overstated/misattributed production signal to one of three deterministic-classifier defects, not to a
missing LLM: (1) `directional-demand.ts` carried its own inline implementation/technical-discussion
regex, independently drifted from `intent-semantics.ts`'s `detectIntentTarget()` (the intended single
source of truth), so a technical/protocol discussion (X.509, TLS, SSO, ...) that didn't happen to match
the narrower inline pattern fell through into a genuine "product demand" branch; (2) entity name
matching was a bare word-boundary substring test, so a common-word product name (e.g. "Linear") matched
inside an unrelated technical phrase ("linear regression") with no way to tell the two apart; (3) the
only per-conversation "who is speaking" model was `speaker_role` (`buyer`/`maintainer`/`unknown`),
which had no representation for "the author is the vendor pitching their own product" - a first-person
launch post ("we just built X, an alternative to Jira") satisfied the buyer-language regex and was
scored and worded exactly like a third-party buyer's switching intent, a genuine MISATTRIBUTED case,
not merely an OVERSTATED one. Frozen unless proven otherwise by this section: `query_planning_v7`,
Retrieval Precision V1, Source Health V1, `candidate_selection_v3`, `maxEvaluations = 15`,
`signal_qualification_v1_7`'s scoring weights/thresholds, `ranking.ts`'s formula/freshness decay,
`market_partition_identity_v1`, 12A.1 telemetry, 12A.2 seeding/refresh, 12A.3A Hacker News retrieval.
`semantic_reasoning_router_v1` and its shadow-verification primitives (`validateShadowReasoningEvidence`,
`mergeValidatedShadowReasoning`, `planSemanticShadowReasoning`, `executeScheduledSemanticShadowReasoning`)
are reused as-is - not replaced, not forked - per the sections below.

- **Deterministic guard unification (no LLM, no new regex family).** `directional-demand.ts`'s
  `implementation` detection now delegates to `detectIntentTarget()` (`intent-semantics.ts`) instead of
  its own inline pattern pair, so there is exactly one place that decides "is this text about
  authentication/implementation, not a product-relationship claim" and the two modules can no longer
  drift apart. `AUTHENTICATION_TERMS` is broadened (still one shared regex, not per-caller copies) to
  cover the protocol/standard vocabulary the audit's X.509 case exposed (`x.509`, `tls`, `ssl`, `jwt`,
  `saml`, `ldap`, `sso`, `mfa`/`2fa`, `client certificates`), and `IMPLEMENTATION_TERMS` gains
  `config(uration)`, `deployment`, `self-host(ed/ing)`, `maintenance` for the technical-config/
  integration-maintenance false-positive class.
- **Entity disambiguation (`entity-disambiguation.ts`, new, `entity_disambiguation_v1`).** A small,
  extensible, per-entity collocation table (`NON_ENTITY_COLLOCATIONS: Record<string, RegExp>`, keyed by
  lowercased entity name, not hardcoded to a single name) that a mention must NOT satisfy in its
  immediate context to count as a real product reference; ships with the audited `linear` case
  (`linear regression|algebra|model|equation|scale|time|fashion|programming|search|interpolation|...`)
  and is designed for any future name to be added the same way, not a Linear-specific branch.
  `directional-demand.ts`'s `namesIn()` runs every candidate match through
  `isLikelyEntityMention(name, text, matchIndex)` before counting it, so "linear regression" no longer
  makes a competitor/source-product claim while "Linear" in a genuine switching sentence still does.
- **Authorial stance (`authorial-stance.ts`, new, `authorial_stance_v1`; additive field on
  `DirectionalDemand` and `ConversationMarketReasoning`, default `"unknown"` for every historical row).**
  A deterministic classifier distinct from `speaker_role`: `buyer` | `vendor_marketing` |
  `third_party_technical_discussion` | `unknown`, from first-person launch/pitch patterns ("we just
  built/launched/shipped", "introducing", "Show HN", "check it out") versus first-person
  evaluating/switching patterns versus the complete absence of first-person language. `speakerRole()`
  no longer classifies a vendor-pitch author as `buyer` just because it matches the generic
  I/we/our-team regex; `qualifySignal`'s `buyerPlausibilityCap` and `commercialRelevance` are capped for
  `vendor_marketing` the same way they already are for `speaker_role === "maintainer"`, a new
  `VENDOR_PITCH_NOT_BUYER_DEMAND` reason code is emitted, and `reasonText()` states the vendor-pitch case
  in its own precise sentence ("This is vendor positioning ... it is not an independent buyer's
  switching intent.") instead of routing it through the buyer-actor sentence templates.
- **Grounding gate reuses `semantic_reasoning_router_v1`'s own routing decision as an explicit,
  auditable fail-closed signal, with zero new LLM calls in the primary path (`evidence-grounding.ts`,
  new, `evidence_grounding_v1`).** `groundDeterministicReasoning()` calls the existing, unmodified
  `routeSemanticReasoning()` with the same inputs the shadow pipeline already computes (deterministic
  reasoning, source text, provisional `product_relevance`/`noise_risk`). Its three reasons
  (`ambiguous_direction`, `unclear_buyer_context`, `unknown_product_entity`) all fire precisely when the
  deterministic pass is already conservative/uncertain - direction already `"unknown"`, `buyer_context`
  already `false`, or a mentioned-product entity below 0.5 confidence - never when it is confidently
  wrong (a concrete direction at ≥ 0.75 confidence, or `buyer_context: true`, takes the router's own
  `deterministic_only` fast path and is trusted as-is, by the router's own unmodified design). The gate's
  job is therefore *not* to rewrite an overclaiming direction or buyer-context assertion - the router
  never routes those to verification in the first place - but to make the "this needs verification"
  fact auditable (`diagnostics.grounding_verification_required`) instead of letting a later, unverified
  shadow result silently apply, and to act on the one field that genuinely is unresolved without
  verification: a low-confidence `mentioned_products` entry is dropped from the record (never left to be
  read downstream as a confirmed entity) via `directionalDemandFromReasoning()` - the same conversion the
  shadow-verified path already uses to turn a `ConversationMarketReasoning` back into a
  `DirectionalDemand` - so one code path handles both a verified LLM result and this fail-closed default.
  A `EVIDENCE_GROUNDING_DOWNGRADED` reason code records exactly when that trim happened. This never fails
  the scan: a candidate flagged for verification still qualifies or rejects on its remaining dimensions
  (pain, specificity, evidence quality, ...) exactly as before. The audited overclaiming defects
  themselves (X.509 misclassification, "linear regression" matched as the product Linear, a vendor pitch
  read as buyer demand) are *confident* deterministic misreads, not ambiguous ones, so the router would
  never have flagged them for verification either - they are fixed at the source by the deterministic
  guard unification and the entity-disambiguation/authorial-stance modules above, not by this gate. The
  *existing* shadow comparison pipeline (unchanged: same budget, same `maxEvaluations = 15` bound it
  always ran within, same persistence) continues to compare the deterministic baseline against a verified
  LLM result for every candidate it always evaluated, which is the telemetry needed to decide whether
  promoting a verified upgrade into a new, additional (never overwritten) evaluation row is warranted -
  that materialization step is intentionally deferred, not built here (see Scope boundary below).
- **Scope boundary (explicitly deferred, not 12A.3B).** `product_match_evaluations` rows are immutable
  per this document's own tenancy/idempotency rules ("current pointers may optimize reads but must never
  overwrite historical matching/ranking results"); `IntelligenceService.matchProduct` therefore stays
  LLM-free and unchanged, and the grounding gate above operates purely on data already available at
  qualification time. Wiring a verified shadow upgrade into a *new* evaluation row with `setCurrentEvaluation`
  pointed at it is a natural next step but is out of scope for this hardening pass.
- **Temporal presentation (minimum-safe fix, no velocity/trend scoring).** `signalQualificationSchema`
  gains `evidence_published_at` (nullable, additive default `null`), sourced from the same
  `published_at ?? captured_at` precedence `freshnessScore`/`resonanceFor` already use - scoring is
  untouched. `reasonText()` appends the literal published date and, past a documented
  `EVIDENCE_HISTORICAL_THRESHOLD_DAYS = 90` age, an explicit "may not reflect current demand" qualifier,
  so wording never implies an old conversation is current without inventing a recency/trend score.
- **Bounded, idempotent, non-destructive revalidation (`signal-revalidation.service.ts`, new,
  `signal_revalidation_v1`).** Reuses `signal_lifecycle_v1`'s existing `transitionSignalLifecycle`
  exactly as-is (adds one new `SignalLifecycleReason` value, `evidence_fidelity_revalidation`, to the
  Zod enum only - the `invalidated_reason`/`retracted_reason` columns are free-text-with-length-check at
  the database layer, so no migration is needed). `decideRevalidationAction()` is a pure function
  comparing a previously-stored `SignalQualification` against a freshly recomputed one (from the same
  stored raw/canonical conversation/source/analysis - no re-crawl); when the fresh qualification no
  longer materializes (`canMaterializeQualifiedSignal` flips true → false) the signal transitions to
  `invalidated` with the new reason; a signal that still qualifies is left untouched (`unchanged`) or
  reported (`reconfirmed`) - the underlying evaluation row is never rewritten and no signal is deleted.
  Idempotent by construction: `transitionSignalLifecycle` already no-ops when the target status matches
  the current one and rejects reactivating a terminal signal, and recomputation is a pure function of
  already-stored inputs, so re-running the same batch twice changes nothing the second time. Bounded by
  `SIGNAL_REVALIDATION_MAX_PER_TICK = 50` per invocation, mirroring 12A.2's own retirement-pass bound.
- **Cluster/membership reconciliation needs no new code.** `demand-clustering.policy.ts`'s
  `computeDemandClusterStrength()` already reads each membership's `signalLifecycleStatus` and already
  defines `"signal_invalidated"`/`"signal_retracted"` exclusion reasons; `DemandClusteringService`
  recomputes cluster strength from current evidence validity on every `clusterProduct()` run
  (`demand-clustering.service.ts`). Transitioning a signal to `invalidated` via the revalidation service
  above is therefore automatically reflected - excluded from `lifecycleMix`/strength - on the next
  cluster recompute, with no membership-row change and no deletion. This path is already proven
  end-to-end by the pre-existing `tests/modules/demand-clustering-service.test.ts` case "stops counting
  invalidated, superseded (re-evaluated) and stale evidence, appending history instead of rewriting it"
  (it flips a signal's `lifecycle_status` to `"invalidated"` exactly as `revalidateSignal()` now does and
  asserts the cluster's next state excludes it with `signal_invalidated`); this section relies on that
  existing coverage rather than adding parallel reconciliation logic or a redundant test.
- **Tests**: `entity-disambiguation.test.ts`, `authorial-stance.test.ts`, `evidence-grounding.test.ts`,
  `signal-revalidation.test.ts`, plus regression cases added to the signal-qualification test suite for
  each named production failure class (X.509/protocol technical discussion, "alternative method"
  phrasing, `linear`-the-adjective, technical-config-only mention, integration/maintenance-only mention,
  vendor-pitch launch post, third-party tutorial/guide mention) and cross-cutting proofs (query/product/
  competitor context can never become evidence; `published_at` is preserved and never silently dropped;
  a required-but-unavailable verification fails closed without throwing; no additional LLM call is made
  for a safe deterministic reject or for a candidate whose router route is not `llm_reasoning`; the
  grounding gate is a pure function of its inputs, so replay is idempotent).

### 12A.3A.1 Amendment — Materialization Safety Gate (`materialization_safety_gate_v1`) — IMPLEMENTED_LOCALLY

**Gap confirmed.** The 12A.3A.1 grounding gate reuses `semantic_reasoning_router_v1`'s routing decision,
and that decision escalates to `llm_reasoning` only when the deterministic pass is already
uncertain/conservative (direction unknown, `buyer_context` false, or a low-confidence entity). A
*confident* deterministic misread - a strong `switching_intent` classification, a named competitor, an
explicit willingness-to-pay phrase - takes the router's own `deterministic_only` fast path and is never
routed for verification, regardless of how consequential the claim is. Expanding the regex/entity guard
set (as 12A.3A.1 did) narrows the set of confident misreads but cannot, by construction, prove the
invariant for claims no guard yet anticipates. This amendment closes that gap for a bounded, named set
of **high-risk** claim types: those must be either deterministically low-risk or verified before they can
materialize as a `qualified`/`high_confidence_signal` signal - confidence in the deterministic pass is no
longer sufficient on its own for a high-risk claim.

This does **not** replace or weaken 12A.3A.1's existing work; it adds one more gate after it, and every
primitive it needs is being reused, not rebuilt.

- **High-risk claim contract.** A candidate is high-risk when, after ordinary deterministic qualification
  would materialize it (`qualified`/`high_confidence_signal`), at least one of these holds (computed by
  `assessMaterializationRisk()` in `evidence-grounding.ts`, pure, no LLM):
  - `high_risk_switching_claim` - `primary_intent === "switching_intent"`.
  - `high_risk_competitor_claim` - a specific competing product is named as source or third-party/category
    target (`demand.source_products.length > 0` with `demand_target_type` `third_party_product`/`category`,
    or a `relationship_candidates` entry).
  - `high_risk_purchase_claim` - `primary_intent` is `purchase_research` or `vendor_evaluation`.
  - `high_risk_wtp_claim` - an explicit willingness-to-pay phrase (new deterministic pattern: "willing to
    pay", "I'd/we'd (happily/gladly) pay", "worth paying for").
  - `high_risk_migration_claim` - a genuine migration direction (`demand_direction === "away_from_product"`
    with a named source, or explicit migrat(e/ing) language) rather than a same-product feature note.
  - `high_risk_urgency_claim` - `analysis.urgency !== null && analysis.urgency >= 0.7`.
  - `ambiguous_entity_claim` - a `mentioned_products` entry below 0.5 confidence remains after the v1
    grounding trim (i.e., the router's own `unknown_product_entity` reason).
  - `ambiguous_author_stance` - `speaker_role === "buyer"` but `authorial_stance !== "buyer"` (the two
    independently-computed signals disagree about who is speaking).
  A candidate that would not materialize anyway (rejected/weak on its ordinary dimensions) is never
  assessed for risk - this is the deterministic zero-LLM path (see below), not a side effect of a budget
  check.
- **Router extension, truthfully versioned.** `SEMANTIC_REASONING_ROUTER_VERSION` moves to
  `semantic_reasoning_router_v2`: `routeSemanticReasoning()` gains an optional `materializationRisk:
  MaterializationSafetyReason[]` input; when non-empty (and the content isn't obvious noise/promotional,
  which still short-circuits to `reject_without_llm`, and isn't `implementation_only`, which is
  definitionally not a materializable claim), the route is forced to `llm_reasoning` with those reasons
  and top priority (`2`, above the existing uncertainty-priority range of `0..1`) - overriding the
  `explicit_direction` confidence≥0.75 fast path that let confident-but-wrong claims through. The
  existing three uncertainty reasons, `validateShadowReasoningEvidence`, and `mergeValidatedShadowReasoning`
  are unchanged - reused exactly as they are; only the router's own routing function gained a new input
  and a new case. Any caller that does not pass `materializationRisk` (there are none left after this
  amendment, but the parameter is optional for defensiveness) sees identical behavior to v1.
- **Structured verification result, not free-form model prose.** `semantic-verification.schemas.ts`
  (new) defines `semanticVerificationResultSchema`: `supported: boolean`, `intent_type` (`switching` |
  `alternative_search` | `purchase` | `willingness_to_pay` | `feature_request` | `pain` | `comparison` |
  `recommendation` | `other` | `none`), `authorial_stance` (`first_party_demand` | `first_party_experience`
  | `recommendation` | `vendor_marketing` | `technical_discussion` | `descriptive_reference` | `unknown`),
  `target_type` (`tracked_product` | `competitor` | `category` | `feature` | `workflow` | `none` |
  `ambiguous`), `target_name` (nullable), `claim_strength` (`explicit` | `strongly_supported` |
  `weakly_supported` | `unsupported`), `evidence_spans` (exact, already source-verified spans), and
  `temporal_tense` (`current` | `past` | `future` | `unclear`). This is **not** a second LLM call or a
  parallel provider stack: `deriveSemanticVerificationResult()` projects it deterministically from the
  *already-validated* `ConversationMarketReasoning` that `validateShadowReasoningEvidence` +
  `mergeValidatedShadowReasoning` produce today (`supported` is false iff the specific high-risk claim's
  field was in `droppedClaims`; `claim_strength` and `temporal_tense` are derived from the merged
  reasoning's confidence and source text). `reasonText()` consumes only this structured result for a
  verified high-risk claim - never the LLM's own prose - so a "past first-party experience" claim reads
  as "reports having moved from X to Y," not "actively considering switching."
- **Materialization safety gate.** In `qualifySignal`'s no-`reasoningOverride` path: once ordinary
  dimensions would materialize the candidate, `assessMaterializationRisk()` runs; if it returns any
  reason, `diagnostics.materialization_verification_required = true` and the **status is capped at
  `weak_candidate`** (a `HIGH_RISK_VERIFICATION_REQUIRED` reason code is added) - synchronously, with no
  LLM call, so this is the *default* and *only* behavior wherever semantic verification is disabled,
  unbudgeted, or not yet run. This is the fail-closed contract: a high-risk claim materializes as
  `qualified`/`high_confidence_signal` only via `qualifySignalWithReasoning()` with a `merged` reasoning
  whose derived `SemanticVerificationResult` has `supported: true` and `claim_strength` of
  `explicit`/`strongly_supported` - `qualifySignalWithReasoning()` skips the deterministic-only cap
  entirely (it is, by definition, already grounded). Pipeline shape:
  `retrieval → deterministic analysis → candidate selection → qualification candidate (capped if
  high-risk) → (bounded, reused) semantic verification → grounded qualification → materialization`.
- **Live wiring reuses the existing shadow pipeline verbatim - no parallel call site.**
  `SemanticShadowPlanningCandidate`/`SemanticShadowExecutionCandidate` gain an optional
  `materializationRisk?: MaterializationSafetyReason[]` field, populated in `initial-scan.service.ts` from
  the first-pass evaluation's own `diagnostics.materialization_risk_reasons` (already persisted, since the
  gate above always runs). `planSemanticShadowReasoning`/`executeScheduledSemanticShadowReasoning` are
  unchanged code; they already compute exactly the validated+merged reasoning this gate needs. The scan
  loop's existing shadow block (previously comparison-only) now additionally does this for a candidate
  flagged `materialization_verification_required`: if a `merged` result exists whose derived
  `SemanticVerificationResult` supports the claim, call `IntelligenceService.matchProduct(...,
  reasoningOverride: merged)` again - creating one more **immutable** evaluation row (a new
  `input_fingerprint`, since it hashes the override's fingerprint) - and `setCurrentEvaluation()` points
  the match at it, exactly the "current pointer over immutable history" pattern this repository's own
  tenancy rules already require and `matchProduct`/`setCurrentEvaluation` already implement for every
  other evaluation. No evaluation is ever mutated or deleted. If no verified upgrade exists (disabled,
  no budget, provider failure, schema failure, evidence failure, or `supported: false`), the first-pass,
  already-capped evaluation simply remains current - the scan does not fail, nothing extra happens.
- **Deterministic zero-LLM path preserved.** X.509/protocol discussion, "linear regression", empty/low
  relevance evidence, and implementation/config-only content never reach `assessMaterializationRisk()`
  because they do not materialize on ordinary dimensions in the first place (or, for `implementation_only`,
  are explicitly exempted) - zero verification calls, exactly as before this amendment.
- **Cost bound: no new budget invented.** `SEMANTIC_REASONING_SHADOW_MAX_NEW_CALLS_PER_SCAN`
  (`getSemanticReasoningShadowConfig`, default `0`) already bounds every LLM call
  `executeScheduledSemanticShadowReasoning` can make in a scan, regardless of why a candidate routed to
  `llm_reasoning`. This amendment does not raise that cap or add a second one; it changes what competes
  for it: a `materializationRisk` reason now sorts to priority `2`, ahead of the existing `0..1`
  uncertainty-only priority range, so a constrained budget is spent on materialization safety first.
  `maxEvaluations = 15` (`candidate_selection_v3`) is unchanged - the gate only ever evaluates candidates
  already inside that bound.
- **Fail-closed, never fails the scan.** Provider unavailable, timeout, schema-invalid output, evidence
  validation failure, or budget exhaustion all already produce a non-`success` `execution_status` in the
  existing `executeScheduledSemanticShadowReasoning`/persistence path (unchanged); this amendment's rule
  for all of them is identical: no verified upgrade, so the capped (`weak_candidate` at most) first-pass
  evaluation stands. The scan's own error handling is untouched - `processScanCandidates`'s shadow block
  already treats shadow failures as observational and continues.
- **Feature flag `EVIDENCE_FIDELITY_GROUNDING_ENABLED`** (`env.ts`, default off; read in Vercel and
  Trigger). Off: `qualifySignal`/`deriveDirectionalDemand`/`detectIntentTarget` all take the flag as an
  explicit parameter (never an internal env read, matching the `hnAlgoliaSearchEnabled` convention) and,
  when it is false, run the *original* pre-12A.3A.1 code paths byte-for-byte - the original
  (non-expanded) `AUTHENTICATION_TERMS`/`IMPLEMENTATION_TERMS`, the original inline implementation
  regex in `directional-demand.ts`, no entity-disambiguation filtering, no authorial-stance computation
  (`authorial_stance` stays `"unknown"`), no v1 grounding downgrade, no materialization gate, no temporal
  wording, and `reasonText()` matches its pre-12A.3A.1 output exactly. This makes the whole of 12A.3A.1
  *and* this amendment inert when the flag is off, correcting the previous 12A.3A.1 commit's unconditional
  rollout (this is the reason the amendment retrofits a flag onto already-shipped code rather than only
  gating the new gate). On: every 12A.3A.1 guard plus this amendment's materialization gate is active.
  The flag never touches retrieval - Hacker News Search v2 (`HN_ALGOLIA_SEARCH_ENABLED`) keeps running
  regardless of this flag's state, in either direction.
- **Idempotency/fingerprint correctness.** `IntelligenceService.matchProduct`'s `input_fingerprint` now
  additionally hashes `groundingEnabled` and, when true, `qualification.diagnostics.grounding_version` -
  so flipping the flag for a workspace naturally produces a new fingerprint (recomputes instead of
  silently reusing a stale cached evaluation) without needing to bump the global
  `SIGNAL_QUALIFICATION_VERSION` (which the codebase's own convention reserves for a *default-path*
  dimension-composition change - correct to leave unchanged here, since the default/flag-off path is
  unchanged from `signal_qualification_v1_7`). Semantic verification reuse across replay is already
  idempotent for free: `SemanticShadowReasoningRepository.findByFingerprint` keys on
  `routerVersion`/`reasoningVersion`/`promptSchemaVersion` plus a content fingerprint that itself embeds
  `routerVersion` - the v1→v2 router bump alone guarantees no stale v1 verification result is reused as
  if it answered a v2 (materialization-aware) question, while a repeated v2 candidate still hits cache.
- **Revalidation integration.** `revalidateSignal`/`revalidateSignalBatch` take `groundingEnabled` as
  part of the candidate's `freshInput`; when false, revalidation returns `skipped` immediately (a flag-off
  revalidation pass is a deliberate no-op, not a silent behavior change). When true, revalidation
  recomputes through the exact same gate new signals use, including reusing any existing verified
  semantic-verification artifact for that conversation/product/router-version rather than requesting a
  new one - an old signal is never invalidated by a new regex alone when the architecture says
  verification is required; it is capped/held pending verification exactly like a new candidate would be.
- **Rollout.** No schema migration (one new env var; `signals`/`product_match_evaluations` already support
  everything used here). Deploy with the flag off (byte-identical to pre-12A.3A.1 production) → enable in
  a bounded internal workspace allowlist alongside a nonzero `SEMANTIC_REASONING_SHADOW_MAX_NEW_CALLS_PER_SCAN`
  and `SEMANTIC_REASONING_SHADOW_ENABLED=true` (both already exist and already default to no calls) →
  observe that a known high-risk case caps at `weak_candidate` with zero verification budget configured →
  observe a verified upgrade materialize once budget/enablement are both on → widen the allowlist.
- **Rollout**: this is a scoring/wording/lifecycle-only change with no schema migration and no new
  provider dependency; revalidation is implemented but not scheduled by this section (invoking it
  against existing production signals is a separate, explicit operational decision, not automatic on
  deploy). **Superseded by the 12A.3A.1 Amendment immediately below**: this section's guards, wording,
  and revalidation eligibility are now gated behind `EVIDENCE_FIDELITY_GROUNDING_ENABLED` (default off,
  matching pre-12A.3A.1 production exactly) rather than being unconditionally active as first written
  here - see the amendment for the corrected rollout contract and the reason it was required.
