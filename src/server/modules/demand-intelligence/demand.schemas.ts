import { z } from "zod";
import type {
  DemandDriftAlternativeRow, DemandDriftPhraseRow, DemandDriftRow, DemandGapRow,
  DemandSnapshotAlternativeRow, DemandSnapshotIntentRow, DemandSnapshotPhraseRow,
  DemandSnapshotRow, DemandSnapshotThemeRow,
} from "../../db/database.helpers";

export const demandWindowSchema = z.enum(["7d", "30d", "90d"]);
export type DemandWindow = z.infer<typeof demandWindowSchema>;

export const observationTypeSchema = z.enum([
  "pain", "desired_outcome", "buyer_language", "alternative",
  "capability_request", "switching_reason", "problem", "intent",
]);
export type ObservationType = z.infer<typeof observationTypeSchema>;

export const demandDirectionSchema = z.enum(["rising", "cooling", "stable", "insufficient_data"]);
export type DemandDirection = z.infer<typeof demandDirectionSchema>;
export const demandSignificanceSchema = z.enum(["insufficient", "weak", "notable", "strong"]);
export type DemandSignificance = z.infer<typeof demandSignificanceSchema>;

export type ThemeDefinition = {
  themeKey: string;
  label: string;
  description: string;
  status: "active" | "unclassified" | "archived";
  confidence: number;
  observationIds: string[];
  membershipWeight: number;
};

export type DemandMapReadModel = {
  snapshot: DemandSnapshotRow;
  themes: DemandSnapshotThemeRow[];
  phrases: DemandSnapshotPhraseRow[];
  alternatives: DemandSnapshotAlternativeRow[];
  intents: DemandSnapshotIntentRow[];
  provenance: { evidenceNodeId: string; sourceIds: string[] };
};

export type DemandGapReadModel = {
  gaps: DemandGapRow[];
  snapshotId: string;
};

export type DemandDriftReadModel = {
  drifts: DemandDriftRow[];
  phraseDrifts: DemandDriftPhraseRow[];
  alternativeDrifts: DemandDriftAlternativeRow[];
  currentSnapshotId: string;
  previousSnapshotId: string;
};

export function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function normalizeFacet(value: string): string {
  const lower = value.toLowerCase().trim();
  const aliases: Array<[RegExp, string]> = [
    [/\b(manually|by hand|manual)\b/g, "manual"],
    [/\b(customer relationship management|crm)\b/g, "crm"],
    [/\b(follow[ -]?up|followup)\b/g, "follow_up"],
    [/\b(copy[ -]?paste|copying)\b/g, "copying"],
    [/\b(replace|replacing|switching|switch)\b/g, "switch"],
  ];
  let normalized = lower;
  for (const [pattern, replacement] of aliases) normalized = normalized.replace(pattern, replacement);
  return normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 300) || "unknown";
}

export function windowDays(window: DemandWindow): number {
  return Number(window.slice(0, -1));
}

export function windowStart(end: string, window: DemandWindow): string {
  const date = new Date(end);
  date.setUTCDate(date.getUTCDate() - windowDays(window));
  return date.toISOString();
}
