import "server-only";

import { z } from "zod";

import type { DiscoveryProvenanceTemplate } from "@/server/modules/ingestion/public-ingestion.service";

/**
 * Wanterest 1B Stage 2D: pure, deterministic incremental product-matching
 * policy. Reads no external state.
 *
 * Interest is not a new relationship: a product expresses interest in a
 * global market partition when one of its own scans executed a query whose
 * retrieval spec maps to that partition (query_yield_artifacts, workspace
 * scoped, RLS-protected, Stage 2B). Stage 2D only routes new public evidence
 * from a refreshed partition to those products, bounded by explicit caps.
 * Qualification, thresholds, candidate selection and materialization are the
 * frozen product-scan implementations, reused unchanged.
 */

export const INCREMENTAL_PRODUCT_MATCHING_POLICY_VERSION = "incremental_product_matching_v1" as const;

/** Same window the Stage 2C scheduler uses to decide a partition still has interest. */
export const INCREMENTAL_MATCH_INTEREST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** Hard fanout ceiling: products evaluated per refreshed partition. */
export const INCREMENTAL_MATCH_MAX_PRODUCTS_PER_REFRESH = 20;
/** Frozen candidate evaluation cap (maxEvaluations = 15), applied per product per refresh. */
export const INCREMENTAL_MATCH_MAX_EVALUATIONS_PER_PRODUCT = 15;
/** Upper bound on conversations handed to candidate selection per product per refresh. */
export const INCREMENTAL_MATCH_MAX_CANDIDATE_CONVERSATIONS = 50;
/** Upper bound on interest artifacts read for one partition. */
export const INCREMENTAL_MATCH_MAX_INTEREST_ARTIFACTS = 1000;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

/** Mirrors the candidate-processing provenance contract (product-demand-scan.ts) minus conversationId. */
export const discoveryProvenanceTemplateSchema = z.object({
  queryPlanId: trimmed(180),
  source: trimmed(40),
  queryFamily: trimmed(50),
  demandSurface: trimmed(50),
  semanticQuery: z.string().max(200).optional(),
  concepts: z.array(z.string().max(100)).max(20),
  competitorSpecific: z.boolean(),
  githubPainRetrievalV1: z.object({
    templateVersion: trimmed(60),
    demandAnchors: z.array(z.string().max(80)).max(12),
    categoryAnchors: z.array(z.string().max(80)).max(8),
  }).optional(),
  xCompetitorPainRetrievalV1: z.object({
    templateVersion: trimmed(60),
    competitor: trimmed(120),
    displacementAnchors: z.array(trimmed(80)).max(12),
  }).optional(),
});

export type InterestArtifact = {
  id: string;
  workspaceId: string;
  productId: string;
  jobRunId: string;
  queryPlanId: string;
  sourceKey: string;
  createdAt: string;
  discoveryProvenance: unknown;
};

export type InterestedProduct = {
  workspaceId: string;
  productId: string;
  interestArtifactId: string;
  interestScanJobRunId: string;
  interestedAt: string;
  provenanceTemplate: DiscoveryProvenanceTemplate;
};

export type SkippedInterest = {
  workspaceId: string;
  productId: string;
  reason: "provenance_missing" | "fanout_cap";
};

/**
 * Returns the template only when it is well-formed AND describes the same
 * query the artifact records - a provenance row can never borrow another
 * query's or another source's context.
 */
export function parseDiscoveryProvenanceTemplate(artifact: Pick<InterestArtifact, "discoveryProvenance" | "queryPlanId" | "sourceKey">): DiscoveryProvenanceTemplate | null {
  const parsed = discoveryProvenanceTemplateSchema.safeParse(artifact.discoveryProvenance);
  if (!parsed.success) return null;
  if (parsed.data.queryPlanId !== artifact.queryPlanId || parsed.data.source !== artifact.sourceKey) return null;
  return parsed.data as DiscoveryProvenanceTemplate;
}

/**
 * Collapses interest artifacts to one row per (workspace, product), using the
 * newest artifact that carries a valid provenance template, then applies the
 * fanout ceiling deterministically (most recent interest first, product id as
 * tie-break).
 */
export function selectInterestedProducts(artifacts: InterestArtifact[], maxProducts = INCREMENTAL_MATCH_MAX_PRODUCTS_PER_REFRESH): {
  interestedProductCount: number;
  selected: InterestedProduct[];
  skipped: SkippedInterest[];
} {
  const byProduct = new Map<string, InterestArtifact[]>();
  for (const artifact of artifacts) {
    const key = `${artifact.workspaceId}:${artifact.productId}`;
    byProduct.set(key, [...(byProduct.get(key) ?? []), artifact]);
  }
  const eligible: InterestedProduct[] = [];
  const skipped: SkippedInterest[] = [];
  for (const group of byProduct.values()) {
    const ordered = [...group].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const usable = ordered.map((artifact) => ({ artifact, template: parseDiscoveryProvenanceTemplate(artifact) })).find((entry) => entry.template);
    if (!usable?.template) {
      skipped.push({ workspaceId: ordered[0].workspaceId, productId: ordered[0].productId, reason: "provenance_missing" });
      continue;
    }
    eligible.push({
      workspaceId: usable.artifact.workspaceId,
      productId: usable.artifact.productId,
      interestArtifactId: usable.artifact.id,
      interestScanJobRunId: usable.artifact.jobRunId,
      interestedAt: usable.artifact.createdAt,
      provenanceTemplate: usable.template,
    });
  }
  eligible.sort((a, b) => b.interestedAt.localeCompare(a.interestedAt) || a.productId.localeCompare(b.productId));
  const cap = Math.max(0, Math.floor(maxProducts));
  for (const overflow of eligible.slice(cap)) skipped.push({ workspaceId: overflow.workspaceId, productId: overflow.productId, reason: "fanout_cap" });
  skipped.sort((a, b) => a.reason.localeCompare(b.reason) || a.productId.localeCompare(b.productId));
  return { interestedProductCount: byProduct.size, selected: eligible.slice(0, cap), skipped };
}

/**
 * "New for this product" means: surfaced by the refresh and never matched to
 * this product before. Globally rediscovered evidence can still be new to a
 * product; evidence a product already has a match for is never re-evaluated
 * here (its current evaluation remains authoritative).
 */
export function newCandidateConversationIds(input: { refreshConversationIds: string[]; alreadyMatchedConversationIds: Set<string>; max?: number }): {
  candidates: string[];
  alreadyMatchedCount: number;
  overflowCount: number;
} {
  const unique = [...new Set(input.refreshConversationIds)].sort();
  const fresh = unique.filter((id) => !input.alreadyMatchedConversationIds.has(id));
  const max = Math.max(0, Math.floor(input.max ?? INCREMENTAL_MATCH_MAX_CANDIDATE_CONVERSATIONS));
  return { candidates: fresh.slice(0, max), alreadyMatchedCount: unique.length - fresh.length, overflowCount: Math.max(0, fresh.length - max) };
}

export function partitionFanoutJobKey(refreshJobRunId: string): string {
  return `match-partition-incremental:${refreshJobRunId}`;
}

export function productIncrementalMatchJobKey(refreshJobRunId: string, productId: string): string {
  return `match-product-incremental:${refreshJobRunId}:${productId}`;
}
