# Wanterest P2.2A — Query Plans & Residual Bottleneck Audit

Date: 2026-09-28  
Production commit: `aab084f473a90d9f1c1577b53553d660f322b693`  
Production deployment: `dpl_8XfkRgcWECnBEhnVw9qRjY3tEXsn`  
Branch: `performance-p2-2-query-plans-pagination`

## Scope and safety

This is an audit only. No application code, schema, migration, environment variable,
production business row, access state, scan, Dodo operation, or deployment was changed.
`WANTEREST_LOCAL_HANDOFF.md` was left untouched and remains untracked.

The production database was queried read-only. `EXPLAIN ANALYZE` was used only for bounded,
representative reads or small, explicitly scoped equivalents. The outer plan for the
Signals RPC was also captured; PostgreSQL exposes that call as a `Function Scan`, so the
underlying equivalent SQL was inspected separately to make index and sort behavior visible.

## 1. Baseline and production state

- `HEAD`, `origin/main`, and the expected production SHA are all
  `aab084f473a90d9f1c1577b53553d660f322b693`.
- The branch starts exactly at that SHA.
- Production Supabase project: `hudjhlkbizngahpadqpt`, region `eu-west-1`, active/healthy,
  PostgreSQL `17.6.1.166`.
- Vercel production execution/build region observed for the deployment: `iad1` (Washington
  DC). This creates an `iad1` to `eu-west-1` application/database path.
- Production access mode is `invite_only`.
- Representative production counts: 19 signals, 0 actions, 0 experiments, 73 demand gaps,
  50 demand drifts, 231 demand snapshots, 146 demand observations, 1,406 snapshot phrases,
  74 snapshot themes, 174 product matches, 260 product-match evaluations, and 30 rankings.
- All 19 current production signals are historical (`invalidated` 10, `archived` 7,
  `dismissed` 2). The default Signals active/saved query therefore legitimately returned
  zero rows. No production data was manufactured to change that result.

## 2. Complete hot-query inventory

### Overview and inbox

`src/components/dashboard/inbox.ts` uses request memoization and a performance audit around
five concurrent branches: Signals with limit 1, Gap, Drift, proposed Actions with limit 1,
and Experiments. The branches are bounded at the UI contract level, but legacy Gap snapshot
selection can read all snapshots when no snapshot ID is supplied. Legacy Drift first reads
all drifts for the product and performs its snapshot and drift awaits serially. These are
the main inherited residuals in the otherwise parallel inbox.

The product Overview page also starts six read branches concurrently (read-first
intelligence, actions, drift, drift v2, digests, and monitoring). No N+1 pattern was found
in the P2.1 batched intelligence path.

### Signals list and detail

The list path is:

`listSignalsQuery` -> `IntelligenceService.listSignals` ->
`SupabaseIntelligenceRepository.listSignalPage` -> `list_signal_page` RPC.

The RPC accepts workspace, optional product/lifecycle/intent/source/date/score/text filters,
limit, and offset. The default page limit is 26 and is capped at 101; the page UI bounds the
page number to 0..1000, truncates text input to 200 characters, requests one extra row, and
slices to the page size. Ordering is opportunity score descending and signal creation time
descending. P2.1 batches related data; no per-row N+1 was found.

Signal detail performs bounded signal/product reads and uses the already-loaded drawer data
for presentation. It does not introduce a new list or history scan.

### Saved

Saved uses the same Signals RPC with lifecycle `saved` and a limit of 50. It is intentionally
bounded but has no user-facing page continuation. It is `BOUND_ONLY` while saved volume is
small; keyset pagination is not justified by current evidence.

### Actions and action history

The Actions page reads a 25-row product list, then concurrently batches variants, feedback,
and events. The list is wrapped in `withPerformanceAudit("Actions")`. Detail history is
bounded by action ID and has child indexes on action ID and creation time. The list query
filters workspace/product and stale state, orders priority and creation time, and currently
returns no rows. There is no per-action child query loop in the page path.

### Experiments

Capability resolution precedes the list read. The measurement repository caps product
experiments at its configured list limit (documented as <=100), then batch-reads variants
and results. Experiment observations are bounded (documented as <=200 per experiment) and
indexed by workspace, experiment, window role, and recording time. There is no current
production experiment data and no N+1 in the list path.

### Demand Map, Gap, Drift, and Geography

- Map selects a snapshot for the requested window, then concurrently reads themes, phrases,
  alternatives, and intents. The v2 path additionally reads currentness/cluster data.
- Gap selects an explicit snapshot when supplied. Without one, legacy `getDemandGap` calls
  `listSnapshots(workspace, product)` without a window predicate, orders all snapshots, and
  picks the first. This is the clearest unbounded derived read.
- Drift reads snapshots with a window predicate but then calls `listDrifts(workspace,
  product)` without a current-snapshot predicate. The snapshot and drift awaits are serial,
  followed by serial phrase and alternative reads. The current data set is small, but the
  query shape will scale with retained drift history.
- Geography reads current observations and optional previous observations serially, then
  reads conversations and source/analysis/raw-signal data. Observation windows are
  bounded by time and indexed. The `rawSignals = listSignals(workspace, product)` branch is
  unbounded by route contract and currently sorts all 19 product signals.

### Currentness

Currentness lists product clusters, then concurrently reads memberships and latest states;
contributions and lifecycle are also batched. The current-state read is capped by
`DEMAND_CLUSTER_STATE_READ_LIMIT`. No per-cluster N+1 was found. The contribution/provenance
lookup is indexed, although its current plan has noticeable planner/API overhead at this
small scale.

### Settings and membership

Settings concurrently reads the current product snapshot, billing, members, scan summary,
and active experiments. Members are workspace-scoped and ordered by creation time. Admin
user enrichment is paginated in batches of up to 1,000. No production membership volume
requires a new pagination strategy today.

## 3. Production EXPLAIN findings

All figures below are from read-only production observations for a representative authorized
workspace/product, not synthetic data.

| Read | Plan and evidence | Assessment |
|---|---|---|
| Signals RPC outer plan | `Function Scan on list_signal_page`; estimated total cost 10.25, 1,000 plan rows | Expected RPC opacity; inspect body/equivalent SQL separately. |
| Signals RPC, default lifecycle | 0 rows; 13.086 ms execution; 1,372 shared hits | Bounded but materially higher than equivalent SQL; repeat was 3.279 ms. Investigate RPC overhead/body before changing contract. |
| Signals RPC, dismissed lifecycle | 2 rows; 4.605 ms then 3.331 ms; 1,372 shared hits | Correct result and bounded; buffer footprint is the residual concern. |
| Signals equivalent, default | Nested loop + incremental sort; `rankings_score_idx` and `signals_product_current_lifecycle_idx`; 0 rows; 0.248 ms; 41 hits | Index coverage is good for the observed query shape. |
| Signals equivalent, dismissed | 2 rows; 0.990 ms; 71 hits; 27 KB sort; 58 rows removed by join filter | Good underlying plan; RPC path deserves P2.2B profiling. |
| Actions list | Workspace index scan with product/stale filtering; quicksort 25 KB; 0 rows; 0.123 ms; 8 hits | Current cost is trivial; query/index alignment should be rechecked before growth. |
| Demand gaps | Sequential scan of 73 rows; quicksort 57 KB; 0.346 ms; 5 hits | Existing score index is correctly rejected at this size; no index action justified. |
| Demand drifts | Product/current-snapshot index; 1 row; 0.158 ms; 5 hits | Good bounded plan; repository still reads all drifts before selection. |
| Snapshots without window | Sequential scan of 231 rows; quicksort 264 KB; 1.435 ms; 34 hits | Route shape is unbounded across windows; fix bound/query semantics before adding an index. |
| Snapshots with 30d window | Product/window/period index; 77 rows; 3.339 ms; no explicit sort | Correct index coverage for Map/Drift windowed reads. |
| Observations current window | Product/time index; 64 rows vs 66 estimated; 1.071 ms; 19 hits | Good estimate and index use. |
| Observations previous window | Product/time index; 27 rows vs 37 estimated; 0.211 ms; 7 hits | Good bounded path; serial application awaits remain. |
| Geography raw signals | Product/lifecycle index prefix, then sort; 19 rows; 0.409 ms; 16 hits | Current cost is low, but no route bound exists. |
| Workspace members | Composite workspace index via bitmap heap; 1 row; 1.416 ms; 5 hits | Indexed and small; no new index justified. |
| Experiments | Workspace/status index with product filter; 0 rows; 0.129 ms; 5 hits | Bounded and currently empty. |
| Snapshot phrases | Snapshot unique index; 13 rows; quicksort 27 KB; 2.109 ms; 17 hits | Indexed and bounded by snapshot. |
| Currentness cluster reads | Cluster natural-key index, membership product index, and cluster-state product index; 4/20/10 rows; <=1.427 ms each | Good coverage; no N+1. |
| Currentness provenance lookup | Nested loop through concept-state latest index and provenance composite index; 0 matched links; 12.086 ms; 22 hits | Small-data planner/API overhead; measure in an authenticated route before optimizing. |

The Signals RPC is the only measured path where the same logical read showed a meaningful
gap between the RPC wrapper and the direct equivalent. The measurement is not sufficient by
itself to replace the RPC: the RPC owns filtering and return-shape semantics, and the outer
plan cannot expose its internal nodes. P2.2B should profile the function body and correlate
it with route-level timings first.

## 4. Signals plan assessment

P2.1 removed the major list-path problems: the RPC is bounded, the page contract caps the
limit, the workspace predicate is present, the relevant product/lifecycle and ranking
indexes are used by the equivalent query, and related rows are batched. There is no evidence
of an unbounded Signals page or an N+1 regression.

The residual is the RPC execution footprint: 1,372 shared hits and 3.3-13.1 ms execution
in the captured calls versus 41-71 hits and 0.25-0.99 ms for the equivalent SQL. Because the
default lifecycle returned no rows, this should not be treated as a complete production
representative benchmark. Repeat with an existing authorized session and representative
non-empty lifecycle data, then inspect `pg_proc`/function-body behavior and route timings.

## 5. Remaining high-cost or high-risk queries

Ranked by risk rather than only current milliseconds:

1. Legacy Gap snapshot discovery reads all product snapshots when no snapshot ID is given.
2. Legacy Drift reads all product drifts, and its awaits are serial before downstream reads.
3. Geography reads all product signals without a route-level bound; observation branches are
   serial when a previous window is requested.
4. Signals RPC has a higher measured buffer/latency footprint than its equivalent query.
5. Actions stale filtering does not match the most selective existing product/status/priority
   index; current data is empty, so this is a scale-sensitive candidate, not an immediate fix.
6. Currentness provenance has 12.086 ms observed planning/execution overhead at a tiny row
   count; it needs authenticated route timing before any design change.

The measured demand gaps and snapshots sequential scans are not currently bottlenecks by
themselves. Their route-level bounds should be corrected before index work.

## 6. Existing index coverage

Relevant coverage is already present for:

- Signals product/lifecycle/creation and ranking score ordering.
- Product matches and qualified evaluation lookup.
- Actions trigger, product/status/priority/creation, variants, feedback, and events.
- Demand snapshots product/window/period, gaps product/score, drifts product/current snapshot,
  and observations product/time/facet.
- Currentness clusters, memberships, latest states, and evidence provenance links.
- Experiments workspace/status/due/recompute, variants, and observations.
- Workspace membership composite identity and active-user lookup.

The main mismatch is not a missing universal index. It is that several repositories omit
the predicate that would let these indexes be useful: Gap omits window, Drift omits current
snapshot, Geography omits a signal bound, and Actions omits the product/status shape that
the existing priority index expects.

## 7. Evidence-backed index recommendations

No index should be added in P2.2A. The current data is too small to justify speculative write
overhead, and the highest-value issues are query bounds and serial dependencies.

P2.2B may benchmark one narrowly scoped Actions candidate: a partial product-oriented index
whose leading predicates and ordering exactly match the production list query, potentially
including `stale_at IS NULL`. The final definition must be selected only after capturing the
actual status/stale predicates, row counts, write rate, and `EXPLAIN (ANALYZE, BUFFERS)` on a
representative non-empty fixture or production-safe sample. Do not add it from this audit
alone.

Do not add indexes for Demand gaps or unwindowed snapshots merely to hide a sequential scan:
the current plans are sub-2 ms with 73-231 rows, and the correct fix is to bound the read.

## 8. Unbounded and history findings

- Signals UI pagination is bounded by limit and page-number caps, but offset cost will grow
  linearly with deep pages. No current scale evidence requires keyset migration.
- Saved is capped at 50 and has no continuation contract.
- Legacy Gap snapshot selection is unbounded across window types.
- Legacy Drift obtains all product history before selecting comparable records.
- Geography obtains all product signals for its derived view.
- Actions history children are bounded by action ID and indexed.
- Experiment observations and currentness state reads have explicit caps.
- Map/Drift windowed snapshot reads are bounded by the window and use the matching index.

## 9. Pagination decisions

| Surface/query | Decision | Rationale |
|---|---|---|
| Overview/inbox | `BOUND_ONLY` | Each branch has a small limit; fix inherited Gap/Drift bounds first. |
| Signals | `OFFSET_ACCEPTABLE` | Page and limit are capped; current production volume is 19 and no deep-page evidence exists. |
| Signal detail | `NO_CHANGE` | Single-record reads. |
| Saved | `BOUND_ONLY` | Fixed 50-row saved view; no scale signal for continuation yet. |
| Demand Map | `BOUND_ONLY` | Latest window snapshot plus bounded child reads. |
| Demand Gap | `BOUND_ONLY` | Select one current/window snapshot; do not paginate derived gap cards. |
| Demand Drift | `BOUND_ONLY` | Select comparable current/previous snapshots and their derived drift set. |
| Geography | `BOUND_ONLY` | Time-window observations and derived current view; bound raw signal support read. |
| Actions | `BOUND_ONLY` | 25-row page plus bounded child batches/history. |
| Experiments | `BOUND_ONLY` | Configured list/variant/result/observation caps are sufficient today. |
| Currentness | `BOUND_ONLY` | Explicit state cap and cluster-level batches. |
| Settings/membership | `BOUND_ONLY` | Current workspace membership volume is small; existing admin batch is 1,000. |
| Future export/admin history | `KEYSET_RECOMMENDED` only if exposed | A future unbounded history/export contract should use stable timestamp+UUID keyset; no implementation is justified now. |

No keyset pagination should be implemented in P2.2A.

## 10. Authenticated timing

`AUTHENTICATED_TIMING = NOT_OBSERVED`.

No existing authorized browser session was available in this environment, and no login or
data creation was attempted. Production instrumentation exists in
`src/server/lib/performance-audit.ts`, but whether `WANTEREST_PERF_AUDIT=true` is enabled
for the deployment was not changed or assumed.

Founder procedure for the next validation pass:

1. Open an existing authenticated `https://app.wanterest.com` session.
2. In DevTools Network, enable Preserve log and Disable cache.
3. Record five normal loads each for Overview `/app`, Signals `/app/signals`, and Actions
   `/app/actions`; perform no mutations and trigger no scans.
4. Capture document/request totals, server timing if present, and matching Vercel
   `[performance-audit]` records if the existing production flag is enabled.
5. Report median, p95, request IDs, and whether the response was warm or cold. Do not create
   production data to make the Signals list non-empty.

## 11. Region, caching, and streaming

The observed path is Vercel `iad1` to Supabase `eu-west-1`. This is a credible source of
round-trip cost because several pages fan out to multiple database reads. The audit did not
move either service. First collect authenticated route timings and compare request count,
server time, and database time; only then evaluate an execution-region change.

Do not add a persistent cache for authentication, membership, access, billing, entitlements,
or authorization decisions. Keep request-local memoization already used by dashboard and
capability reads. A short-lived cache may be reconsidered individually for stable, expensive
derived Map/Gap/Drift reads only after query bounds and route timings prove a repeated-read
problem. No cache is justified from this audit alone.

Streaming is not required for the measured core reads. It could be considered later for
secondary Map/Geography detail panels after the primary summary query is efficient; it must
not be used to mask unbounded reads or delay authorization.

## 12. Verification status and gaps

Passed on this branch without source changes:

- 9 focused test files, 83 tests passed, including database RPC/type contracts, intelligence,
  actions, Gap/Drift policy, currentness, current geography, map reads, and geography.
- `npm.cmd run typecheck` passed.
- `npm.cmd run lint` passed with two pre-existing warnings in
  `tests/modules/waitlist-admission.test.ts` for unused `_message` parameters; zero errors.
- Production migration/type consistency was read-only inspected; no migration was applied.
- Existing performance instrumentation and P2.1 batching were inspected.

Exact remaining gaps:

- No authenticated browser timings or route-level request IDs.
- No non-empty active/saved Signals result in production, so the RPC comparison is not a
  complete workload benchmark.
- No scale fixture or write-rate evidence for an Actions stale/product composite index.
- The outer RPC plan cannot expose internal function nodes; function-body and route-level
  correlation remain.
- Region latency was inferred from observed deployment/database regions, not measured in a
  founder browser session.
- No load test was run and no new benchmark fixture was written.

## 13. Prioritized P2.2B backlog and scope

1. Bound Gap snapshot selection by the requested window/current snapshot and ensure the
   derived read is one-row/one-window. Small query-shape change; add repository contract and
   plan regression coverage.
2. Bound Drift to the comparable current/previous snapshots and make independent reads
   concurrent where semantics permit. Small-to-medium repository/service change.
3. Bound Geography's raw signal support read and parallelize independent observation windows.
   Small-to-medium service change with contract tests.
4. Instrument and compare Signals RPC versus the direct equivalent under an authorized,
   non-empty workload; only then decide whether the RPC body or call path needs optimization.
   Medium investigation; implementation is conditional.
5. Benchmark the Actions query against realistic scale before considering one exact partial
   or composite index. Medium migration/index task only if evidence crosses a meaningful
   threshold.
6. Re-measure currentness provenance and region placement after the above changes. Defer
   cache/streaming decisions until this evidence exists.

Estimated implementation scope for P2.2B is small-to-medium: approximately 2-4 focused
repository/service changes, associated contract/plan tests, and possibly one migration only
if the Actions benchmark proves it. This is not a license to touch lifecycle, ranking,
discovery, qualification, access, experiments, benefits, referrals, or Evidence Fidelity.

## 14. Decision

P2.2B is justified as a narrow query-bound/concurrency and measurement pass. P2.3 is not
yet justified; reconsider it only after P2.2B verification, authenticated timing, and the
region comparison show a residual product-level latency problem rather than a query-shape or
deployment-placement issue.

**P2.2A: AUDIT_COMPLETE / IMPLEMENTATION_JUSTIFIED**
