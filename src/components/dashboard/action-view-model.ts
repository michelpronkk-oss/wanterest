import type { ActionReadModel } from "@/server/modules/actions/action.service";
import { formatPercent } from "./dashboard-utils";

export type EvidenceStripItem = { val: string; label: string };

export function priorityLabel(priorityScore: number): "HIGH" | "MEDIUM" {
  return priorityScore >= 0.66 ? "HIGH" : "MEDIUM";
}

export function actionTypeLabel(actionType: string): string {
  return actionType.replaceAll("_", " ");
}

export function evidenceStrip(action: ActionReadModel): EvidenceStripItem[] {
  const measurements = (action.evidenceContext && typeof action.evidenceContext === "object" && !Array.isArray(action.evidenceContext)
    ? (action.evidenceContext as Record<string, unknown>).measurements
    : null) as Record<string, number> | null;
  if (!measurements) return [];
  const items: EvidenceStripItem[] = [];
  if (typeof measurements.marketWeight === "number") items.push({ val: formatPercent(measurements.marketWeight), label: "market demand" });
  if (typeof measurements.gapScore === "number") items.push({ val: formatPercent(measurements.gapScore), label: "gap score" });
  if (typeof measurements.driftStrength === "number" && measurements.driftStrength) items.push({ val: formatPercent(measurements.driftStrength), label: "drift strength" });
  if (typeof measurements.sampleSize === "number") items.push({ val: String(measurements.sampleSize), label: "signals" });
  return items;
}

export function buyerLanguageQuote(action: ActionReadModel): string | null {
  const context = action.evidenceContext && typeof action.evidenceContext === "object" && !Array.isArray(action.evidenceContext) ? (action.evidenceContext as Record<string, unknown>) : null;
  const language = context?.buyerLanguage;
  return Array.isArray(language) && typeof language[0] === "string" ? language[0] : null;
}

/** Layer 10: human-readable live basis state (derived, never persisted). */
export function basisStatusLabel(action: ActionReadModel): string | null {
  const live = action.liveBasis;
  if (!live?.basisStatus) return null;
  if (live.basisStatus === "invalid") return "Evidence no longer valid — not actionable";
  if (live.basisStatus === "update_pending") return "Evidence changed — update pending";
  return live.proposalCurrent ? "Evidence verified" : "A newer recommendation replaces this one";
}

/** Layer 10: workflow state label; execution is always manual (Wanterest never executes). */
export function workflowStatusLabel(status: string): string {
  switch (status) {
    case "proposed": return "Proposed";
    case "approved": return "Approved";
    case "in_progress": return "In progress (you)";
    case "completed": return "Completed (you)";
    case "dismissed": return "Dismissed";
    case "superseded": return "Superseded";
    case "expired": return "Expired";
    default: return status;
  }
}

export const TRANSITION_LABELS: Record<string, string> = {
  approved: "Approve",
  in_progress: "Start (I'm doing this)",
  completed: "Mark completed",
  dismissed: "Dismiss",
};
