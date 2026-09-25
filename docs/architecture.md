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
