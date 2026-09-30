# SEO-2 Organic Intelligence Readiness

## Scope and source

SEO-2 is an architecture and readiness phase. It does not publish pages, add candidate routes to the sitemap, request indexing, mutate production data, or apply migrations. The supplied SEO-2 brief contains the nine page-family names and release gates. The separate Futureproof SEO Master Plan referenced by that brief was not present in the repository or attachments; do not invent further strategy from its name.

The implementation is deliberately split between a typed domain policy in `src/server/modules/organic-intelligence` and a private, read-only Admin unavailable state at `apps/admin/src/app/publication-readiness`. The current production project has no designated, reviewed public-safe intelligence projection. The Admin page therefore exposes no candidates, counts, search opportunities, or example measurements.

## Existing evidence and publication boundary

| Existing data | Current scope | SEO-2 treatment |
| --- | --- | --- |
| `conversations`, `conversation_source_items`, analyses and evidence links | Global canonical source/intelligence records; conversation rows retain body and author fields | Not a publication projection; no candidate copy or excerpt is read into the SEO view |
| Demand clusters, memberships, observations, gaps, drifts and concept market states | Workspace-owned records with `workspace_id` and member RLS | Excluded from global/public SEO candidate evaluation |
| Share Card publications/events | Consent-based 13B.1 identity sharing; public DTO is limited to identity-card fields | Does not authorize intelligence publication or become a candidate source |
| Search Console report | Private Analytics API read path in Admin | Prioritization only after eligibility; currently not connected to a candidate feed |

The production catalog inspection found RLS enabled for the inspected evidence, demand, and share-card relations. Demand relations expose authenticated `SELECT` only through workspace-membership policies. Global source/evidence tables and share-card tables had no direct `anon`/`authenticated` table grant in the inspected grants; share-card service-role access remains server-only. These controls do not by themselves certify that arbitrary conversation content is safe to publish.

The projection schema is a strict allowlist. It contains no workspace ID, raw payload, author/contact field, private connector state, saved/dismissed/contacted state, Action or experiment state, or secret. Evidence summaries require privacy/copyright review timestamps, default to paraphrase, bound any approved excerpt, and remove source URL query strings/fragments. A privacy/copyright status is still an asserted human review result, not an automated PII or copyright detector.

## Maturity and independence

The maturity policy has `observed`, `repeated`, `corroborated`, `persistent`, `accelerating`, and `market_level` states. It reads explicit independent-episode, author, source-family, time-bucket, duplicate, concentration, viral-event, freshness, acceleration, geography, and first-party-confirmation dimensions. Raw mention count is not part of the contract.

The pure `measureIndependentEpisodes()` contract accepts only already-canonicalized opaque episode observations; its strict input has no body, comment, author display, profile, or payload field. It removes explicitly marked duplicate rows, collapses a cross-platform viral event to one representative episode, calculates source-family concentration from representative independent episodes, preserves raw-observation viral concentration and duplicate ratio as separate safeguards, computes acceleration from continuous calendar-month buckets, and marks all independence measures unavailable when canonical author identity is missing. It does not infer identities from source text or query production rows. The production schema/read models do not yet supply the validated cross-workspace episode keys, author keys, viral-event keys, and buckets required by this contract, so the Admin preview remains unavailable and candidate decisions cannot run. The initial centralized numeric thresholds are engineering defaults for contract testing; they have not been calibrated against a public-safe production cohort and must be reviewed before any launch decision.

## Family-specific eligibility

Families 3–8 have separate required dimensions and thresholds:

1. **Public Market Intelligence** — market-level independent evidence, three source families, five time buckets, broad author/episode evidence, and low duplication/concentration.
2. **Demand Opportunity** — persistent demand episodes, multiple authors and source families, four time buckets, and low concentration.
3. **Company / Competitor Intelligence** — the demand opportunity requirements plus first-party-confirmed supply facts and separately corroborated external demand.
4. **Trend / Demand Drift** — multiple historical buckets and movement based on independent-episode rates; raw mention growth is not accepted.
5. **Geography Intelligence** — persistent evidence, at least 30 independent regional episodes, and location confidence at or above the configured threshold.
6. **Research / Data Report** — manual topic approval, defensible dataset, minimum dataset record count, and explicit methodology.

The typed decision retains a status, axis-specific gate results, machine-readable reason codes, and evidence reference identifiers. Safety, truth, freshness, concentration, uniqueness, diversity, evidence, and persistence remain independently assessed. A missing measurement is unavailable, not a guessed value. Thresholds do not target a page quota.

## Search Console

The domain policy accepts only a private typed Search Console prioritization signal. An already-eligible or review-required candidate may be reordered by settled, non-branded opportunities. Provisional data stays provisional; unavailable data stays unavailable. Ineligible candidates always remain `not_eligible`, regardless of impression or query demand. The provider/report code was not changed. A live cross-system adapter awaits the reviewed projection and candidate feed.

## Canonical identity, uniqueness, refresh, and review

The future route-family contract is:

- `/market/[market]`
- `/demand/[market]/[demand]`
- `/companies/[company]`
- `/trends/[trend]`
- `/markets/[region]/[market]`
- `/research/[report]`

The pure identity helper creates stable normalized paths from canonical keys and opaque deterministic digests, detects occupied paths and alias conflicts, and resolves an explicitly merged object to an existing stronger identity. This is a contract only: aliases, canonical identities, merge decisions, and redirects are not persisted in production, and no corresponding route exists.

Freshness is claim-specific (`demand_signal`, `supply_fact`, `trend_measurement`, `geography_sample`, `research_dataset`) and uses the last meaningful update. No code changes a date to simulate freshness. The lifecycle contract supports `candidate → eligible → review_required → approved → published`, with `review_required → noindex → retired` downgrades and `merged` resolution. System actors cannot approve or publish; those transitions require a human user, reason, and audit-event reference. There is no persistence, audit writer, publisher, scheduled refresh, or retirement job in this phase.

## Layer 13B status inspected for SEO-2

| Layer | Code/branch | Main and migration status | Operational/read-path status |
| --- | --- | --- | --- |
| 13B.1 identity Share Cards | Integrated in current `main` | Production migration `20261101000000` is recorded | Catalog confirms the identity DTO RPC, table RLS/grants, and event trigger. No real slug read or production publication mutation was exercised in this inspection. It does not publish intelligence. |
| 13B.2 intelligence sharing | Separate `layer13b2-intelligence-sharing` branch at `5f4bc93d`; migration file exists there | Not in current `main`; migration version `20261027000000` is absent from production history | Migration explicitly says `NOT RUNTIME VALIDATED`; no production intelligence-share path is activated. |
| 13B.3 public intelligence attribution | Separate `layer13b3-public-intelligence-attribution` branch at `e22e075f`; migration file exists there | Not in current `main`; migration version `20261028000000` is absent from production history | Migration explicitly says it is not runtime validated. No production route or attribution path is activated. |
| 13B Integration Repair | Present as `20261029000000_layer13b_integration_repair_v1.sql` on the 13B.3 branch | Not in current `main`; version `20261029000000` is absent from production history | Migration explicitly says it is not runtime validated; no production changes were made. |

No matching PR was found for the 13B.2 or 13B.3 feature branches. The 13B.1 remote history contains only the already-recorded `20261101000000` migration followed by the Admin foundation migration `20261102000000`; the unfinished 13B migrations were not run, marked applied, rewritten, or repaired by SEO-2.

## First-cohort production preview

The read-only production schema inspection found no reviewed SEO projection table or read adapter. No production candidate rows were evaluated: workspace-owned inputs are private, and the global raw records are not a safe projection. This is a source-availability preview, not a claim that Wanterest has no underlying demand. The correct report is:

- intelligence objects evaluated: **0**;
- eligible: **0**;
- review required: **0**;
- blocked candidate objects: **0**;
- system-level blocker: **public-safe candidate projection unavailable**;
- family distribution and representative examples: **none available**.

These zeros mean no objects were eligible to enter evaluation; they do not describe total conversations, customer activity, or market volume. Workspace-owned demand and raw global conversation content were not used to fabricate a first cohort. The private Admin page communicates the unavailable state and has no publication control.

## Release boundary and readiness decision

No migration was created or applied. No public route family was created, no sitemap or robots policy was expanded, no indexing request was made, and no customer or lifecycle data was modified. Search Console, host routing, MFA, Admin membership authorization, Actions, billing, discovery, qualification, and production jobs were not changed.

The controlled 20–50 page launch is **not ready**. Reconsider only after the separate 13B work is reviewed and runtime-validated, a reviewed public-safe projection and retention policy are approved, independent episodes and maturity signals are calculated reliably, canonical identities and aliases have an authoritative persistence path, the family thresholds are calibrated against real safe evidence, and a human review/audit process is operational.
