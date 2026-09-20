import type { DemandObservationRow, DemandProfileRow, ProductSnapshotRow } from "../../db/database.helpers";
import { clamp, normalizeFacet, type ThemeDefinition } from "./demand.schemas";

export interface DemandThemeEngine {
  readonly version: string;
  generate(input: { observations: DemandObservationRow[]; profile: DemandProfileRow }): ThemeDefinition[];
}

const TAXONOMY: Array<{ key: string; label: string; description: string; terms: string[] }> = [
  { key: "manual_workflow_pain", label: "Manual workflow pain", description: "Demand caused by repetitive or manual work.", terms: ["manual", "copying", "reconciliation", "spreadsheet", "slow"] },
  { key: "crm_fragmentation", label: "CRM fragmentation", description: "Demand caused by fragmented customer or relationship workflows.", terms: ["crm", "inbox", "sync", "fragmented"] },
  { key: "follow_up_failures", label: "Follow-up failures", description: "Demand caused by missed or unreliable follow-up work.", terms: ["follow", "follow_up", "missed", "cracks"] },
  { key: "switching_intent", label: "Tool-switching intent", description: "Explicit demand to replace or move away from an alternative.", terms: ["switch", "replace", "alternative", "moving_away"] },
  { key: "approval_bottlenecks", label: "Approval bottlenecks", description: "Demand caused by delayed review or approval steps.", terms: ["approval", "review", "blocked"] },
];

function matchingTaxonomy(value: string): (typeof TAXONOMY)[number] | undefined {
  const normalized = normalizeFacet(value);
  return TAXONOMY.find((theme) => theme.terms.some((term) => normalized.includes(term)));
}

export class FixtureDemandThemeEngine implements DemandThemeEngine {
  readonly version = "fixture-theme-v1";

  generate(input: { observations: DemandObservationRow[]; profile: DemandProfileRow }): ThemeDefinition[] {
    const groups = new Map<string, string[]>();
    const confidence = new Map<string, number>();
    for (const observation of input.observations) {
      const theme = matchingTaxonomy(`${observation.normalized_value} ${observation.facet_value} ${observation.observation_type}`)
        ?? (observation.intent_type === "switching_intent" ? TAXONOMY.find((item) => item.key === "switching_intent") : undefined);
      const key = theme?.key ?? "unclassified";
      const ids = groups.get(key) ?? [];
      ids.push(observation.id);
      groups.set(key, ids);
      confidence.set(key, Math.max(confidence.get(key) ?? 0, observation.confidence));
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, observationIds]) => {
      const taxonomy = TAXONOMY.find((item) => item.key === key);
      return {
        themeKey: key,
        label: taxonomy?.label ?? "Unclassified demand",
        description: taxonomy?.description ?? "Observed demand that is not yet mapped to the fixture taxonomy.",
        status: taxonomy ? "active" : "unclassified",
        confidence: clamp(confidence.get(key) ?? input.profile.confidence),
        observationIds: [...new Set(observationIds)].sort(),
        membershipWeight: taxonomy ? 0.9 : 0.55,
      };
    });
  }
}

export const POSITIONING_FORMULA_VERSION = "positioning-v1";
export const GAP_FORMULA_VERSION = "gap-v1";
export const DRIFT_FORMULA_VERSION = "drift-v1";

export function calculatePositioningWeight(snapshot: ProductSnapshotRow, conceptKey: string, label = conceptKey): number {
  const text = `${snapshot.normalized_text} ${snapshot.raw_text}`.toLowerCase();
  const terms = `${conceptKey.replace(/_/g, " ")} ${label}`.toLowerCase().split(/\s+/).filter((term) => term.length >= 4);
  if (!terms.length) return 0;
  const matches = terms.filter((term) => text.includes(term)).length;
  const pageBoost = snapshot.page_type === "manual" || snapshot.page_type === "features" ? 0.1 : snapshot.page_type === "pricing" ? 0.04 : 0;
  return clamp(Math.min(1, (matches / terms.length) * 0.75 + pageBoost));
}

export function calculateGapScore(marketWeight: number, positioningWeight: number, highIntentShare: number, sampleFactor: number): number {
  return clamp(marketWeight * (1 - positioningWeight) * (0.5 + 0.5 * highIntentShare) * sampleFactor);
}

export function sampleFactor(measurementQuality: string): number {
  return measurementQuality === "high_confidence" ? 1 : measurementQuality === "normal" ? 0.8 : measurementQuality === "low_confidence" ? 0.5 : 0.25;
}

export function calculateGrowthRate(current: number, previous: number): number | null {
  if (current === 0 && previous === 0) return null;
  return (current - previous) / (previous + 1);
}

export function calculateDriftDirection(currentShare: number, previousShare: number, currentMentions: number, previousMentions: number, enoughSample: boolean): "rising" | "cooling" | "stable" | "insufficient_data" {
  if (!enoughSample) return "insufficient_data";
  const delta = currentShare - previousShare;
  if (delta >= 0.05 || currentMentions - previousMentions >= 2) return "rising";
  if (delta <= -0.05 || previousMentions - currentMentions >= 2) return "cooling";
  return "stable";
}

export function calculateSignificance(shareDelta: number, enoughSample: boolean): "insufficient" | "weak" | "notable" | "strong" {
  if (!enoughSample) return "insufficient";
  const magnitude = Math.abs(shareDelta);
  return magnitude >= 0.2 ? "strong" : magnitude >= 0.1 ? "notable" : "weak";
}
