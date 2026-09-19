<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ. Read
the relevant guide in `node_modules/next/dist/docs/` resolved from this file's directory before
writing code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Wanterest project rules

These are stable project constraints. The approved architecture is documented in
`docs/architecture.md`; update that document before changing these rules.

## Product and architecture

- Wanterest is a modular monolith for demand intelligence. Do not introduce microservices,
  Kafka, a general-purpose Redis dependency, a separate Python service, custom distributed
  crawling, or a general AI-agent framework without an explicit architecture decision.
- Keep domain code under `src/server/modules/<module>`. Keep UI and route composition in
  `src/app` and `src/components`. Client code must never import server-only modules.
- Use ports/adapters for every external dependency: source/search providers, LLMs,
  embeddings, billing, email, clock, and job execution. Business logic must depend on the
  port, not on a provider SDK.
- Keep the pipeline explicit and replayable:
  raw ingestion -> canonicalization -> deduplication -> deterministic filtering -> analysis
  -> matching -> ranking -> observations -> map/gap/drift -> actions -> experiments.
- Separate raw, canonical, and derived/AI data. A public conversation is global and stored
  once; workspace/product matches and intelligence are scoped to the workspace.
- Every derived result must store its engine version, model/prompt version where relevant,
  timestamp, confidence, and source-evidence references.
- Stable product/conversation relationships must be separate from immutable evaluation rows;
  current pointers may optimize reads but must never overwrite historical matching/ranking
  results.
- Evidence provenance is relational and inspectable. Use evidence nodes/links with structured
  spans and weights to trace user-facing results back through observations/matches,
  conversations, source items, and raw source payloads; do not rely primarily on JSON ID arrays.
- Every async job must be retry-safe and idempotent. Enforce idempotency with database
  constraints/keys, persist job state and errors, and make reprocessing possible from stored
  raw/canonical data without crawling again.

## Data, tenancy, and security

- PostgreSQL/Supabase is the system of record. Use UTC timestamps, UUIDs, explicit foreign
  keys, check constraints, and unique constraints for natural/provider identities.
- Every workspace-owned parent exposes `(workspace_id, id)` and child relationships use
  composite foreign keys so cross-workspace references are rejected by PostgreSQL, not only by
  application validation.
- Every workspace-owned table must have a non-null `workspace_id` and Supabase RLS based on
  active `workspace_members`; never trust a workspace ID supplied by the browser.
- Supabase service-role access is server-only. Route handlers, server actions, and jobs must
  validate auth, membership, input, and authorization before calling repositories.
- Raw provider payloads and provider secrets are not exposed to the browser. Webhooks are
  signature-verified, recorded once, and processed idempotently.
- Validate environment variables at server startup/runtime boundaries. Do not commit secrets
  or add `.env` files to source control.
- Use Dodo only through a billing adapter. Do not use Stripe or couple product access to
  Dodo product IDs; Wanterest owns normalized plan, subscription, entitlement, and usage
  state.
- Internal `plan_catalog`, `plan_entitlements`, and append-only `workspace_entitlements` are
  the capability authority. `can`, `limit`, and idempotent `consume` exist from Phase 1;
  Dodo integration is later and only changes normalized subscription/plan state.

## Implementation discipline

- Do not implement a new backend phase until the corresponding architecture decision is
  approved and reflected in `docs/architecture.md`.
- Phase 1 is backend-only: no dashboard/product UI. The initial adapter order is fixture,
  Hacker News, Bluesky, Reddit, then open-web/search; downstream code remains provider-neutral.
- Prefer small, typed module APIs and repositories over cross-module table access. A module
  may depend on another module's public application contract, not its private persistence
  details.
- Use runtime validation at external boundaries and typed contracts internally. Preserve
  provider/source provenance and evidence links through every transformation.
- Use pgvector only for a demonstrated retrieval/matching need; begin with deterministic
  filters, PostgreSQL full-text/trigram search, and measured scoring components.
- Do not expose an opaque AI score. Persist ranking components such as semantic relevance,
  pain alignment, buyer alignment, intent strength, specificity, freshness, and source
  quality before calculating an opportunity score.
- Add migration, RLS, idempotency, composite-FK, provenance, and contract tests with each
  relevant data/pipeline phase. Run the repository's lint/build checks before handoff.
