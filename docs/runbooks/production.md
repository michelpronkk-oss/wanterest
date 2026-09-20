# Production runbook

## Health and readiness

`GET /api/health` is a safe liveness/readiness check. It returns no credentials, provider
payloads, or environment values. A successful database probe reports `readiness: "ok"`; a failed
probe reports HTTP 503 while liveness remains `ok`. Reddit is an optional provider and is reported
as non-blocking, so Reddit approval or configuration cannot take the application out of readiness.

Use the `x-request-id` response value as the correlation ID when inspecting structured logs and
job records. Provider errors must be sanitized before they enter source health, job error details,
or logs.

## Experiment incidents

1. Read the experiment diagnostic read model: lifecycle, assignments, unique exposures, outcomes,
   latest result state, and data-quality status.
2. If public events are being abused, revoke the experiment token. Do not delete events or mutate
   variants/results.
3. Pause the experiment to stop new assignments and events while preserving its evidence.
4. Inspect the append-only event idempotency boundary and the assignment/variant consistency
   errors. Re-submit only with the original stable event ID.
5. Recompute results through the bounded `recomputeExperimentResults` command. This creates a new
   immutable result revision and never overwrites a historical calculation.

## Source incidents

Use `source_controls` to pause a provider during an outage or disable it when approval/configuration
is unavailable. `next_retry_at` and `failure_count` provide a lightweight circuit-breaker window.
Fixture, Hacker News, and Bluesky are enabled by default in the Phase 7 seed; Reddit is disabled
until approval and credentials are available. Re-enable only after a bounded health check and a
successful fixture/replay test.

## Job failures and replay

Inspect recent, failed, and stuck `job_runs` before retrying. A retry must retain its trace and
idempotency key. A failure that reaches the configured retry ceiling is terminal and needs an
operator decision; it must not loop indefinitely. Replay and backfill commands accept only a
bounded `limit` (maximum 500), optional cursor, and `dryRun`. Replay uses stored raw evidence or
immutable engine/version inputs and does not silently refetch a provider.

Supported command contracts are:

- `replayRawSourceItem`
- `replayConversationAnalysis`
- `replayProductMatch`
- `replayDemandIntelligence`
- `replayActions`
- `reprocessBillingWebhook`
- `reconcileBillingSubscription`
- `recomputeExperimentResults`

## Billing and consistency

Billing diagnostics compare normalized subscription state with the internal entitlement revision;
provider product IDs are never capability names. Use read-only reconciliation first. Ingestion and
demand consistency checks report orphan workspace or missing evidence references without repairing
rows in place. Repair is a forward, idempotent operation with an audit record.

## Retention and redaction

Raw and derived evidence are retained for replay and provenance according to their retention class.
Logs default to 30 days. Billing records follow provider/legal policy. Automatic deletion is
bounded and policy-driven; it never runs as an incidental error handler. Authorization headers,
cookies, API keys, tokens, webhook signatures, payment instruments, and raw subject identities are
redacted or rejected at the boundary. Experiment subject keys are hashed before persistence.

## Verification

The offline system fixture smoke is:

```bash
npm run smoke:system
```

Before a release, run the Phase 1–7 regression commands, both billing/source smokes, build, and
`git diff --check`. The system smoke must remain network-free.
