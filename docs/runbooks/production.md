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

## Trigger.dev product scans

The Vercel/server-action path only validates and queues `product-demand-scan`; the Trigger.dev
worker owns durable execution. Inspect the linked `job_runs` row first, using its `trace_id`,
`trigger_run_id`, `idempotency_key`, `attempt_count`, `input_reference.progress`, and redacted
`error_details`. Then inspect the corresponding Trigger run and the per-source diagnostics in the
stored result. Do not retry by inventing a new idempotency key unless a genuinely new scan was
requested.

`discover-product-source` child runs are isolated by source. A failed or unavailable source must
not cause successful source work to be repeated; X insufficient credits and unconfigured Reddit
are expected nonfatal warnings. A scan can finish with database status `succeeded` and result state
`complete_with_warnings`. Entitlement failure, invalid product/workspace context, or a database
integrity failure is fatal and must be corrected before retrying.

Scan dispatch is durable independently of execution. `job_runs.dispatch_status` records
`unclaimed`, `claimed`, `linked`, `not_applicable`, `failed`, or `orphaned`; a pending/running row
is active only while its claim is within the short dispatch grace window, its Trigger run is
provider-active, or its direct execution is explicitly marked `not_applicable`. A linked run that
is terminal at Trigger.dev, or a claim that never links a run after the grace window, is marked
`failed_terminal`/`orphaned` with a redacted error and becomes retryable. The application checks
Trigger status conservatively and uses the original idempotency key when a successful provider
dispatch was not yet linked to PostgreSQL, preventing a second run. Never delete a stuck row or
blindly dispatch a replacement while the original claim/run is still valid.

For local operation, put a Trigger.dev Development API key in `.env.local` as the server-only
`TRIGGER_SECRET_KEY`, then run `npm run dev` and `npm run trigger:dev`; both processes must use
the same project/environment key and project configuration. For production task changes, use the configured
Trigger project and `npm run trigger:deploy`; do not deploy Trigger tasks from a browser or expose
the secret to Vercel client bundles. The direct execution mode is reserved for tests/debugging and
does not replace the durable worker.

## Product-understanding provider

Set the server-only `OPENAI_API_KEY` in the same `.env.local` used by Next.js and the local
Trigger.dev worker. `OPENAI_MODEL` is optional and defaults to `gpt-4.1-mini`. Do not expose either
value through a `NEXT_PUBLIC_` variable. The onboarding product-understanding command records
provider/model/operation/latency/status diagnostics without prompts or user text. Missing or failed
OpenAI calls are distinguishable from low-confidence normalized output; the deterministic fixture
fallback is explicit in diagnostics and is not presented as a successful OpenAI result.

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
