export type MonitoringDisplayStatus = "healthy" | "limited" | "failed" | "paused";

export function deriveMonitoringStatus(input: {
  enabled: boolean;
  policyEnabled: boolean;
  currentStatus?: string | null;
  jobStatus?: string | null;
  resultState?: string | null;
  sourceHealthLabel?: "full_coverage" | "limited_coverage" | "severely_degraded" | null;
}): MonitoringDisplayStatus {
  if (!input.enabled || !input.policyEnabled) return "paused";
  if (input.currentStatus === "failed" || input.jobStatus === "failed" || input.jobStatus === "failed_terminal") return "failed";
  if (input.sourceHealthLabel === "severely_degraded") return "failed";
  if (input.sourceHealthLabel === "limited_coverage") return "limited";
  if (input.sourceHealthLabel === "full_coverage") return "healthy";
  if (input.resultState === "complete_with_warnings") return "limited";
  return "healthy";
}
