"use client";

import { useState } from "react";

import type { DemandDriftRow, DemandSnapshotThemeRow } from "@/server/db/database.helpers";
import { formatPercent, themeLabel } from "./dashboard-utils";
import { InsightsDetailDrawer, type InsightsDetailSelection } from "./insights-detail-drawer";

export function ThemeTable({ themes, drifts }: { themes: DemandSnapshotThemeRow[]; drifts: DemandDriftRow[] }) {
  const [selection, setSelection] = useState<InsightsDetailSelection | null>(null);
  const driftByTheme = new Map(drifts.map((row) => [row.concept_key, row]));

  return (
    <>
      <div className="theme-table-head">
        <div>Theme</div><div>Strength</div><div>Trend</div><div>High-intent</div><div>Evidence</div><div>Confidence</div>
      </div>
      {themes.map((theme) => {
        const drift = driftByTheme.get(theme.theme_key) ?? null;
        return (
          <button type="button" className="theme-table-row" key={theme.id} onClick={() => setSelection({ kind: "theme", row: theme, drift })}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{themeLabel(theme.theme_key)}</div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{formatPercent(theme.share_of_demand)}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: drift ? (drift.drift_direction === "rising" ? "var(--color-positive)" : drift.drift_direction === "cooling" ? "var(--color-negative)" : "var(--color-ink-muted)") : "var(--color-ink-faint)" }}>
              {drift ? `${drift.share_delta >= 0 ? "+" : ""}${formatPercent(drift.share_delta)}` : "—"}
            </div>
            <div style={{ fontSize: 13 }}>{formatPercent(theme.high_intent_share)}</div>
            <div style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>{theme.mention_count} mentions</div>
            <div style={{ fontSize: 11.5, fontWeight: 600 }}>{theme.confidence >= 0.75 ? "High" : theme.confidence >= 0.5 ? "Medium" : "Low"}</div>
          </button>
        );
      })}
      <InsightsDetailDrawer selection={selection} onClose={() => setSelection(null)} />
    </>
  );
}
