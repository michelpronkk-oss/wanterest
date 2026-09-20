# Wanterest backend architecture

Status: approved foundation; Phase 1 through Phase 6 are implemented as backend foundations.
Phase 7 experiments remain out of scope.

## 1. Current repository

The repository is a clean Next.js 16.3.5 App Router starter using TypeScript, React 19,
Tailwind CSS 4, ESLint, and the React Compiler. It currently contains:

- `src/app/layout.tsx`: default root layout and Geist font setup.
- `src/app/page.tsx`: default Create Next App landing page.
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
      billing/webhooks/dodo/
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

Workspace/product experiment linked to an action. Stores control definition, selected metric,
assignment method, lifecycle state, sample/measurement window, engine version, and measurement
metadata.

#### `experiment_events`

Minimal assignment and conversion-event facts: experiment, variant/control, anonymous or
hashed subject key, event name, occurred time, and dedupe key. Do not turn this into a general
analytics warehouse.

#### `experiment_outcomes`

Periodic result materialization: variant, exposure count, conversion count/rate, comparison to
control, confidence/measurement metadata, and calculation version.

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
and redacted error details. Unique idempotency keys prevent duplicate writes.

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
`experiments`, `experiment_events`, `experiment_outcomes`, `digests`, `billing_customers`,
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
5. open-web/search adapters

This order is an implementation sequence, not a downstream domain dependency. Discovery,
normalization, deduplication, analysis, matching, ranking, and aggregation consume only the
shared contracts and must not branch on Hacker News, Bluesky, Reddit, or search behavior.

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

## 10. Dodo billing and entitlement flow

1. A workspace owner chooses an internal Wanterest plan and interval. The server checks the
   workspace role and creates a Dodo checkout through the billing port, passing only a signed or
   server-generated checkout reference plus `workspace_id`, internal plan code, and interval as
   metadata.
2. The browser return page is informational. It does not grant access.
3. Dodo sends lifecycle webhooks. The webhook route verifies the Dodo signature, records the
   event in `billing_webhook_events`, and returns safely for a duplicate event.
4. A billing application service translates provider events into normalized
   `billing_customers`/`subscriptions` state. It never stores product access rules in Dodo
   product IDs.
5. Entitlements are recalculated from the normalized Wanterest plan/status and the versioned
   `plan_catalog`/`plan_entitlements` catalog into append-only
   `workspace_entitlements` revisions. `free` is an internal plan and has no Dodo product.
6. Access checks call `can`, `limit`, and `consume` against Wanterest's entitlement/usage
   primitives, not the browser, checkout result, or provider counters.
7. Renewal, cancellation, past-due, failed-payment, and expiration events update normalized
   state and audit records. A scheduled reconciliation task can compare provider state without
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
strictly: fixture first, Hacker News first real adapter, Bluesky next, Reddit next, and
open-web/search later. Add each real adapter only after the provider-neutral fixture/contracts
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

Implement minimal action experiments, assignment/conversion events, outcome evaluation, admin
debug views, source health dashboards, backfills, retention/redaction, rate-limit tuning,
observability, load tests, and runbooks.

No phase should silently expand into a general analytics platform, source crawler, or provider-
specific domain model. Revisit this architecture when a measured requirement justifies a new
boundary.
