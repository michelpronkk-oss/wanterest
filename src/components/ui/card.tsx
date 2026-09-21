import type { ReactNode } from "react";

export function Card({ children, padding = "lg", className = "" }: { children: ReactNode; padding?: "sm" | "lg"; className?: string }) {
  const padClass = padding === "sm" ? "ui-card-pad" : "ui-card-pad-lg";
  return <div className={`ui-card ${padClass} ${className}`.trim()}>{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="ui-section-label">{children}</div>;
}

export function MetricCard({ label, value, accent, compact }: { label: string; value: ReactNode; accent?: boolean; compact?: boolean }) {
  return (
    <div className="metric-card">
      <div className="metric-card-label">{label}</div>
      <div className={`metric-card-value${compact ? " is-compact" : ""}`}>
        {value}
        {accent ? <span className="badge-dot" style={{ color: "var(--color-accent)" }} /> : null}
      </div>
    </div>
  );
}
