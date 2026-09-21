"use client";

import { useState } from "react";

import type { DemandDriftRow } from "@/server/db/database.helpers";
import { formatPercent, themeLabel } from "./dashboard-utils";
import { InsightsDetailDrawer, type InsightsDetailSelection } from "./insights-detail-drawer";

export function DriftLists({ rising, cooling }: { rising: DemandDriftRow[]; cooling: DemandDriftRow[] }) {
  const [selection, setSelection] = useState<InsightsDetailSelection | null>(null);
  const select = (row: DemandDriftRow) => setSelection({ kind: "drift", row });

  return (
    <>
      <div className="insights-two-col" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="ui-card ui-card-pad-lg">
          <div className="ui-section-label">What is rising</div>
          {rising.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>Nothing rising significantly yet.</p> : rising.slice(0, 5).map((row, index) => (
            <button type="button" className="drift-row is-interactive" key={row.id} onClick={() => select(row)}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--color-accent-tint)", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{index + 1}</span>
                <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600, textAlign: "left" }}>{themeLabel(row.concept_key)}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-positive)", width: 50, textAlign: "right" }}>+{formatPercent(row.share_delta)}</div>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)", paddingLeft: 32 }}>{row.current_mentions} mentions · {formatPercent(row.current_high_intent_share)} high-intent · {row.confidence >= 0.75 ? "High" : "Medium"} confidence</div>
            </button>
          ))}
        </div>
        <div className="ui-card ui-card-pad-lg">
          <div className="ui-section-label">What is cooling</div>
          {cooling.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>Nothing cooling significantly yet.</p> : cooling.slice(0, 5).map((row, index) => (
            <button type="button" className="drift-row is-interactive" key={row.id} onClick={() => select(row)}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--color-chip)", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{index + 1}</span>
                <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600, textAlign: "left" }}>{themeLabel(row.concept_key)}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-negative)", width: 50, textAlign: "right" }}>{formatPercent(row.share_delta)}</div>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)", paddingLeft: 32 }}>{row.current_mentions} mentions · {formatPercent(row.current_high_intent_share)} high-intent · {row.confidence >= 0.75 ? "High" : "Medium"} confidence</div>
            </button>
          ))}
        </div>
      </div>
      <InsightsDetailDrawer selection={selection} onClose={() => setSelection(null)} />
    </>
  );
}
