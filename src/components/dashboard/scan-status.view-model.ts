import type { ScanProgress, ScanResultSummary } from "@/server/modules/operations/product-demand-scan.schemas";

export const DASHBOARD_SCAN_STAGES = [
  "preparing_product",
  "planning",
  "discovering",
  "processing",
  "building_intelligence",
  "generating_actions",
] as const;

export type DashboardScanStage = (typeof DASHBOARD_SCAN_STAGES)[number];

export type DashboardScanState =
  | { kind: "no_scan" }
  | {
      kind: "running";
      label: string;
      manual: boolean;
      completedStages: number;
      totalStages: number;
      jobRunId: string;
      idempotencyKey: string;
    }
  | { kind: "completed_with_signals"; manual: boolean; summary: ScanResultSummary | null }
  | { kind: "completed_no_signals"; manual: boolean; summary: ScanResultSummary | null }
  | { kind: "partial_failure"; warnings: string[]; manual: boolean; summary: ScanResultSummary | null }
  | { kind: "failed"; message: string | null; manual: boolean; firstScan: boolean };

const STAGE_ALIASES: Record<string, DashboardScanStage | "queued" | "completed" | "partial_failure" | "failed"> = {
  queued: "queued",
  preparing: "preparing_product",
  preparing_product: "preparing_product",
  planning: "planning",
  discovering: "discovering",
  analyzing: "processing",
  processing: "processing",
  qualifying: "processing",
  matching: "processing",
  ranking: "processing",
  "building-intelligence": "building_intelligence",
  building_intelligence: "building_intelligence",
  "generating-actions": "generating_actions",
  generating_actions: "generating_actions",
  completed: "completed",
  partial_failure: "partial_failure",
  failed: "failed",
};

const STAGE_LABELS: Record<DashboardScanStage | "queued", string> = {
  queued: "Preparing your first scan",
  preparing_product: "Preparing your first scan",
  planning: "Preparing your first scan",
  discovering: "Finding relevant conversations",
  processing: "Qualifying real demand",
  building_intelligence: "Building your demand map",
  generating_actions: "Preparing recommended actions",
};

type NormalizedDashboardStage = Exclude<ReturnType<typeof normalizeStageValue>, null>;

function normalizeStage(stage: string | undefined, phase: string | undefined): NormalizedDashboardStage {
  return normalizeStageValue(stage) ?? normalizeStageValue(phase) ?? "queued";
}

function normalizeStageValue(value: string | undefined): DashboardScanStage | "queued" | "completed" | "partial_failure" | "failed" | null {
  return value && STAGE_ALIASES[value] ? STAGE_ALIASES[value] : null;
}

export function dashboardScanLabel(stage: string | undefined, phase: string | undefined, manual: boolean): string {
  if (manual) return "Refreshing market intelligence";
  const normalized = normalizeStage(stage, phase);
  return normalized in STAGE_LABELS ? STAGE_LABELS[normalized as DashboardScanStage | "queued"] : "Preparing your first scan";
}

/** Number of lifecycle stages completed before the currently persisted stage. */
export function completedDashboardScanStages(stage: string | undefined, phase: string | undefined): number {
  const normalized = normalizeStage(stage, phase);
  if (normalized === "completed" || normalized === "partial_failure") return DASHBOARD_SCAN_STAGES.length;
  if (normalized === "queued" || normalized === "failed") return 0;
  const index = DASHBOARD_SCAN_STAGES.indexOf(normalized);
  return index < 0 ? 0 : index;
}

export function isManualScanKey(idempotencyKey: string): boolean {
  return idempotencyKey.startsWith("manual-scan:");
}

/**
 * The onboarding scan job uses one deterministic, reused key per product
 * (initial-scan:{workspaceId}:{productId}). Once it ever succeeds, that exact row
 * stays "succeeded" permanently (prepareProductDemandScan never re-triggers a
 * succeeded job), so a *failed* row under this key can only mean the product's
 * first scan has never actually completed — never a later scan on an
 * already-onboarded product, whose failure would surface under a different key
 * (manual-scan:/monitoring:/etc.) as the most recent job instead.
 */
export function isOnboardingScanKey(idempotencyKey: string): boolean {
  return idempotencyKey.startsWith("initial-scan:");
}

export function dashboardScanStateFromProgress(input: {
  jobRunId: string;
  idempotencyKey: string;
  status: string;
  progress: ScanProgress | null;
  errorMessage: string | null;
  result?: ScanResultSummary | null;
}): DashboardScanState {
  const manual = isManualScanKey(input.idempotencyKey);
  const stage = input.progress?.stage;
  const warnings = input.progress?.warnings ?? [];

  if (["queued", "pending", "running"].includes(input.status)) {
    return {
      kind: "running",
      label: dashboardScanLabel(stage, undefined, manual),
      manual,
      completedStages: completedDashboardScanStages(stage, undefined),
      totalStages: DASHBOARD_SCAN_STAGES.length,
      jobRunId: input.jobRunId,
      idempotencyKey: input.idempotencyKey,
    };
  }

  if (["failed", "failed_terminal", "cancelled"].includes(input.status) || stage === "failed") {
    return { kind: "failed", message: input.errorMessage, manual, firstScan: isOnboardingScanKey(input.idempotencyKey) };
  }

  const sourceHealthDegraded = input.result?.sourceHealthV1?.coverage.label !== undefined && input.result.sourceHealthV1.coverage.label !== "full_coverage";
  if (input.status === "completed_with_warnings" || input.status === "partial_failure" || stage === "partial_failure" || warnings.length > 0 || sourceHealthDegraded) {
    return { kind: "partial_failure", warnings, manual, summary: input.result ?? null };
  }

  return input.result && input.result.signals > 0
    ? { kind: "completed_with_signals", manual, summary: input.result }
    : { kind: "completed_no_signals", manual, summary: input.result ?? null };
}

export function scanResultEmptyBody(summary: ScanResultSummary | null): string {
  const conversations = summary?.conversations ?? 0;
  const candidates = summary?.qualification?.candidateCount ?? summary?.evaluations ?? conversations;
  const weak = summary?.qualification?.weakCount ?? 0;
  const rejected = summary?.qualification?.rejectedCount ?? Math.max(0, candidates - (summary?.qualification?.qualifiedCount ?? summary?.signals ?? 0));
  const notQualified = weak + rejected > 0 ? weak + rejected : rejected;
  if (conversations > 0) {
    return `${conversations} conversation${conversations === 1 ? "" : "s"} scanned. None met Wanterest's demand threshold yet${notQualified > 0 ? ` (${notQualified} did not meet the current threshold)` : ""}. Try another scan as more relevant conversations appear.`;
  }
  return "This scan did not find enough usable conversation evidence yet. Try another scan as more relevant conversations appear.";
}
