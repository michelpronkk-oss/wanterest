import { AbortTaskRunError, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { AppError } from "@/server/lib/errors";
import { sourceDiscoveryRequestSchema } from "@/server/providers/source/contracts";
import { SourceAdapterError } from "@/server/providers/source/contracts";
import {
  executeProductDemandScan,
} from "@/server/modules/operations/product-demand-scan.service";
import { demandTaskInputSchema, productDemandScanInputSchema } from "@/server/modules/operations/product-demand-scan.schemas";
import {
  executeSourceDiscovery,
  getScanProduct,
  processScanCandidates,
  type SourceExecutionBatchResult,
  type ScanDiscoveryProvenance,
} from "@/server/modules/onboarding/initial-scan.service";
import { rebuildDemandIntelligenceForScan } from "@/server/modules/demand-intelligence/demand.orchestration";
import { generateActionsForScan } from "@/server/modules/actions/action.orchestration";

const sourceTaskInputSchema = z.object({
  workspaceId: z.string().uuid(),
  productId: z.string().uuid(),
  jobRunId: z.string().uuid(),
  sourceKey: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  requests: z.array(sourceDiscoveryRequestSchema).min(1).max(8),
  traceId: z.string().trim().min(1).max(120),
});

const candidateTaskInputSchema = z.object({
  workspaceId: z.string().uuid(),
  productId: z.string().uuid(),
  profileId: z.string().uuid(),
  normalizedSourceItemIds: z.array(z.string().uuid()).max(500),
  conversationIds: z.array(z.string().uuid()).max(500),
  provenance: z.array(z.object({
    conversationId: z.string().uuid(), queryPlanId: z.string().max(180),
    source: z.string().max(40), queryFamily: z.string().max(50),
    demandSurface: z.string().max(50), concepts: z.array(z.string().max(100)).max(20),
    competitorSpecific: z.boolean(),
    githubPainRetrievalV1: z.object({
      templateVersion: z.literal("github_pain_retrieval_v1_1"),
      demandAnchors: z.array(z.string().max(80)).max(12),
      categoryAnchors: z.array(z.string().max(80)).max(8),
    }).optional(),
  })).max(4000).optional(),
  maxLlmEvaluations: z.number().int().nonnegative().max(500),
  traceId: z.string().trim().min(1).max(120),
});

const actionsTaskInputSchema = z.object({
  workspaceId: z.string().uuid(),
  productId: z.string().uuid(),
  traceId: z.string().trim().min(1).max(120),
});

function nonRetryable(error: unknown): never {
  if (error instanceof AppError && error.code !== "INTERNAL_ERROR") {
    throw new AbortTaskRunError(`${error.code}: ${error.message}`);
  }
  if (error instanceof SourceAdapterError && !error.retryable) {
    throw new AbortTaskRunError(`${error.code}: ${error.message}`);
  }
  if (error instanceof Error && (error.message.includes("not authorized") || error.message.includes("not found") || error.message.includes("Invalid"))) {
    throw new AbortTaskRunError(error.message);
  }
  throw error;
}

export const discoverProductSourceTask = schemaTask({
  id: "discover-product-source",
  retry: { maxAttempts: 3, minTimeoutInMs: 1_000, maxTimeoutInMs: 15_000, factor: 2, randomize: true },
  maxDuration: 900,
  schema: sourceTaskInputSchema,
  run: async (input) => {
    try {
      return executeSourceDiscovery({ sourceKey: input.sourceKey, requests: input.requests, traceId: input.traceId, jobRunId: input.jobRunId, workspaceId: input.workspaceId, productId: input.productId });
    } catch (error) {
      return nonRetryable(error);
    }
  },
});

export const processProductCandidatesTask = schemaTask({
  id: "process-product-candidates",
  retry: { maxAttempts: 2, minTimeoutInMs: 1_000, maxTimeoutInMs: 10_000, factor: 2, randomize: true },
  maxDuration: 1_800,
  schema: candidateTaskInputSchema,
  run: async (input) => {
    try {
      return processScanCandidates({ ...input, product: await getScanProduct(input.workspaceId, input.productId) });
    } catch (error) {
      return nonRetryable(error);
    }
  },
});

export const rebuildProductDemandIntelligenceTask = schemaTask({
  id: "rebuild-product-demand-intelligence",
  retry: { maxAttempts: 2, minTimeoutInMs: 1_000, maxTimeoutInMs: 10_000, factor: 2, randomize: true },
  maxDuration: 1_800,
  schema: demandTaskInputSchema,
  run: async (input) => {
    try {
      return rebuildDemandIntelligenceForScan({
        product: await getScanProduct(input.workspaceId, input.productId),
        evaluationIds: input.evaluationIds,
        signalIds: input.signalIds,
        traceId: input.traceId,
      });
    } catch (error) {
      return nonRetryable(error);
    }
  },
});

export const generateProductActionsTask = schemaTask({
  id: "generate-product-actions",
  retry: { maxAttempts: 2, minTimeoutInMs: 1_000, maxTimeoutInMs: 10_000, factor: 2, randomize: true },
  maxDuration: 900,
  schema: actionsTaskInputSchema,
  run: async (input) => {
    try {
      return generateActionsForScan({ product: await getScanProduct(input.workspaceId, input.productId), traceId: input.traceId });
    } catch (error) {
      return nonRetryable(error);
    }
  },
});

export const productDemandScanTask = schemaTask({
  id: "product-demand-scan",
  retry: { maxAttempts: 3, minTimeoutInMs: 2_000, maxTimeoutInMs: 30_000, factor: 2, randomize: true },
  maxDuration: 3_600,
  schema: productDemandScanInputSchema,
  run: async (input, { ctx }) => {
    try {
      const sourceBatchExecutor = input.jobRunId
        ? async (sources: Array<{ sourceKey: string; requests: z.infer<typeof sourceDiscoveryRequestSchema>[]; traceId: string; jobRunId: string }>): Promise<SourceExecutionBatchResult[]> => {
          const batch = await discoverProductSourceTask.batchTriggerAndWait(sources.map((source) => ({
            payload: {
                workspaceId: input.workspaceId,
                productId: input.productId,
                jobRunId: source.jobRunId,
                sourceKey: source.sourceKey,
                requests: source.requests,
                traceId: source.traceId,
              },
          })));
            return sources.map((source, index) => {
              const child = batch.runs[index];
              if (!child || !child.ok) return { sourceKey: source.sourceKey, error: `Source task ${source.sourceKey} failed.` };
              return { sourceKey: source.sourceKey, execution: child.output };
            });
          }
        : undefined;
      const candidateExecutor = input.jobRunId
        ? async (candidate: { product: { workspace_id: string; id: string }; profileId: string; normalizedSourceItemIds: string[]; conversationIds: string[]; provenance: ScanDiscoveryProvenance[]; traceId: string; maxLlmEvaluations: number }) => {
            const child = await processProductCandidatesTask.triggerAndWait({
              workspaceId: candidate.product.workspace_id,
              productId: candidate.product.id,
              profileId: candidate.profileId,
              normalizedSourceItemIds: candidate.normalizedSourceItemIds,
              conversationIds: candidate.conversationIds,
              provenance: candidate.provenance,
              maxLlmEvaluations: candidate.maxLlmEvaluations,
              traceId: candidate.traceId,
            });
            if (!child.ok) throw new Error("Candidate processing task failed.");
            return child.output;
          }
        : undefined;
      const demandExecutor = input.jobRunId
        ? async (demand: { product: { workspace_id: string; id: string }; evaluationIds: string[]; signalIds: Array<string | null>; traceId: string }) => {
            const child = await rebuildProductDemandIntelligenceTask.triggerAndWait({ workspaceId: demand.product.workspace_id, productId: demand.product.id, evaluationIds: demand.evaluationIds, signalIds: demand.signalIds, traceId: demand.traceId });
            if (!child.ok) throw new Error("Demand intelligence task failed.");
            return child.output;
          }
        : undefined;
      const actionsExecutor = input.jobRunId
        ? async (action: { product: { workspace_id: string; id: string }; traceId: string }) => {
            const child = await generateProductActionsTask.triggerAndWait({ workspaceId: action.product.workspace_id, productId: action.product.id, traceId: action.traceId });
            if (!child.ok) throw new Error("Actions task failed.");
            return child.output;
          }
        : undefined;
      return executeProductDemandScan(input, ctx.run.id, { sourceBatchExecutor, candidateExecutor, demandExecutor, actionsExecutor });
    } catch (error) {
      return nonRetryable(error);
    }
  },
});
