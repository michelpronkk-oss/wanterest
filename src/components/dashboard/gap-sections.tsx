"use client";

import { useState } from "react";

import type { DemandGapRow } from "@/server/db/database.helpers";
import { formatPercent, themeLabel } from "./dashboard-utils";
import { InsightsDetailDrawer, type InsightsDetailSelection } from "./insights-detail-drawer";

export function GapPageBody({ gaps }: { gaps: DemandGapRow[] }) {
  const [selection, setSelection] = useState<InsightsDetailSelection | null>(null);
  const select = (row: DemandGapRow) => setSelection({ kind: "gap", row });

  const sorted = [...gaps].sort((a, b) => b.gap_score - a.gap_score);
  const topGap = sorted[0];
  const avgGapScore = sorted.reduce((sum, gap) => sum + gap.gap_score, 0) / sorted.length;

  return (
    <div style={{ marginTop: 20 }}>
      <div className="insights-stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Gap score</div><div className="insights-stat-card-value">{Math.round(avgGapScore * 100)}</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Highest missed theme</div><div className="insights-stat-card-value" style={{ fontSize: 15 }}>{themeLabel(topGap.concept_key)}</div></div>
        <div className="insights-stat-card">
          <div className="insights-stat-card-label">Urgency</div>
          <div className="insights-stat-card-value" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 20 }}>
            {topGap.gap_score >= 0.65 ? "High" : topGap.gap_score >= 0.35 ? "Medium" : "Low"}
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-accent)" }} />
          </div>
        </div>
      </div>

      <div className="ui-card ui-card-pad-lg" style={{ marginBottom: 16 }}>
        <div className="ui-section-label" style={{ marginBottom: 2 }}>Market demand vs positioning coverage</div>
        <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginBottom: 16 }}>Each theme compared against how much your site currently communicates it. Select a theme for details.</p>
        {sorted.map((gap) => (
          <button type="button" className="gap-row" key={gap.id} onClick={() => select(gap)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{themeLabel(gap.concept_key)}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: "var(--color-ink-muted)" }}>
                <span>{gap.market_mentions} signals</span>
                <span style={{ fontWeight: 700, color: "var(--color-positive)" }}>Gap +{Math.round(gap.gap_score * 100)}</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
              <div style={{ width: 130, fontSize: 11, color: "var(--color-ink-faint)", flexShrink: 0 }}>Market demand</div>
              <div className="gap-bar-track"><div className="gap-bar-fill" style={{ width: formatPercent(gap.market_weight), background: "var(--color-accent)" }} /></div>
              <div style={{ width: 40, fontSize: 12, fontWeight: 700, textAlign: "right" }}>{formatPercent(gap.market_weight)}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 130, fontSize: 11, color: "var(--color-ink-faint)", flexShrink: 0 }}>Positioning coverage</div>
              <div className="gap-bar-track"><div className="gap-bar-fill" style={{ width: formatPercent(gap.positioning_weight), background: "#c9c9c0" }} /></div>
              <div style={{ width: 40, fontSize: 12, fontWeight: 700, textAlign: "right" }}>{formatPercent(gap.positioning_weight)}</div>
            </div>
          </button>
        ))}
        <div className="gap-callout">
          <div><strong>Biggest gap detected:</strong> {topGap.interpretation}</div>
        </div>
      </div>

      <div className="ui-card ui-card-pad-lg">
        <div className="ui-section-label">Prioritized gaps</div>
        {sorted.slice(0, 6).map((gap, index) => (
          <button type="button" className="prioritized-gap-row" key={gap.id} onClick={() => select(gap)}>
            <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--color-chip)", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{index + 1}</span>
            <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{themeLabel(gap.concept_key)}</div>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)" }}>{gap.market_mentions} signals</div>
            <div style={{ fontSize: 13, fontWeight: 700, width: 44, textAlign: "right" }}>+{Math.round(gap.gap_score * 100)}</div>
          </button>
        ))}
      </div>

      <InsightsDetailDrawer selection={selection} onClose={() => setSelection(null)} />
    </div>
  );
}
