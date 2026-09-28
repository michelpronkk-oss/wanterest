# Performance & Data Delivery P2.1

Branch: `performance-p2-1-hot-paths`  
Starting SHA: `dc4f97713693adfc22fdd5dbdc28c0b4c996986c`  
Access mode and deployment were not changed.

## Measurement method

The before/after comparison uses the P1 production read graph and representative in-memory fixtures. Production-authenticated route timing was not repeated because this change is intentionally feature-branch-only. The opt-in `withPerformanceAudit` helper records route duration, named dependency duration, repository-call count, and row counts without recording tokens, emails, evidence text, raw payloads, or auth material. Structural tests assert bounds and batch-call cardinality instead of wall-clock thresholds.

## Read-graph results

| Path | Before | After |
| --- | --- | --- |
| Signals | 1 signal read + 19 ranking reads + up to 5 dependent reads per signal; approximately 115 reads for 19 signals | 1 ranked/bounded route-specific read model + up to 5 constant-size batches: 6 calls for a non-empty page, independent of displayed signal count |
| Overview inbox | Five independent branches: Signals, Gap, Drift, Actions, Experiments; recomputed per invocation | One request-scoped cached inbox snapshot. The five branches remain semantically separate and concurrent; Signals and Actions are bounded/batched, and duplicate `getInboxItems` calls in one request reuse the same promise |
| Actions | Base list + four child reads per action, including a duplicated feedback read: approximately `1 + 4N` | Bounded base list + three child collection batches: `1 + 3` for a non-empty list |
| Currentness | Cluster list → membership → latest state → contribution/lifecycle waterfall | Membership/latest-state in parallel, then contribution/lifecycle in parallel after their required inputs |
| Gap/Drift | V2 and legacy reads serialized on pages that intentionally render both | V2 and legacy reads run concurrently; legacy fallback remains |
| Geography | Capability resolution duplicated and historical/current reads serialized | Caller-provided request-scoped capabilities avoid the duplicate resolution; historical/current reads run concurrently after gating |

Signals preserves the existing lifecycle filters, score ordering (`opportunity_score desc`, then `created_at desc`), date bounds, text fields, feedback state, qualification evidence, source metadata, and evidence-node IDs. The SQL read model joins the immutable ranking only for ordering/score retrieval; it does not recalculate qualification or mutate any row. The in-memory adapter mirrors those filters for contract tests.

## Validation

- Focused hot-path/domain suites: 97 tests passed.
- Full Vitest baseline: 197 files passed, 13 skipped; 1,587 tests passed, 16 skipped. The only 3 failures are the known CRLF-sensitive Layer 11 pair and Layer 13A.4 migration test; no changed-surface test failed.
- Lint: passed; two pre-existing unused-parameter warnings in `tests/modules/waitlist-admission.test.ts`.
- Build: passed with Next.js 16.3.5/Turbopack.
- Typecheck: the standalone repository command still reports the pre-existing Layer 13A access-mode generated-type errors in `src/server/modules/access/access-mode.repository.ts`; the production Next build's TypeScript phase passed.

## Deliberately deferred

No persistent cache, speculative index, region move, universal dashboard RPC, frontend redesign, or 13B work was added. P2.2 should use `EXPLAIN` after the new read shapes are deployed for validation, then decide on composite indexes, any further narrow route RPCs, keyset pagination, short-TTL workspace-private caching, streaming/client splits, and the Vercel/Supabase regional question.
