import type { ReactNode } from "react";

import { SourceBrandIcon } from "./source-brand-icon";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "dark" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function SourceBadge({ source, label }: { source: string; label: string }) {
  return <SourceBrandIcon sourceKey={source} label={label} className="signal-source-mark" decorative />;
}

const HIGH_INTENT: ReadonlySet<string> = new Set(["high_intent", "switching_intent"]);

export function IntentBadge({ intentType, label }: { intentType: string; label: string }) {
  const isHigh = HIGH_INTENT.has(intentType);
  return <Badge tone={isHigh ? "accent" : "neutral"}>{label}</Badge>;
}

export type ConfidenceLevel = "high" | "medium" | "low";

export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

export function confidenceLabel(score: number): string {
  const level = confidenceLevel(score);
  return level === "high" ? "High confidence" : level === "medium" ? "Medium confidence" : "Low confidence";
}

export function ConfidenceBadge({ score }: { score: number }) {
  return <Badge tone="neutral">{confidenceLabel(score)}</Badge>;
}
