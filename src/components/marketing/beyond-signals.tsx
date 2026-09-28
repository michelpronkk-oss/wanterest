"use client";

import { useState, type ReactNode } from "react";

import { BarsIcon, DocumentIcon, SparkleIcon } from "./proof-icons";

type TabKey = "map" | "gap" | "drift" | "actions";

const TABS: { key: TabKey; label: string }[] = [
  { key: "map", label: "Demand Map" },
  { key: "gap", label: "Demand Gap" },
  { key: "drift", label: "Demand Drift" },
  { key: "actions", label: "Actions" },
];

/** A truthful product preview: structure and claim boundaries, never synthetic market data. */
export function BeyondSignalsTabs() {
  const [active, setActive] = useState<TabKey>("map");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 36 }}>
        <div className="marketing-tabs" role="tablist" aria-label="Wanterest intelligence views">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active === tab.key}
              className={`marketing-tab${active === tab.key ? " is-active" : ""}`}
              onClick={() => setActive(tab.key)}
            >
              <span className="marketing-tab-dot" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="marketing-tab-panel" role="tabpanel">
        {active === "map" ? <MapPreview /> : null}
        {active === "gap" ? <GapPreview /> : null}
        {active === "drift" ? <DriftPreview /> : null}
        {active === "actions" ? <ActionsPreview /> : null}
      </div>
    </div>
  );
}

function PanelHead({ icon, eyebrow, title }: { icon: ReactNode; eyebrow: string; title: string }) {
  return (
    <div className="marketing-beyond-panel-head">
      <span className="marketing-beyond-panel-icon">{icon}</span>
      <div>
        <div className="marketing-beyond-panel-eyebrow">{eyebrow}</div>
        <h3 className="marketing-beyond-panel-title">{title}</h3>
      </div>
      <span className="marketing-beyond-panel-badge">Illustrative view</span>
    </div>
  );
}

function PanelRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="marketing-beyond-panel-rows">
      {rows.map(([title, body]) => (
        <div className="marketing-beyond-panel-row" key={title}>
          <strong>{title}</strong>
          <span>{body}</span>
        </div>
      ))}
    </div>
  );
}

function MapPreview() {
  return (
    <div>
      <PanelHead icon={<BarsIcon />} eyebrow="DEMAND MAP" title="Make recurring language inspectable." />
      <p className="marketing-beyond-panel-body">Signals can be grouped into themes while each theme keeps its supporting observations and qualification context attached.</p>
      <PanelRows rows={[
        ["Theme", "A bounded grouping of related observations."],
        ["Evidence", "Source references and observation periods remain inspectable."],
        ["Confidence", "Shown only when the underlying intelligence supports it."],
      ]} />
    </div>
  );
}

function GapPreview() {
  return (
    <div>
      <PanelHead icon={<DocumentIcon />} eyebrow="DEMAND GAP" title="See where context is missing." />
      <p className="marketing-beyond-panel-body">Demand Gap compares supported market observations with the product context supplied by the workspace. It does not invent market size or coverage percentages.</p>
      <PanelRows rows={[
        ["Observed need", "What the supporting conversations actually describe."],
        ["Product context", "What the current product information makes clear."],
        ["Open question", "What still needs validation before action."],
      ]} />
    </div>
  );
}

function DriftPreview() {
  return (
    <div>
      <PanelHead icon={<SparkleIcon />} eyebrow="DEMAND DRIFT" title="Keep change tied to a time window." />
      <p className="marketing-beyond-panel-body">Demand Drift distinguishes a supported change in the selected evidence window from a claim about the whole market.</p>
      <PanelRows rows={[
        ["Rising", "A supported change in observed language."],
        ["Cooling", "A supported decrease or loss of currentness."],
        ["Uncertain", "Insufficient or conflicting evidence stays qualified."],
      ]} />
    </div>
  );
}

function ActionsPreview() {
  return (
    <div className="action-card" style={{ cursor: "default" }}>
      <div className="action-card-header">
        <span>POSITIONING · REVIEW REQUIRED</span>
        <span style={{ fontWeight: 500, color: "var(--color-ink-faint)", textTransform: "none", letterSpacing: 0 }}>Connected to evidence</span>
      </div>
      <p className="action-card-title">Turn a supported finding into a reviewable next move.</p>
      <p className="action-card-why"><strong style={{ color: "var(--color-ink)" }}>Why it matters: </strong>Actions remain interpretations connected to the evidence behind them, not new market facts.</p>
      <div className="action-evidence-strip">
        <div><strong style={{ color: "var(--color-ink)" }}>Source</strong> attached</div>
        <div><strong style={{ color: "var(--color-ink)" }}>Window</strong> visible</div>
        <div><strong style={{ color: "var(--color-ink)" }}>Review</strong> required</div>
      </div>
      <div className="action-card-footer">
        <span className="dashboard-button dashboard-button-secondary">Review action</span>
      </div>
    </div>
  );
}
