import "server-only";

import { getActiveScanState, getLatestScanState } from "@/server/modules/onboarding";
import { scanResultSummarySchema } from "@/server/modules/operations/product-demand-scan.schemas";

import { completedDashboardScanStages, DASHBOARD_SCAN_STAGES, dashboardScanLabel, isManualScanKey, isOnboardingScanKey, type DashboardScanState } from "./scan-status.view-model";

export type ProductScanState = DashboardScanState;

/**
 * Reads persisted job_runs state for the product's onboarding scan and any
 * currently active manual scan. The dashboard never invents progress; every
 * running label and stage count comes from the stored job reference.
 */
export async function getProductScanState(workspaceId: string, productId: string, hasQualifiedSignals: boolean): Promise<ProductScanState> {
  const [latestScan, activeScan] = await Promise.all([
    getLatestScanState(workspaceId, productId).catch(() => null),
    getActiveScanState(workspaceId, productId).catch(() => null),
  ]);
  const scan = activeScan ?? latestScan;
  if (!scan) return { kind: "no_scan" };
  const summary = scan.result ? scanResultSummarySchema.safeParse(scan.result) : null;
  const resultSummary = summary?.success ? summary.data : null;

  if (scan.status === "queued" || scan.status === "running" || scan.status === "pending") {
    const manual = isManualScanKey(scan.idempotencyKey);
    return {
      kind: "running",
      label: dashboardScanLabel(scan.progress?.stage, scan.phase, manual),
      manual,
      completedStages: completedDashboardScanStages(scan.progress?.stage, scan.phase),
      totalStages: DASHBOARD_SCAN_STAGES.length,
      jobRunId: scan.jobRunId,
      idempotencyKey: scan.idempotencyKey,
    };
  }
  if (scan.status === "failed" || scan.status === "failed_terminal" || scan.status === "cancelled") {
    return { kind: "failed", message: scan.errorMessage, manual: isManualScanKey(scan.idempotencyKey), firstScan: isOnboardingScanKey(scan.idempotencyKey) };
  }
  const warnings = scan.progress?.warnings ?? [];
  const manual = isManualScanKey(scan.idempotencyKey);
  if (scan.status === "partial_failure" || scan.status === "completed_with_warnings" || scan.progress?.stage === "partial_failure" || warnings.length > 0) {
    return { kind: "partial_failure", warnings, manual, summary: resultSummary };
  }
  const producedSignals = resultSummary ? resultSummary.signals > 0 : hasQualifiedSignals;
  return producedSignals
    ? { kind: "completed_with_signals", manual, summary: resultSummary }
    : { kind: "completed_no_signals", manual, summary: resultSummary };
}
