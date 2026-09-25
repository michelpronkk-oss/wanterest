import "server-only";

import { z } from "zod";

import type { ProductRow } from "@/server/db/database.helpers";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { provenanceFromTemplate } from "@/server/modules/ingestion/public-ingestion.service";
import { getScanProduct, processScanCandidates } from "@/server/modules/onboarding/initial-scan.service";
import { rebuildDemandIntelligenceForScan } from "@/server/modules/demand-intelligence/demand.orchestration";
import { generateActionsForScan } from "@/server/modules/actions/action.orchestration";
import { IncrementalProductMatchingRepository } from "./incremental-product-matching.repository";
import {
  INCREMENTAL_MATCH_INTEREST_WINDOW_MS,
  INCREMENTAL_MATCH_MAX_EVALUATIONS_PER_PRODUCT,
  INCREMENTAL_MATCH_MAX_INTEREST_ARTIFACTS,
  INCREMENTAL_MATCH_MAX_PRODUCTS_PER_REFRESH,
  INCREMENTAL_PRODUCT_MATCHING_POLICY_VERSION,
  newCandidateConversationIds,
  partitionFanoutJobKey,
  productIncrementalMatchJobKey,
  selectInterestedProducts,
  type InterestedProduct,
} from "./incremental-product-matching.policy";

/**
 * Wanterest 1B Stage 2D: routes new public evidence from ONE successful
 * global partition refresh to the products that expressed interest in that
 * partition, and runs the frozen product-scan candidate pipeline
 * (candidate_selection_v3 -> analysis -> matching -> signal_qualification_v1_7
 * -> ranking -> materialization) on just that evidence.
 *
 * It never calls a provider, never touches global partition identity or
 * refresh state, and never evaluates a product that has no recorded interest
 * in the partition. Every run is recorded in job_runs with DB-enforced
 * idempotency: one fanout row per refresh job, one product row per
 * (refresh job, product). Candidate-level idempotency is the existing
 * fingerprint/natural-key idempotency of analyses, matches, evaluations,
 * rankings and signals.
 */

const refreshResultSchema = z.object({
  partitionKey: z.string().min(1),
  sourceKey: z.string().min(1),
  result: z.object({
    conversationIds: z.array(z.string().uuid()).max(500).optional(),
    normalizedSourceItemIds: z.array(z.string().uuid()).max(500).optional(),
  }).passthrough(),
}).passthrough();

type Repository = Pick<IncrementalProductMatchingRepository, "getRefreshJob" | "getJob" | "startJob" | "completeJob" | "listInterestArtifacts" | "listMatchedConversationIds">;

export type IncrementalMatchingDependencies = {
  repository: Repository;
  loadProduct: (workspaceId: string, productId: string) => Promise<ProductRow>;
  processCandidates: typeof processScanCandidates;
  rebuildDemand: typeof rebuildDemandIntelligenceForScan;
  /** Layer 10: the single gated Action writer, run after a successful incremental rebuild. */
  generateActions: typeof generateActionsForScan;
  now: () => Date;
  maxProducts?: number;
};

export type ProductIncrementalMatchResult = {
  workspaceId: string;
  productId: string;
  jobRunId: string | null;
  status: "succeeded" | "failed" | "replayed" | "skipped";
  reason?: string;
  interestArtifactId: string;
  refreshConversationCount: number;
  alreadyMatchedCount: number;
  candidateCount: number;
  overflowCount: number;
  selectedCount: number;
  evaluations: number;
  signals: number;
  qualifiedCount: number;
  evaluationIds: string[];
  signalIds: string[];
  demandRebuilt: boolean;
  /** Layer 10: Actions created/superseded/expired by the gated pass after the rebuild (0 when gated off). */
  actionsUpdated: number;
  actionWarnings: string[];
  durationMs: number;
};

export type IncrementalPartitionMatchOutcome = {
  status: "succeeded" | "failed" | "skipped";
  reason?: string;
  policyVersion: typeof INCREMENTAL_PRODUCT_MATCHING_POLICY_VERSION;
  refreshJobRunId: string;
  fanoutJobRunId: string | null;
  partitionKey: string | null;
  sourceKey: string | null;
  refreshConversationCount: number;
  interestedProductCount: number;
  consideredProductCount: number;
  skipped: Array<{ workspaceId: string; productId: string; reason: string }>;
  products: ProductIncrementalMatchResult[];
  totals: { candidateConversations: number; evaluations: number; signals: number; productsWithNewEvidence: number };
  durationMs: number;
};

function defaultDependencies(): IncrementalMatchingDependencies {
  return {
    repository: new IncrementalProductMatchingRepository(createSupabaseServiceClient()),
    loadProduct: getScanProduct,
    processCandidates: processScanCandidates,
    rebuildDemand: rebuildDemandIntelligenceForScan,
    generateActions: generateActionsForScan,
    now: () => new Date(),
  };
}

function emptyOutcome(refreshJobRunId: string, status: IncrementalPartitionMatchOutcome["status"], reason: string): IncrementalPartitionMatchOutcome {
  return {
    status, reason, policyVersion: INCREMENTAL_PRODUCT_MATCHING_POLICY_VERSION, refreshJobRunId, fanoutJobRunId: null, partitionKey: null, sourceKey: null,
    refreshConversationCount: 0, interestedProductCount: 0, consideredProductCount: 0, skipped: [], products: [],
    totals: { candidateConversations: 0, evaluations: 0, signals: 0, productsWithNewEvidence: 0 }, durationMs: 0,
  };
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Incremental product match failed.";
  return message.replace(/(authorization|bearer|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 240);
}

function baseProductResult(interest: InterestedProduct, refreshConversationCount: number): ProductIncrementalMatchResult {
  return {
    workspaceId: interest.workspaceId, productId: interest.productId, jobRunId: null, status: "skipped", interestArtifactId: interest.interestArtifactId,
    refreshConversationCount, alreadyMatchedCount: 0, candidateCount: 0, overflowCount: 0, selectedCount: 0, evaluations: 0, signals: 0, qualifiedCount: 0,
    evaluationIds: [], signalIds: [], demandRebuilt: false, actionsUpdated: 0, actionWarnings: [], durationMs: 0,
  };
}

async function matchOneProduct(input: {
  deps: IncrementalMatchingDependencies;
  interest: InterestedProduct;
  refreshJobRunId: string;
  partitionKey: string;
  conversationIds: string[];
  normalizedSourceItemIds: string[];
  traceId: string;
}): Promise<ProductIncrementalMatchResult> {
  const { deps, interest } = input;
  const startedAt = Date.now();
  const result = baseProductResult(interest, input.conversationIds.length);
  const idempotencyKey = productIncrementalMatchJobKey(input.refreshJobRunId, interest.productId);

  const existing = await deps.repository.getJob("match-product-incremental", idempotencyKey);
  if (existing?.status === "succeeded") {
    const stored = (existing.input_reference ?? {}) as Partial<ProductIncrementalMatchResult>;
    return { ...result, ...stored, jobRunId: existing.id, status: "replayed", reason: "already_succeeded" };
  }

  let product: ProductRow;
  try {
    product = await deps.loadProduct(interest.workspaceId, interest.productId);
  } catch {
    return { ...result, reason: "product_unavailable" };
  }
  // Defense in depth: the loaded product must be exactly the interested
  // (workspace, product) pair, never a row from another workspace.
  if (product.workspace_id !== interest.workspaceId || product.id !== interest.productId) return { ...result, reason: "product_scope_mismatch" };
  if (!product.current_demand_profile_id) return { ...result, reason: "demand_profile_missing" };

  const job = await deps.repository.startJob({
    jobType: "match-product-incremental",
    idempotencyKey,
    traceId: input.traceId,
    workspaceId: interest.workspaceId,
    productId: interest.productId,
    inputReference: { policyVersion: INCREMENTAL_PRODUCT_MATCHING_POLICY_VERSION, refreshJobRunId: input.refreshJobRunId, partitionKey: input.partitionKey, interestArtifactId: interest.interestArtifactId, interestScanJobRunId: interest.interestScanJobRunId },
  });
  result.jobRunId = job.id;

  try {
    const matched = await deps.repository.listMatchedConversationIds({ workspaceId: interest.workspaceId, productId: interest.productId, conversationIds: input.conversationIds });
    const candidates = newCandidateConversationIds({ refreshConversationIds: input.conversationIds, alreadyMatchedConversationIds: matched });
    result.alreadyMatchedCount = candidates.alreadyMatchedCount;
    result.candidateCount = candidates.candidates.length;
    result.overflowCount = candidates.overflowCount;

    if (candidates.candidates.length) {
      const processed = await deps.processCandidates({
        product,
        profileId: product.current_demand_profile_id,
        normalizedSourceItemIds: input.normalizedSourceItemIds,
        conversationIds: candidates.candidates,
        provenance: provenanceFromTemplate(interest.provenanceTemplate, candidates.candidates),
        traceId: input.traceId,
        maxLlmEvaluations: INCREMENTAL_MATCH_MAX_EVALUATIONS_PER_PRODUCT,
      });
      result.selectedCount = processed.candidateSelection?.selectedCount ?? 0;
      result.evaluations = processed.evaluations;
      result.signals = processed.signals;
      result.qualifiedCount = processed.outcomes.filter((outcome) => outcome.qualificationStatus === "qualified").length;
      result.evaluationIds = processed.evaluationIds;
      result.signalIds = processed.signalIds.filter((id): id is string => typeof id === "string");
      if (processed.signals > 0) {
        // Only re-aggregate Map/Gap/Drift when product intelligence materially
        // changed; an unchanged refresh must not mint noise snapshots.
        try {
          await deps.rebuildDemand({ product, evaluationIds: processed.evaluationIds, signalIds: processed.signalIds, traceId: input.traceId });
          result.demandRebuilt = true;
        } catch (error) {
          result.reason = `demand_rebuild_skipped:${safeMessage(error)}`;
        }
        if (result.demandRebuilt) {
          // Layer 10: same single, plan- and flag-gated Action writer the full scan uses.
          // Non-fatal: an Action failure never fails the incremental match.
          try {
            const actions = await deps.generateActions({ product, traceId: input.traceId });
            result.actionsUpdated = actions.actionsUpdated;
            result.actionWarnings = actions.warnings.slice(0, 10).map((warning) => warning.slice(0, 240));
          } catch (error) {
            result.actionWarnings = [`actions_skipped:${safeMessage(error)}`];
          }
        }
      }
    } else {
      result.reason = "no_new_evidence";
    }
    result.status = "succeeded";
    result.durationMs = Date.now() - startedAt;
    await deps.repository.completeJob(job.id, { status: "succeeded", inputReference: { ...result, policyVersion: INCREMENTAL_PRODUCT_MATCHING_POLICY_VERSION, refreshJobRunId: input.refreshJobRunId, partitionKey: input.partitionKey, interestScanJobRunId: interest.interestScanJobRunId } });
    return result;
  } catch (error) {
    result.status = "failed";
    result.reason = safeMessage(error);
    result.durationMs = Date.now() - startedAt;
    await deps.repository.completeJob(job.id, { status: "failed", inputReference: { ...result, policyVersion: INCREMENTAL_PRODUCT_MATCHING_POLICY_VERSION, refreshJobRunId: input.refreshJobRunId, partitionKey: input.partitionKey }, errorMessage: result.reason });
    return result;
  }
}

export async function matchRefreshedPartitionIncrementally(
  input: { refreshJobRunId: string; traceId: string },
  dependencies?: Partial<IncrementalMatchingDependencies>,
): Promise<IncrementalPartitionMatchOutcome> {
  const deps: IncrementalMatchingDependencies = { ...defaultDependencies(), ...dependencies };
  const startedAt = Date.now();
  const fanoutKey = partitionFanoutJobKey(input.refreshJobRunId);

  const existingFanout = await deps.repository.getJob("match-partition-incremental", fanoutKey);
  if (existingFanout?.status === "succeeded") {
    const stored = (existingFanout.input_reference ?? {}) as Partial<IncrementalPartitionMatchOutcome>;
    return { ...emptyOutcome(input.refreshJobRunId, "succeeded", "already_succeeded"), ...stored, fanoutJobRunId: existingFanout.id, status: "succeeded", reason: "already_succeeded" };
  }

  const refreshJob = await deps.repository.getRefreshJob(input.refreshJobRunId);
  if (!refreshJob) return emptyOutcome(input.refreshJobRunId, "skipped", "refresh_job_not_found");
  if (refreshJob.status !== "succeeded") return emptyOutcome(input.refreshJobRunId, "skipped", "refresh_not_succeeded");
  const stored = refreshResultSchema.safeParse(refreshJob.input_reference);
  if (!stored.success || !stored.data.result.conversationIds) return emptyOutcome(input.refreshJobRunId, "skipped", "refresh_evidence_unavailable");
  const conversationIds = [...new Set(stored.data.result.conversationIds)].sort();
  const normalizedSourceItemIds = [...new Set(stored.data.result.normalizedSourceItemIds ?? [])].sort();
  const partitionKey = stored.data.partitionKey;
  if (!conversationIds.length) {
    return { ...emptyOutcome(input.refreshJobRunId, "skipped", "no_refresh_evidence"), partitionKey, sourceKey: stored.data.sourceKey };
  }

  const fanoutJob = await deps.repository.startJob({
    jobType: "match-partition-incremental",
    idempotencyKey: fanoutKey,
    traceId: input.traceId,
    workspaceId: null,
    productId: null,
    inputReference: { policyVersion: INCREMENTAL_PRODUCT_MATCHING_POLICY_VERSION, refreshJobRunId: input.refreshJobRunId, partitionKey },
  });

  const since = new Date(deps.now().getTime() - INCREMENTAL_MATCH_INTEREST_WINDOW_MS).toISOString();
  const artifacts = await deps.repository.listInterestArtifacts(partitionKey, since, INCREMENTAL_MATCH_MAX_INTEREST_ARTIFACTS);
  const interest = selectInterestedProducts(artifacts, deps.maxProducts ?? INCREMENTAL_MATCH_MAX_PRODUCTS_PER_REFRESH);

  const products: ProductIncrementalMatchResult[] = [];
  for (const interestedProduct of interest.selected) {
    products.push(await matchOneProduct({ deps, interest: interestedProduct, refreshJobRunId: input.refreshJobRunId, partitionKey, conversationIds, normalizedSourceItemIds, traceId: input.traceId }));
  }

  const failed = products.filter((product) => product.status === "failed");
  const outcome: IncrementalPartitionMatchOutcome = {
    status: failed.length ? "failed" : "succeeded",
    ...(failed.length ? { reason: "product_match_failed" } : {}),
    policyVersion: INCREMENTAL_PRODUCT_MATCHING_POLICY_VERSION,
    refreshJobRunId: input.refreshJobRunId,
    fanoutJobRunId: fanoutJob.id,
    partitionKey,
    sourceKey: stored.data.sourceKey,
    refreshConversationCount: conversationIds.length,
    interestedProductCount: interest.interestedProductCount,
    consideredProductCount: interest.selected.length,
    skipped: [
      ...interest.skipped,
      ...products.filter((product) => product.status === "skipped").map((product) => ({ workspaceId: product.workspaceId, productId: product.productId, reason: product.reason ?? "skipped" })),
    ],
    products,
    totals: {
      candidateConversations: products.reduce((sum, product) => sum + product.candidateCount, 0),
      evaluations: products.reduce((sum, product) => sum + product.evaluations, 0),
      signals: products.reduce((sum, product) => sum + product.signals, 0),
      productsWithNewEvidence: products.filter((product) => product.candidateCount > 0).length,
    },
    durationMs: Date.now() - startedAt,
  };
  await deps.repository.completeJob(fanoutJob.id, {
    status: outcome.status === "failed" ? "failed" : "succeeded",
    inputReference: outcome as unknown as Record<string, unknown>,
    ...(failed.length ? { errorMessage: `${failed.length} product incremental match(es) failed.` } : {}),
  });
  return outcome;
}
