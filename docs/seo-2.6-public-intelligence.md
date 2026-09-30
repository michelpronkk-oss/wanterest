# SEO-2.6 Public Intelligence Feed

## Release state

- Code is based on `f681e5c0fe57a6fd4053a7a5916f00cb93fa1e44` (`origin/main` in the isolated worktree).
- The production pre-release baseline was confirmed read-only at `20261102000000` (`admin_console_foundation`), PostgreSQL 17.6, with 57 recorded migrations and no organic feed tables.
- `20261103000000_seo26_public_intelligence_feed.sql` is a new forward-only migration, runtime-validated locally and authorized for the dormant foundation release. Its final SHA-256 is `27CF5508A6D3F00D9FE6BF21369480664747020AA5B1884BBA47C85CB401186E`.
- No source policies, topics, episodes, candidates, memberships, customer rows, or publication settings were written.
- The existing `stash@{0}` and dirty primary checkout were not accessed or changed.
- The release scope is the dormant private foundation and Admin read surface. Source-policy approval, ingestion, candidate evaluation, and public publication remain separately gated and inactive.

## Legacy Layer 13B decisions

| Legacy work | Decision |
| --- | --- |
| Layer 13B.2 (`20261027000000`) | Retain the general idea of a private candidate/readiness source. Replace the proposed workspace-derived Signals, Demand Gap, and Demand Drift projections with a global, context-independent public evidence model. Do not apply or mark the migration as applied. |
| Layer 13B.3 (`20261028000000`) | Retain source attribution only when an exact host and field policy have been reviewed. Replace permissive HTTP(S) acceptance with HTTPS-only exact-host validation, credential and port rejection, fragment/tracking cleanup, and rejection of unrecognized query parameters. Do not apply or mark the migration as applied. |
| Integration Repair (`20261029000000`) | Do not carry over public `verified_conversion`, admission mutations, or unrelated customer lifecycle changes. The production 13B.1 Share Card RPC accepts only `opened`, `cta_clicked`, `shared`, and `downloaded`; arbitrary clients cannot submit `verified_conversion`. A future verified conversion must originate from a server-authoritative, qualifying-event verifier. |

The reviewed source order is **13B.1 → 13B.2 → 13B.3 → Integration Repair**: 13B.2 extends the 13B.1 Share Card publication table and replaces publication RPCs; 13B.3 replaces the public Share Card DTO using those extension columns; Integration Repair explicitly says it runs after 13B.3. The production 13B.1 is recorded as `20261101000000`, while the unmerged 13B.2/13B.3/repair filenames are `20261027000000`, `20261028000000`, and `20261029000000`. Those earlier timestamps cannot be safely replayed behind the live head. The branch versions' own migration comments say they were not runtime validated. 13B.2 and 13B.3 derive publication data from workspace-owned Signals, Demand Gaps, and Demand Drifts. The repair migration additionally changes workspace-admission provisioning and grants `record_share_card_event` to `anon` and `authenticated` with `verified_conversion` in its accepted event list. Its intended signup/admission verifier is not a basis for applying that public RPC permission. The current production 13B.1 function remains the narrower allowlist described above.

Production history contains 13B.1 (`20261101000000`) and the Admin foundation (`20261102000000`). It contains none of the three legacy pending migrations. No history was repaired or rewritten.

## Public/private boundary

The new schema is separate from Signals, demand gaps/drifts, workspace products, CRM, support, Actions, experiments, private notes, and provider payload tables. A public episode must reference the exact `conversations.primary_source_item_id`, the corresponding source and conversation evidence nodes, and both evidence nodes must have `workspace_id IS NULL` and the expected `entity_table`/`entity_id`. Base source/conversation/evidence deletion cascades to the derived episode; affected candidates become stale and receive a system audit event.

The new tables have RLS enabled and no `PUBLIC`, `anon`, or `authenticated` table grants. The Admin summary is a `SECURITY INVOKER` function executable only by `service_role`, called from the server-only Admin service client after Admin host, membership, AAL2, and permission checks. A global topic also needs a separately attributable privacy and copyright review before any episode is admitted or included in the safe aggregate. Candidate response parsing is strict and contains topic labels, aggregate measurements, eligibility states, and bounded internal episode UUID references only. It returns no source text, author ID, provider ID, raw payload, workspace ID, or source URL.

The review RPC is `SECURITY DEFINER`, uses an empty `search_path`, derives the actor from `auth.uid()`, requires JWT `aal2` and active `organic_reviewer` membership, and records the Admin audit event and append-only review event in the same transaction. It accepts only a candidate UUID, one action, and a bounded reason. The review role is added to the role constraints but no member is provisioned. Founder and all prior Admin roles remain read-only. Review states never publish.

## Source policy and source families

Every source policy starts `unknown`; the production provider seed rows remain unknown. `approved` allows only explicitly reviewed fields. `restricted` permits context-independent `aggregate_only` use and cannot attribute a source, expose excerpts, or project author/provider identity. `blocked` is never admitted. Both approved and restricted policies require a review reference, reviewer identity, timestamp, and HTTPS policy-basis URL. Raw text may only be used internally for reviewed aggregation. Author identities are internal-only or blocked; provider IDs, private connectors, and workspace interpretation are blocked. Topic, geography, entity, timestamps, and excerpt use each have separate policy fields.

Provider grouping and family-specific demand controls are centralized. Video-comment evidence must resolve to a verified video/event root before measurement; first-party company evidence is supply confirmation only; all families use exact dedupe or reviewed relation links, never semantic auto-merge. Existing mappings are:

| Providers | Family | Notes |
| --- | --- | --- |
| Hacker News, Stack Exchange | Community discussion | Same family; provider count does not establish family breadth. |
| GitHub | Developer community | 46 current rows lack author IDs. |
| Bluesky, X | Social platform | Same family; repost/reply/event relations need review. |
| YouTube | Video comments | One video/event is one concentration cluster, not many independent episodes. |

Review, editorial/reporting, and first-party company families exist in the taxonomy but have no production provider mapping. First-party evidence may support an independently verified supply fact; it is excluded from third-party demand independence counts. An unmapped provider or unreviewed mapping is ineligible.

## Episode identity, dedupe, and provenance

`fingerprintPublicIdentity()` uses domain-separated HMAC-SHA-256 with caller-supplied server-held key and version; it does not log or return input identifiers. No key is configured or used against production data in this task. A materializer must provide the key server-side before creating fingerprint rows.

The existing SEO-2 independent episode measurement is reused. It requires a reliable author fingerprint and validated timestamp, groups verified viral-event fingerprints before counting, measures source-family/time-bucket breadth and concentration, and fails closed when identity is unavailable. Exact content and canonical URL identities support exact dedupe only. Relational episode links preserve both originals; they require same-topic identity and a verified basis (exact hash, exact approved URL, provider relation, or attributable manual review). Semantic similarity does not merge records.

Lineage remains relational: source item/conversation/evidence nodes → episode → verified duplicate/event links → global topic/entity → candidate evaluation → normalized episode contribution refs. No raw source is copied into SEO tables. Topic identity uses a global `intelligence_family`, not a customer product identity.

The pure `evaluateReviewedPublicCandidate()` adapter validates reviewed global topic identity, attributable topic privacy/copyright review, and each source policy, maps only accepted episodes into `measureIndependentEpisodes()` and the existing `evaluateOrganicEligibility()` function, preserves normalized episode references, and applies Search Console priority only after eligibility. It does not infer topics or source rights and does not write data. No production materializer or evaluation schedule is activated; source policies remain unreviewed.

## Production read-only inventory (2026-09-30)

The production queries read only metadata and aggregate counts; no bodies, author identifiers, URLs, or payloads were returned.

| Provider | Source rows | Missing author IDs |
| --- | ---: | ---: |
| GitHub | 180 | 46 |
| Hacker News | 38 | 0 |
| Stack Exchange | 37 | 0 |
| X | 37 | 0 |
| YouTube | 22 | 0 |
| Bluesky | 10 | 0 |
| **Total** | **324** | **46** |

The inventory contains 270 canonical conversations. There are 324 source-item evidence nodes with `workspace_id IS NULL`, 270 conversation evidence nodes with `workspace_id IS NULL`, and zero workspace-linked nodes among those source/conversation entity types. This establishes the current row scope only; it does not establish reuse rights, independent episodes, or topic identity.

The raw provider rows map to four current families: developer 180 (55.6%), community 75 (23.1%), social 47 (14.5%), and video comments 22 (6.8%). This is **raw inventory composition**, not independent source concentration and not candidate evidence. There are no reviewed source policies, global topics, or public feed tables in production. There are zero persisted SEO-2.6 candidates and no real candidate evaluation could be run because the feed does not exist in production. A read-only eligibility preflight excludes all 324 source rows before episode evaluation; this is a feed-ingestion exclusion count, not an SEO-2 candidate blocker distribution.

Therefore maturity, eligible, review-required, blocked, blocker, stale, duplicate/merged, and viral-concentration distributions are **not evaluated**, rather than zero-valued measurements. A statement that all candidates are blocked would be unsupported because there are no candidate objects.

## Threshold calibration

No threshold changed. The inventory has no reviewed evidence distribution from which to calibrate thresholds. The current four mapped third-party families also create a structural constraint: the existing `market_level` concentration cap is 0.20, while the independent-episode algorithm defines concentration as the largest family share. With at most four mapped families, perfectly even coverage has a minimum maximum share of 0.25. Thus the `market_level` gate cannot pass with only these four families. This is a model/taxonomy observation, not a reason to lower the gate. A fifth independently justified family would need to be reviewed and mapped before that gate can be reached.

## Migration safety and containment

Migration `20261103000000_seo26_public_intelligence_feed.sql` creates empty private tables, seeds only unknown provider policies and taxonomy definitions, adds Admin review authorization, and adds safe aggregate/candidate read functions. It does not copy production source or customer records and does not alter discovery, qualification, routing, Actions, billing, or production jobs.

The linked read-only `supabase migration list --linked` shows production through `20261102000000`; there are no remote entries for `20261027000000`, `20261028000000`, or `20261029000000`. The exact `supabase db push --linked --dry-run` output proposes only `20261103000000_seo26_public_intelligence_feed.sql`; it was not applied.

Pre-apply requirements:

1. Run the SQL against an isolated production-shaped schema based on the live `20261102000000` schema, including exact Admin constraints and `evidence_nodes` shape.
2. Review every `SECURITY DEFINER` function and trigger path, role grants, RLS, FK deletion behavior, and the exact `supabase db push --linked --dry-run` output.
3. Keep all provider policies `unknown` after migration. Do not backfill or ingest until each source policy, family mapping, global topic, HMAC key handling, and evidence identity method has a documented approval.
4. If production migration fails, stop. Do not repair migration history speculatively. If a source policy or topic changes after release, database triggers invalidate affected candidates and append a system audit event. Keep publication routes and sitemap entries absent.

Containment: if the migration transaction fails, make no follow-up history edits and keep the release blocked. If it is later approved and applies but an issue is detected before any policy/evidence/candidate data is seeded, keep all policies `unknown`, do not run the materializer, revoke the migration's service-role grants and reviewer RPC execution through a separately reviewed forward migration, and disable the Admin readiness entry if needed. Do not delete migration history or reverse tables that may have acquired data. If a failure occurs after data is present, preserve the records and use a reviewed forward correction; involve the Supabase operator for point-in-time recovery only if the database itself is damaged.

The isolated runtime rehearsal used Supabase CLI 2.75.0 and PostgreSQL 17.6 on Docker. Its temporary migration sequence contained the 57 production-valid migrations through `20261102000000`, with `20261027000000`, `20261028000000`, and `20261029000000` excluded. The baseline, candidate migration, containment reset to the baseline, and complete clean rerun succeeded. The temporary stack and data volumes were removed afterward.

Runtime verification found and fixed two SQL defects in commit `0cd3e1c8691531eea3cfc034f0c5e0aa21d3e18c`: the provider-key constraint rejected the registered one-character `x` key, and Supabase default table ACLs retained overly broad `service_role` grants. The migration now accepts 1–80 character provider keys and revokes default service-role privileges before its explicit grants.

The final schema has 11 RLS-enabled tables, 27 indexes, 129 constraints including 23 foreign keys, and 12 enabled triggers. All nine organic routines have empty search paths; PUBLIC execution and browser table grants are revoked. Service-role privileges match the declared per-table rights, and review-event access is SELECT-only. The summary RPC is service-role-only; the authenticated review RPC requires AAL2 and an active `organic_reviewer` membership. Local authorization fixtures were rolled back without creating candidates or evaluations. The focused organic, Admin, and Share Card migration contracts passed 17/17 tests. This establishes technical migration readiness; it does not approve evidence use or candidate evaluation.

## Current recommendation

**Technically RELEASE-READY** for the dormant private foundation migration. **NO-GO** for a controlled 20–50 page cohort. There are no approved source policies, public topic identities, public episodes, candidate evaluations, or candidate projections. Do not lower thresholds. Evidence use, source-to-family mapping, secure HMAC key provisioning, and candidate evaluation require separate approvals; the dormant release does not begin those activities.
