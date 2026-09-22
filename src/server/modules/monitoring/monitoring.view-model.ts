export type MonitoringDisplayStatus = "healthy" | "limited" | "failed" | "paused";

export function deriveMonitoringStatus(input: {
  enabled: boolean;
  policyEnabled: boolean;
  currentStatus?: string | null;
  jobStatus?: string | null;
  resultState?: string | null;
}): MonitoringDisplayStatus {
  if (!input.enabled || !input.policyEnabled) return "paused";
  if (input.currentStatus === "failed" || input.jobStatus === "failed" || input.jobStatus === "failed_terminal") return "failed";
  if (input.resultState === "complete_with_warnings") return "limited";
  return "healthy";
}
