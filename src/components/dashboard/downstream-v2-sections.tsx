import type { DemandGapV2ReadModel } from "@/server/modules/demand-intelligence/demand-gap-v2.policy";
import type { DemandDriftV2Item, DemandDriftV2ReadModel } from "@/server/modules/demand-intelligence/demand-drift-v2.policy";
import { formatPercent } from "./dashboard-utils";

/** Layer 9B copy: current gap/drift content never claims more than the live-validated evidence shows. */

export type DownstreamHeadline = { title: string; body: string };

export function demandGapV2Headline(model: DemandGapV2ReadModel): DownstreamHeadline {
  if (!model.hasCurrentEvidence) {
    return { title: "No current gap evidence", body: "Wanterest has no currently valid qualified evidence to compare against positioning right now." };
  }
  const scored = model.items.filter((item) => item.scored).length;
  return { title: "Current gap evidence", body: `${model.items.length} current demand concept${model.items.length === 1 ? "" : "s"} compared against positioning (${scored} scored, ${model.items.length - scored} directional).` };
}

const DRIFT_REASON_COPY: Record<string, string> = {
  insufficient_history: "Wanterest hasn't been observing this market long enough for an honest comparison yet.",
  unknown_window: "This time window isn't supported for comparison.",
};

export function demandDriftV2Headline(model: DemandDriftV2ReadModel): DownstreamHeadline {
  if (!model.comparable) return { title: "No comparable current movement", body: DRIFT_REASON_COPY[model.reason] ?? "No comparable window exists yet." };
  if (model.rising.length === 0 && model.cooling.length === 0) return { title: "No comparable current movement", body: "No concept had at least 5 currently valid pieces of evidence in both the current and previous window." };
  return { title: "Current movement", body: `${model.rising.length} concept${model.rising.length === 1 ? "" : "s"} rising, ${model.cooling.length} cooling, from currently valid evidence only.` };
}

export function GapV2List({ items }: { items: DemandGapV2ReadModel["items"] }) {
  if (!items.length) return null;
  return (
    <div>
      {items.map((item) => (
        <div key={item.conceptKey} style={{ padding: "10px 0", borderBottom: "1px solid var(--color-border-soft)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{item.label}</div>
            <div style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>{item.activeEvidenceCount} current evidence · {item.activeSourceCount} source{item.activeSourceCount === 1 ? "" : "s"}</div>
          </div>
          <div style={{ fontSize: 12, color: item.scored ? "var(--color-ink-secondary)" : "var(--color-ink-faint)", marginTop: 4 }}>
            {item.scored ? `Gap +${Math.round((item.gapScore ?? 0) * 100)} · positioning ${formatPercent(item.positioningWeight)}` : item.interpretation}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DriftV2Lists({ rising, cooling }: { rising: DemandDriftV2Item[]; cooling: DemandDriftV2Item[] }) {
  return (
    <div className="insights-two-col">
      <div className="ui-card ui-card-pad-lg">
        <div className="ui-section-label">What is rising (current evidence only)</div>
        {rising.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>Nothing rising significantly right now.</p> : rising.slice(0, 5).map((item) => (
          <div key={item.conceptKey} style={{ padding: "8px 0", borderBottom: "1px solid var(--color-border-soft)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{item.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-positive)" }}>+{formatPercent(item.shareDelta)}</div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)" }}>{item.currentCount} current · {item.previousCount} previous</div>
          </div>
        ))}
      </div>
      <div className="ui-card ui-card-pad-lg">
        <div className="ui-section-label">What is cooling (current evidence only)</div>
        {cooling.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>Nothing cooling significantly right now.</p> : cooling.slice(0, 5).map((item) => (
          <div key={item.conceptKey} style={{ padding: "8px 0", borderBottom: "1px solid var(--color-border-soft)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{item.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-negative)" }}>{formatPercent(item.shareDelta)}</div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)" }}>{item.currentCount} current · {item.previousCount} previous</div>
          </div>
        ))}
      </div>
    </div>
  );
}
