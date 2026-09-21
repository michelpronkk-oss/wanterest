import { randomUUID } from "node:crypto";

import type { Json } from "@/server/db/database.types";

import { productDemandScanInputSchema, scanModeSchema, scanProgressSchema, type ProductDemandScanInput, type ProductDemandScanRequest, type ScanMode } from "./product-demand-scan.schemas";

export const PRODUCT_DEMAND_SCAN_JOB_TYPE = "discover-source" as const;

export const ACTIVE_SCAN_STAGES = [
  "queued",
  "planning",
  "discovering",
  "processing",
  "qualifying",
  "building_intelligence",
  "generating_actions",
] as const;

type ScanJobIdentityRow = {
  idempotency_key: string;
  status: string;
  completed_at?: string | null;
  terminal_at?: string | null;
  input_reference: Json;
};

function referenceObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json | undefined> : {};
}

export function initialScanIdempotencyKey(workspaceId: string, productId: string): string {
  return `initial-scan:${workspaceId}:${productId}`;
}

export function manualScanIdempotencyKey(workspaceId: string, productId: string): string {
  return `manual-scan:${workspaceId}:${productId}:${randomUUID()}`;
}

export function scheduledScanIdempotencyKey(workspaceId: string, productId: string, mode: "intelligence_cycle" | "deep_refresh", slot: string): string {
  return `${mode}:${workspaceId}:${productId}:${slot}`;
}

export function buildProductDemandScanInput(request: ProductDemandScanRequest, idempotencyKey: string, requestedByUserId: string): ProductDemandScanInput {
  return productDemandScanInputSchema.parse({ ...request, idempotencyKey, requestedByUserId });
}

/** Read the durable scan mode stored in job input_reference. */
export function scanModeFromJob(job: ScanJobIdentityRow): ScanMode | null {
  const reference = referenceObject(job.input_reference);
  const storedMode = scanModeSchema.safeParse(reference.scanMode);
  if (storedMode.success) return storedMode.data;

  // Legacy rows created before scanMode was preserved can still be classified
  // safely from the canonical key. New rows always persist scanMode explicitly.
  if (job.idempotency_key.startsWith("initial-scan:")) return "onboarding";
  if (job.idempotency_key.startsWith("manual-scan:")) return "manual";
  return null;
}

export function scanProgressStageFromJob(job: ScanJobIdentityRow): string | null {
  const reference = referenceObject(job.input_reference);
  const progress = scanProgressSchema.safeParse(reference.progress);
  return progress.success ? progress.data.stage : null;
}

export function isActiveProductDemandScanJob(job: ScanJobIdentityRow): boolean {
  if (!job.completed_at && !job.terminal_at && (job.status === "pending" || job.status === "running")) {
    const stage = scanProgressStageFromJob(job);
    // Product understanding is a persisted detail stage, but remains in the
    // queued lifecycle bucket for active-job identity and duplicate protection.
    const lifecycleStage = stage === "preparing_product" ? "queued" : stage;
    return lifecycleStage !== null && ACTIVE_SCAN_STAGES.includes(lifecycleStage as (typeof ACTIVE_SCAN_STAGES)[number]);
  }
  return false;
}

export function selectActiveProductDemandScanJob<T extends ScanJobIdentityRow>(jobs: readonly T[], scanMode: ScanMode): T | null {
  return jobs.find((job) => isActiveProductDemandScanJob(job) && scanModeFromJob(job) === scanMode) ?? null;
}
