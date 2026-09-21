"use client";

import type { DemandDriftRow, DemandGapRow, DemandSnapshotThemeRow } from "@/server/db/database.helpers";
import { Drawer } from "@/components/ui/drawer";
import { formatPercent, themeLabel } from "./dashboard-utils";

export type InsightsDetailSelection =
  | { kind: "theme"; row: DemandSnapshotThemeRow; drift: DemandDriftRow | null }
  | { kind: "gap"; row: DemandGapRow }
  | { kind: "drift"; row: DemandDriftRow };

function confidenceWord(value: number): string {
  return value >= 0.75 ? "High" : value >= 0.5 ? "Medium" : "Low";
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="insights-drawer-stat">
      <div className="insights-drawer-stat-label">{label}</div>
      <div className="insights-drawer-stat-value">{value}</div>
    </div>
  );
}

export function InsightsDetailDrawer({ selection, onClose }: { selection: InsightsDetailSelection | null; onClose: () => void }) {
  if (!selection) return null;

  if (selection.kind === "theme") {
    const { row, drift } = selection;
    return (
      <Drawer open title="Theme detail" onClose={onClose}>
        <h3 className="insights-drawer-title">{themeLabel(row.theme_key)}</h3>
        <div className="insights-drawer-grid">
          <StatRow label="Demand strength" value={formatPercent(row.share_of_demand)} />
          <StatRow label="Trend" value={drift ? `${drift.share_delta >= 0 ? "+" : ""}${formatPercent(drift.share_delta)}` : "Needs a second scan"} />
          <StatRow label="High-intent share" value={formatPercent(row.high_intent_share)} />
          <StatRow label="Confidence" value={confidenceWord(row.confidence)} />
        </div>
        <p className="insights-drawer-meta">{row.mention_count} mentions · {row.unique_conversations} qualified conversation{row.unique_conversations === 1 ? "" : "s"}</p>
        {row.average_opportunity_score ? <p className="insights-drawer-meta">Average opportunity score: {formatPercent(row.average_opportunity_score)}</p> : null}
      </Drawer>
    );
  }

  if (selection.kind === "gap") {
    const { row } = selection;
    return (
      <Drawer open title="Gap detail" onClose={onClose}>
        <h3 className="insights-drawer-title">{themeLabel(row.concept_key)}</h3>
        <div className="insights-drawer-grid">
          <StatRow label="Market demand" value={formatPercent(row.market_weight)} />
          <StatRow label="Positioning coverage" value={formatPercent(row.positioning_weight)} />
          <StatRow label="Gap" value={`+${Math.round(row.gap_score * 100)}`} />
          <StatRow label="High-intent share" value={formatPercent(row.high_intent_share)} />
        </div>
        <p className="insights-drawer-meta">{row.market_mentions} signals · {confidenceWord(row.confidence)} confidence</p>
        {row.interpretation ? (
          <div className="insights-drawer-callout">{row.interpretation}</div>
        ) : null}
      </Drawer>
    );
  }

  const { row } = selection;
  return (
    <Drawer open title="Drift detail" onClose={onClose}>
      <h3 className="insights-drawer-title">{themeLabel(row.concept_key)}</h3>
      <div className="insights-drawer-grid">
        <StatRow label="Direction" value={row.drift_direction} />
        <StatRow label="Share change" value={`${row.share_delta >= 0 ? "+" : ""}${formatPercent(row.share_delta)}`} />
        <StatRow label="Significance" value={row.significance} />
        <StatRow label="Confidence" value={confidenceWord(row.confidence)} />
      </div>
      <p className="insights-drawer-meta">
        {row.current_mentions} mentions now vs {row.previous_mentions} previously · {formatPercent(row.current_high_intent_share)} high-intent
      </p>
      {row.growth_rate != null ? <p className="insights-drawer-meta">Growth rate: {formatPercent(row.growth_rate)}</p> : null}
    </Drawer>
  );
}
