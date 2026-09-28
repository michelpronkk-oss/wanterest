# Layer 13B.2 — Evidence-backed intelligence sharing

## Scope and architecture

13B.2 extends the 13B.1 dynamic share-card engine. It does not create a second renderer, public taxonomy, indexable intelligence site, or recommendation surface. Identity cards keep their existing snapshot shape; intelligence cards add a narrow, optional claim/evidence projection and carry private source identifiers only in the publication authority layer.

The supported public variants are:

- `SIGNAL`: one current signal whose lifecycle is `active` or `saved`.
- `DEMAND_GAP`: one persisted, evidence-backed demand-gap analysis.
- `DEMAND_DRIFT`: one persisted, evidence-backed comparable-period movement analysis.

Demand Map and Geography were assessed but are not published as standalone cards in this layer. Map v2 is a live aggregate with no single stable public source row, while Geography needs a public taxonomy and disclosure policy that belong to 13B.3. The implementation therefore avoids inventing a geography label, market denominator, or public market-size claim.

## Authoritative field mapping

| Card | Observation | Supporting evidence | Strength/context | Freshness | Provenance anchor |
| --- | --- | --- | --- | --- | --- |
| Signal | `signals.excerpt` | `signals.why_it_matters` or excerpt | match decision from the existing evaluation; lifecycle is rechecked | `published_at` / `created_at` | `signals.evidence_node_id` |
| Demand gap | `demand_gaps.interpretation` | persisted `market_mentions` and snapshot identity | persisted measurement metadata / snapshot analysis | demand snapshot `period_end` | `demand_gaps.evidence_node_id` |
| Demand drift | persisted direction statement | current vs previous persisted mention counts | persisted significance | current/previous snapshot period | `demand_drifts.evidence_node_id` |

The DTO deliberately excludes opportunity scores, private product names, connector payloads, source URLs, internal IDs, recommendations, actions, experiments, and workspace configuration. A single signal is described as a product-scoped observation, never as market-wide demand. Counts and comparison language are emitted only where the authoritative row already stores them.

## Consent and live revalidation

Workspace intelligence cards are private previews until an owner/admin explicitly publishes them. Publication is service-role-only and requires the workspace, active product, source row, and evidence-node identity to match. The public RPC revalidates publication state and the source row on every request. Invalidated/retracted/archived signals, deleted or archived products, missing evidence, and revoked publications therefore resolve to no public DTO and consequently produce no OG/download image.

The migration adds a composite workspace/product foreign key with cascade for deleted products and a source-evidence foreign key with restrict semantics. This prevents cross-workspace references and prevents a provenance anchor from silently disappearing underneath a publication.

## Rendering and analytics

The 13B.1 `ShareCardArtwork` renderer now has an intelligence branch while preserving identity output. It supports the existing 1200×630 OG, 1080×1350 portrait, and 1080×1080 square paths. OG and downloads both load the same dynamic, no-store public projection, so stale Wanterest-controlled metadata is not intentionally served. Third-party social platforms may cache previews independently.

The existing event RPC and attribution rules remain unchanged. Known social/OG crawler user agents are filtered at the event route, so crawler fetches are not counted as human opens or CTA activity. A share or CTA click remains distribution activity, not a conversion.

## Database validation status

`supabase/migrations/20261027000000_layer13b2_intelligence_sharing_v1.sql` was created for the dependent branch and is **NOT RUNTIME VALIDATED**. No production or paid database was changed. Static SQL review and application contract validation are the only database checks in this implementation task.

