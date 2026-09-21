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
