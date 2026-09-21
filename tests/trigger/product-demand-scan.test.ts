import { describe, expect, it } from "vitest";

import { jsonValueSchema, omitUndefined, type JobRunRow } from "../../src/server/db/database.helpers";
import { buildScanJobReference } from "../../src/server/modules/onboarding/scan-job-metadata";
import {
  frontendScanStatus,
  productDemandScanHandleSchema,
  productDemandScanInputSchema,
  productDemandScanRequestSchema,
  demandTaskInputSchema,
  scanCandidateReviewSchema,
  scanResultSummarySchema,
  scanProgressSchema,
  sourceScanResultSchema,
} from "../../src/server/modules/operations/product-demand-scan.schemas";
import { isTrustedProductDemandScanJob } from "../../src/server/modules/operations/product-demand-scan.authorization";
import { buildProductDemandScanInput, initialScanIdempotencyKey, isActiveProductDemandScanJob, manualScanIdempotencyKey, scanModeFromJob, selectActiveProductDemandScanJob } from "../../src/server/modules/operations/product-demand-scan.identity";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";

describe("product-demand-scan orchestration contract", () => {
  it("omits an undefined result from the pre-completion job metadata", () => {
    const reference = buildScanJobReference({
      phase: "preparing",
      result: undefined,
      progress: { stage: "preparing_product", percent: 5, currentLabel: "Understanding your product" },
    });

    expect(reference).not.toHaveProperty("result");
    expect(reference.progress).toMatchObject({ stage: "preparing_product", percent: 5, warnings: [] });
  });

  it("builds the JSON-safe setScanJob payload without optional undefined fields", () => {
    const reference = buildScanJobReference({
      phase: "discovering",
      result: undefined,
      progress: {
        stage: "discovering",
        percent: 40,
        warnings: undefined,
      },
    });

    expect(reference).toEqual({
      workflow: "product-demand-scan",
      phase: "discovering",
      errorMessage: null,
      progress: {
        stage: "discovering",
        percent: 40,
        completedSources: 0,
        totalSources: 0,
        currentLabel: "discovering",
        warnings: [],
      },
    });
  });

  it("removes nested undefined values and undefined array entries without stringifying metadata", () => {
    const value = omitUndefined({
      warnings: undefined,
      triggerRunId: undefined,
      nested: { failureReason: undefined, count: 2 },
      sourceResults: [undefined, { providerMetadata: undefined, items: ["item-1", undefined] }],
    });

    expect(value).toEqual({
      nested: { count: 2 },
      sourceResults: [{ items: ["item-1"] }],
    });
    expect(jsonValueSchema.parse(value)).toEqual(value);
  });

  it("keeps a completed result and validates every scan phase reference as JSON", () => {
    const phases = ["queued", "planning", "discovering", "processing", "qualifying", "building-intelligence", "generating-actions", "completed", "partial_failure", "failed"];
    for (const phase of phases) {
      expect(() => buildScanJobReference({ phase, result: undefined })).not.toThrow();
    }

    const result = { state: "complete_no_signals", rawItems: 0, normalizedItems: 0, conversations: 0, analyses: 0, evaluations: 0, rankings: 0, signals: 0, sources: [], diagnostics: [] };
    expect(buildScanJobReference({ phase: "complete_no_signals", result }).result).toEqual(result);
  });

  it("accepts the client-safe scan request shape", () => {
    const request = productDemandScanRequestSchema.parse({
      workspaceId,
      productId,
      scanMode: "manual",
      idempotencyKey: "manual-scan:one",
      forceRebuild: false,
    });

    expect(request).toEqual({
      workspaceId,
      productId,
      scanMode: "manual",
      idempotencyKey: "manual-scan:one",
      forceRebuild: false,
    });
    expect(productDemandScanRequestSchema.safeParse({ ...request, requestedByUserId: userId }).success).toBe(true);
  });

  it("requires the poll key to identify the durable scan job", () => {
    expect(productDemandScanHandleSchema.parse({
      jobRunId: productId,
      idempotencyKey: "manual-scan:workspace:product:1",
      status: "started",
      scanMode: "manual",
      triggerRunId: null,
    }).idempotencyKey).toBe("manual-scan:workspace:product:1");
  });

  it("requires server-owned request context for task execution", () => {
    expect(productDemandScanInputSchema.safeParse({
      workspaceId,
      productId,
      requestedByUserId: userId,
      scanMode: "onboarding",
      idempotencyKey: "initial-scan:one",
    }).success).toBe(true);
    expect(productDemandScanInputSchema.safeParse({
      workspaceId,
      productId,
      scanMode: "onboarding",
      idempotencyKey: "initial-scan:one",
    }).success).toBe(false);
  });

  it("maps persisted job progress to stable frontend statuses", () => {
    const progress = scanProgressSchema.parse({
      stage: "partial_failure",
      percent: 100,
      completedSources: 2,
      totalSources: 3,
      currentLabel: "Complete",
      warnings: ["Reddit credentials are not configured."],
    });

    expect(frontendScanStatus(progress, "pending")).toBe("queued");
    expect(frontendScanStatus(progress, "running")).toBe("running");
    expect(frontendScanStatus(progress, "succeeded")).toBe("completed_with_warnings");
    expect(frontendScanStatus(null, "failed_terminal")).toBe("failed");
  });

  it("keeps per-source result fields bounded and typed", () => {
    const result = sourceScanResultSchema.parse({
      sourceKey: "bluesky",
      planned: true,
      executed: true,
      status: "completed",
      queryCount: 1,
      candidateBudget: 10,
      itemsReturned: 10,
      rawItems: 10,
      normalizedItems: 10,
      warnings: [],
      errorCode: null,
      rateLimitRemaining: 100,
      estimatedCost: 0,
    });

    expect(result.sourceKey).toBe("bluesky");
    expect(sourceScanResultSchema.safeParse({ ...result, queryCount: -1 }).success).toBe(false);
  });

  it("keeps the dashboard result summary safe when optional builder counts are absent", () => {
    expect(scanResultSummarySchema.parse({
      rawItems: 8,
      normalizedItems: 8,
      conversations: 8,
      analyses: 8,
      evaluations: 8,
      rankings: 0,
      signals: 0,
      sources: ["github", "hacker-news", "x"],
    })).toMatchObject({ mapUpdated: 0, gapUpdated: 0, driftUpdated: 0, actionsUpdated: 0 });
  });

  it("accepts positional null signal IDs for evaluations filtered before materialization", () => {
    expect(demandTaskInputSchema.safeParse({
      workspaceId,
      productId,
      evaluationIds: ["00000000-0000-4000-8000-000000000004"],
      signalIds: [null],
      traceId: "trace-test",
    }).success).toBe(true);
  });

  it("keeps rejected candidates reviewable without turning them into Signals", () => {
    const review = scanCandidateReviewSchema.parse({
      evaluationId: "00000000-0000-4000-8000-000000000004",
      source: "github",
      title: "Linear integration",
      excerpt: "A bounded evidence excerpt.",
      canonicalUrl: "https://github.com/example/project/issues/1",
      status: "weak_candidate",
      scores: { relevance: 0.51, intent: 0.12, pain: 0.15, specificity: 0.49, evidence: 0.78, noise: 0.28 },
      reasonCodes: ["LOW_RELEVANCE", "INSUFFICIENT_INTENT"],
    });
    expect(review.status).toBe("weak_candidate");
    expect(scanResultSummarySchema.parse({ candidateReviews: [review] }).candidateReviews).toHaveLength(1);
  });

  it("requires the durable scan job to match actor, tenant, product, and idempotency context", () => {
    const input = productDemandScanInputSchema.parse({
      workspaceId,
      productId,
      requestedByUserId: userId,
      scanMode: "onboarding",
      idempotencyKey: "initial-scan:one",
      jobRunId: "00000000-0000-4000-8000-000000000004",
    });
    const job = {
      id: input.jobRunId,
      job_type: "discover-source",
      workspace_id: workspaceId,
      product_id: productId,
      idempotency_key: input.idempotencyKey,
      input_reference: { requestedByUserId: userId },
    } as unknown as JobRunRow;

    expect(isTrustedProductDemandScanJob(input, job)).toBe(true);
    expect(isTrustedProductDemandScanJob(input, { ...job, workspace_id: "00000000-0000-4000-8000-000000000005" })).toBe(false);
    expect(isTrustedProductDemandScanJob(input, { ...job, input_reference: { requestedByUserId: "00000000-0000-4000-8000-000000000006" } })).toBe(false);
    expect(isTrustedProductDemandScanJob(input, { ...job, idempotency_key: "different" })).toBe(false);
  });

  it("centralizes distinct initial and manual scan identities", () => {
    expect(initialScanIdempotencyKey(workspaceId, productId)).toBe(`initial-scan:${workspaceId}:${productId}`);
    const first = manualScanIdempotencyKey(workspaceId, productId);
    const second = manualScanIdempotencyKey(workspaceId, productId);
    expect(first).toMatch(new RegExp(`^manual-scan:${workspaceId}:${productId}:[0-9a-f-]{36}$`));
    expect(second).not.toBe(first);
  });

  it("adds the authenticated actor before parsing the internal task input", () => {
    const idempotencyKey = manualScanIdempotencyKey(workspaceId, productId);
    const input = buildProductDemandScanInput({ workspaceId, productId, scanMode: "manual", forceRebuild: false }, idempotencyKey, userId);

    expect(input.requestedByUserId).toBe(userId);
    expect(input.idempotencyKey).toBe(idempotencyKey);
  });

  it("classifies active jobs by durable mode and excludes terminal rows", () => {
    const base = {
      idempotency_key: initialScanIdempotencyKey(workspaceId, productId),
      status: "running",
      completed_at: null,
      terminal_at: null,
      input_reference: { scanMode: "onboarding", progress: { stage: "discovering", percent: 40, completedSources: 0, totalSources: 1, currentLabel: "Finding conversations", warnings: [] } },
    };
    expect(scanModeFromJob(base)).toBe("onboarding");
    expect(isActiveProductDemandScanJob(base)).toBe(true);
    expect(isActiveProductDemandScanJob({ ...base, input_reference: { ...base.input_reference, progress: { ...base.input_reference.progress, stage: "preparing_product" } } })).toBe(true);
    expect(isActiveProductDemandScanJob({ ...base, status: "succeeded", completed_at: new Date().toISOString() })).toBe(false);
    expect(isActiveProductDemandScanJob({ ...base, input_reference: { ...base.input_reference, progress: { ...base.input_reference.progress, stage: "completed" } } })).toBe(false);
    expect(scanModeFromJob({ ...base, input_reference: {} })).toBe("onboarding");
  });

  it("never reuses an active onboarding job for a manual rescan", () => {
    const onboardingJob = {
      idempotency_key: initialScanIdempotencyKey(workspaceId, productId),
      status: "running",
      completed_at: null,
      terminal_at: null,
      input_reference: { scanMode: "onboarding", progress: { stage: "discovering", percent: 40, completedSources: 0, totalSources: 1, currentLabel: "Finding conversations", warnings: [] } },
    };

    expect(selectActiveProductDemandScanJob([onboardingJob], "manual")).toBeNull();
    expect(selectActiveProductDemandScanJob([onboardingJob], "onboarding")).toBe(onboardingJob);
  });

});
