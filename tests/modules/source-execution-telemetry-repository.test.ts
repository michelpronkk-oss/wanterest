import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { persistProductQueryResultOutcomes, persistSourceQueryExecution } from "../../src/server/modules/operations/source-execution-telemetry.repository";

const uuid = "00000000-0000-4000-8000-000000000001";

describe("source execution telemetry repository", () => {
  it("persists aggregate counts and stable IDs without query, cursor or provider content", async () => {
    const writes: Array<{ table: string; values: unknown; options?: unknown }> = [];
    const client = { from(table: string) { return { upsert(values: unknown, options?: unknown) { writes.push({ table, values, options }); return Promise.resolve({ data: [], error: null }); } }; } };
    await persistSourceQueryExecution(client, {
      id: uuid, executionKey: "a".repeat(64), parentJobRunId: uuid,
      queryPlanFingerprint: "b".repeat(64), sourceKey: "github", queryFamily: "pain", intentFamily: "pain_frustration", queryVariantVersion: "signal_query_diversification_v1", selectionReason: null, noveltyState: null, demandSurface: "pain_first",
      pagesRequested: 1, pagesCompleted: 1, continuationCount: 0, stopReason: "no_cursor", executionStatus: "completed_with_results",
      providerResultsReturned: 1, rawSnapshotsAccepted: 1, rawSnapshotsInserted: 1, rawSnapshotsDuplicate: 0,
      uniqueProviderItems: 1, duplicateProviderItems: 0, normalizedItems: 1, uniqueRoots: 1, duplicateRoots: 0,
      errorCode: null, startedAt: "2026-09-25T00:00:00.000Z", completedAt: "2026-09-25T00:00:01.000Z", durationMs: 1000,
      pages: [{ id: uuid, pageNumber: 1, sourceJobRunId: uuid, cursorRequested: false, providerResultsReturned: 1, rawSnapshotsAccepted: 1, rawSnapshotsInserted: 1, rawSnapshotsDuplicate: 0, normalizedItems: 1, uniqueProviderItems: 1, duplicateProviderItems: 0, uniqueRoots: 1, duplicateRoots: 0, continuationAvailable: false, continuationFollowed: false, stopReason: "no_cursor", rateLimitRemaining: 99, retryAfterMs: 1250, attemptCount: 1, durationMs: 1000, observedAt: "2026-09-25T00:00:01.000Z" }],
      results: [{ id: uuid, pageId: uuid, resultOrdinal: 1, rawSourceItemId: uuid, sourceItemId: uuid, conversationId: uuid, rawSnapshotInserted: true, firstProviderItemInExecution: true, firstRootInExecution: true }],
    });
    await persistProductQueryResultOutcomes(client, [{
      sourceResultAttributionId: uuid, conversationId: uuid, workspaceId: uuid, productId: uuid, matchJobRunId: uuid, attemptNumber: 1,
      selected: true, evaluated: true, qualificationStatus: "qualified", evaluationId: uuid, signalId: uuid,
      evidenceEligible: true,
    }]);

    const serialized = JSON.stringify(writes);
    expect(writes.map((write) => write.table)).toEqual([
      "source_query_executions", "source_query_execution_pages", "source_query_result_attributions", "product_query_result_outcomes",
    ]);
    expect(serialized).toContain("query_plan_fingerprint");
    expect(serialized).toContain("cursor_requested");
    expect(serialized).not.toMatch(/query_text|normalized_query|cursor_value|author_name|payload_json|provider_body/i);
    expect((writes[0]?.values as Record<string, unknown>)).toMatchObject({ intent_family: "pain_frustration", query_variant_version: "signal_query_diversification_v1", selection_reason: null, novelty_state: null });
    expect((writes.at(-1)?.values as Array<Record<string, unknown>>)[0]).toMatchObject({ selected: true, evaluated: true, qualification_status: "qualified", evidence_eligible: true });
    expect(writes.at(-1)?.options).toEqual({ onConflict: "workspace_id,product_id,match_job_run_id,attempt_number,source_query_result_attribution_id", ignoreDuplicates: true });
  });
});
