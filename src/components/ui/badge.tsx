import type { ReactNode } from "react";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "dark" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const SOURCE_COLORS: Record<string, string> = {
  reddit: "#FF4500",
  "hacker-news": "#FF6600",
  bluesky: "#0085FF",
  github: "#24292e",
  x: "#000000",
  fixture: "#8c8c82",
};

export function sourceColor(source: string): string {
  return SOURCE_COLORS[source] ?? "#4a4a43";
}

export function sourceInitial(source: string): string {
  return source.trim().charAt(0).toUpperCase() || "?";
}

export function SourceBadge({ source, label }: { source: string; label: string }) {
  return (
    <span className="signal-source-mark" style={{ background: sourceColor(source) }} role="img" aria-label={label} title={label}>
      {sourceInitial(source)}
    </span>
  );
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
