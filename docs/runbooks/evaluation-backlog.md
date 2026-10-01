# Bounded evaluation backlog — review candidate

This change is based on production `06ad381a94fe8cdb5e421da746cc6eaf65d75589`.
It is not applied or deployed. The production migration head read on 2026-10-01 was
`20261105000000`. The non-production 13B.2, 13B.3 and integration-repair versions
`20261027000000`–`20261029000000` are excluded from the local rehearsal and remain untouched.

## Canonical path and loss point

`runInitialScan` persists normalized source items and canonical conversations, then
`selectScanCandidates` applies source-specific query/evidence gates, deterministic content
dedupe, ranking and source/surface diversity. The current per-scan budget selects the first
bounded set. `processScanCandidates` analyzes those roots via `IntelligenceService`, matches
against the immutable demand profile, runs canonical Signal Qualification, optionally runs
the configured semantic shadow, persists a uniquely fingerprinted evaluation, ranks
qualifying evaluations, and uses `materializeSignal` for lifecycle-safe signal writes.
`runInitialScan` subsequently rebuilds demand intelligence and Actions under its existing
scan-mode policy. The old path retained only 100 cap-suppressed IDs in diagnostics and did
not evaluate or persist work for them.

The new queue receives **all** deduplicated, post-evidence-filter roots in the cap remainder
when the scan's evaluation entitlement is positive. Evidence-filter and dedupe failures never
enter it. The synchronous selection score, diversity, budget and qualification thresholds
are unchanged. No historical diagnostics are backfilled. A read-only production count found
36 recorded cap-suppression attributions across six scan jobs; this is not a distinct-root
count. The seven controlled scan #1 roots already have evaluations and are excluded by the
existing-evaluation check.

## Queue identity and processing

The unique key is `(workspace_id, product_id, conversation_id, demand_profile_id,
selection_fingerprint)`. The fingerprint covers current root/source content hashes, source
identity, product name, profile ID, classifier/matcher engine IDs, grounding setting,
qualification/threshold/fingerprint versions, and private selection provenance with scan
query IDs removed. The queue stores only references, hashes, the internal selection receipt,
score/rank, origin job ID and operational state. It stores no provider payload or author data.
The selected-candidate service still owns the actual evaluation fingerprint and unique
database constraint; the queue key schedules work and cannot replace that authority.

After the normal scan finishes, Trigger dispatches a queue worker if cap-eligible work was
seen. Each run claims at most five rows via an atomic `FOR UPDATE SKIP LOCKED` RPC, processes
sequentially in a queue of concurrency one, and schedules a later bounded continuation only
while queued or leased work remains. A claimed batch also arms a delayed 21-minute recovery
before evaluation, so a hard task timeout cannot strand its lease until another scan.
A run has a 15-minute maximum; leases recover after
20 minutes. Three attempts are allowed with exponential 1–2-minute backoff. Stale third
leases become exhausted. `EVALUATION_BACKLOG_PROCESSING_ENABLED=false` stops claims without
dropping pending work. There is no new recurring production schedule or daily discard cap.

Before processing, the worker checks the active product/current profile, canonical root and
active primary source, unchanged content hashes, evidence anchors, stored query provenance,
the same candidate evidence filters, unchanged input fingerprint and existing signal
state. Invalid or obsolete work is terminally skipped with a bounded code. Valid work calls
`processScanCandidates` on one persisted root, so analysis, matching, qualification, optional
semantic shadow, ranking and `materializeSignal` are the exact synchronous implementations.
Its output-derived evaluation fingerprint reuses a completed evaluation while allowing
signal materialization to resume if an earlier attempt stopped between those steps.
Qualified signals invoke the existing demand-intelligence rebuild. The worker does not invoke
source acquisition, query planning, a scan task, or Actions generation.

## Security and release order

`20261106000000_evaluation_backlog_v1.sql` adds one private RLS table and two `SECURITY
INVOKER` RPCs with empty `search_path`. PUBLIC, anon and authenticated get no table or RPC
privileges. `service_role` has only SELECT/INSERT/UPDATE on the table and EXECUTE on the two
RPCs; there is no DELETE/TRUNCATE/REFERENCES/TRIGGER grant. Admin Operations reads only the
aggregate summary RPC after existing `operations.read` and AAL2 checks. The page shows
unavailable rather than zero when the RPC cannot be read.

For a later approved release, apply the migration **before** deploying Vercel/Trigger code.
Verify recorded version, table RLS/grants and both RPC grants, then deploy the application and
Trigger worker together. Leave recurring monitoring paused and do not run a measurement scan
as part of this change. If the worker misbehaves, set the server/Trigger kill switch to false;
pending rows remain durable and visible. Do not delete or replay queue rows as containment.

Local PostgreSQL 17.6 rehearsal replayed the production-valid sequence through
`20261105000000` and the candidate migration, then clean-reset and replayed it again. A
synthetic transaction confirmed one idempotent insert, a second claim of zero, stale-lease
reclaims at attempts two and three, and terminal exhaustion at three; its fixture rolled back.
A separate two-session test showed the second worker cannot claim a locked row. A transactional
DROP and ROLLBACK restored the table. The final local reset left zero rows and recorded the
candidate version once. No production migration or queue data was changed.
