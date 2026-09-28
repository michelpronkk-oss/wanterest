# Wanterest P2.2B — Evidence-Based Query-Bound Implementation

Date: 2026-09-28
Base branch SHA: `aab084f473a90d9f1c1577b53553d660f322b693`
Feature branch: `performance-p2-2-query-plans-pagination`

## Scope

This pass implements only the residual query-shape/concurrency work justified by the P2.2A
audit. No production deployment, production data mutation, artificial scan, Dodo call,
Signals RPC replacement, Actions index, cache, region move, or keyset pagination was added.

## Gap

Before, legacy Gap selected a snapshot by loading all product snapshots and then finding the
requested ID or taking the first row. The production audit measured 231 snapshot rows, a
sequential scan, and 1.435 ms execution for the unwindowed equivalent.

After, `DemandRepository` exposes:

- `getSnapshotById(workspaceId, productId, snapshotId)` for explicit historical reads.
- `getLatestSnapshot(workspaceId, productId, windowType?)` for one-row current selection.

Both Supabase methods include workspace and product predicates. The in-memory adapter uses
the same predicates, preserving test semantics and cross-workspace isolation. No gap rows or
historical calculations are truncated.

Status: `STRUCTURALLY PROVEN`; authenticated post-change production timing is not available.

## Drift

Before, legacy Drift loaded all product/window snapshots and all product drift rows, then
selected the newest comparable pair in application memory. Snapshot and drift reads were
serial, followed by serial phrase and alternative reads.

After, migration
`20260928050000_performance_p2_2b_comparable_drift_pair.sql` adds a stable, read-only,
service-role-only PostgreSQL function that joins the two snapshot rows and drift history,
applies the same window, equal-length, adjacent-period, workspace, and product semantics,
groups pairs, orders by current period/creation time, and returns exactly the newest pair.
The application then reads only pair-filtered drift rows. Phrase and alternative reads are
concurrent with the pair-filtered concept rows.

The in-memory adapter uses the existing pure `selectComparableDrifts` selector over complete
fixture history. This proves old/new pair selection equivalence without an arbitrary recent-N
sample. Tests include a newer overlapping invalid pair, a valid older pair, and a foreign
workspace row.

Before/after structural comparison:

| Metric | Before | After |
|---|---|---|
| Main history rows fetched | All window snapshots + all product drifts | One exact comparable pair + that pair’s drift rows |
| Main query depth | Snapshot read -> drift read -> phrase -> alternative | Pair RPC -> three concurrent pair reads |
| Comparable-pair semantics | Application selector | Same selector semantics in SQL, tested against in-memory reference |

Status: pair equivalence is `MEASURED` in the deterministic fixture and `STRUCTURALLY
PROVEN` in SQL. Authenticated production after-timing is `NOT_OBSERVED`.

## Geography

Before, Geography read all product signals, then filtered to active/saved in application
memory. The measured production equivalent fetched 19 rows and used 16 shared hits. Full
market totals correctly came from immutable demand observations, but the representative
signal lookup was broader than necessary. Current and previous observation reads were also
serial.

After:

- Current and previous observation reads run concurrently when history is enabled.
- Signal lookup is scoped to the observed conversation IDs, workspace, product, and active /
  saved lifecycle states.
- The signal projection remains narrow and the service retains its defensive lifecycle
  filter.
- Geography aggregation still consumes the complete current/previous observation population;
  only representative signal linking is narrowed.

The new test uses 18 eligible signals with `maxMarkets=2`: totals remain 18 and all 3 country
markets are calculated, while only 2 markets are returned in `topMarkets`. This proves the
display bound does not truncate full-market totals.

Before/after structural comparison:

| Metric | Before | After |
|---|---|---|
| Observation dependency | Current then previous serial | Current and previous concurrent |
| Signal rows fetched | All product signals | Signals for observed conversations only |
| Geographic totals | Full observation population | Full observation population |
| Display list | `maxMarkets` | `maxMarkets` unchanged |

Status: aggregation equivalence is `MEASURED` in the large fixture and `STRUCTURALLY
PROVEN` for the repository predicates. Authenticated production after-timing is
`NOT_OBSERVED`.

## Signals RPC

Unchanged. P2.1’s approximately six-call architecture, filtering, ranking meaning, and RPC
contract remain intact. The P2.2A RPC-vs-equivalent discrepancy remains an investigation
item; no semantically risky replacement was made.

## Actions and pagination

Actions indexes and query shape are unchanged because production has zero Actions and no
comparable scale evidence. Signals remains offset-paginated with existing bounds. No keyset
pagination was implemented.

## Security and isolation

- New snapshot reads require workspace and product equality.
- New drift SQL joins and predicates carry workspace/product scope.
- New Geography signal reads require workspace/product and lifecycle predicates.
- The comparable-pair database function is `SECURITY INVOKER` by default, has a fixed public
  search path, and is executable only by `service_role`.
- No browser-facing raw provider payload, membership, access, billing, or authorization data
  is cached or exposed.
- Evidence Fidelity, discovery, retrieval, qualification, lifecycle, ranking, Demand Map /
  Gap /
  Drift meaning, Actions, Experiments, access mode, admission/cohorts/referrals, and 12A.6
  measurement semantics were not changed.

## Verification

- Focused P2.2B set: 9 files, 82 tests passed.
- Full Vitest: 200 files passed, 1,593 tests passed, 16 skipped.
- Full-suite failures: 3 pre-existing CRLF-sensitive failures in Layer 11 and Layer 13A.4,
  matching the supplied baseline; no new P2.2B failure.
- Typecheck: passed.
- Lint: passed with two existing unused-parameter warnings in
  `tests/modules/waitlist-admission.test.ts`.
- Clean Next production build: passed.
- `git diff --check`: passed.
- Supabase migration contract and generated RPC type contract: passed.
- `supabase db lint --local` was not runnable because the existing `.env.local` contains an
  invalid variable name. The migration was not applied to production or any remote project.

## Performance classification

- `MEASURED`: P2.2A production baselines; deterministic fixture equivalence; full test/build
  results.
- `STRUCTURALLY_PROVEN`: Gap one-row targeting, Drift exact pair SQL selection, Geography
  conversation-scoped representative signal lookup, and reduced serial depth.
- `NOT_OBSERVED`: authenticated post-change route timings, production after-row counts for
  active Geography conversations, and production SQL timing for the unapplied migration.

## Remaining bottlenecks

1. Signals RPC internal execution/buffer footprint remains unresolved and requires an existing
   authorized non-empty workload.
2. `iad1` to Supabase `eu-west-1` round trips remain unmeasured at route level.
3. Actions index benefit remains unproven because production has zero rows.
4. Local Supabase SQL lint remains blocked by the malformed environment file.

P2.3 is not justified by this pass. Production validation is required before any broader
performance phase.

**P2.2B: IMPLEMENTATION_READY_FOR_PRODUCTION_VALIDATION**
