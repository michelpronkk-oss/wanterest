"use client";

import { useState } from "react";

type TabKey = "map" | "gap" | "drift" | "actions";

const TABS: { key: TabKey; label: string }[] = [
  { key: "map", label: "Demand Map" },
  { key: "gap", label: "Demand Gap" },
  { key: "drift", label: "Demand Drift" },
  { key: "actions", label: "Actions" },
];

export function BeyondSignalsTabs() {
  const [active, setActive] = useState<TabKey>("map");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 36 }}>
        <div className="marketing-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`marketing-tab${active === tab.key ? " is-active" : ""}`}
              onClick={() => setActive(tab.key)}
            >
              <span className="marketing-tab-dot" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="marketing-tab-panel">
        {active === "map" ? <MapPreview /> : null}
        {active === "gap" ? <GapPreview /> : null}
        {active === "drift" ? <DriftPreview /> : null}
        {active === "actions" ? <ActionsPreview /> : null}
      </div>
    </div>
  );
}

const MAP_THEMES = [
  { label: "Workflow simplicity", strength: "31%", trend: "+9%", intent: "62%", evidence: "148 mentions", confidence: "High" },
  { label: "HubSpot alternative demand", strength: "24%", trend: "+4%", intent: "55%", evidence: "96 mentions", confidence: "High" },
  { label: "Pricing pressure", strength: "18%", trend: "+31%", intent: "70%", evidence: "74 mentions", confidence: "Medium" },
];

function MapPreview() {
  return (
    <div>
      <div className="insights-stat-grid" style={{ marginBottom: 16 }}>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Themes tracked</div><div className="insights-stat-card-value">14</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Qualified signals</div><div className="insights-stat-card-value">318</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Fastest growing</div><div className="insights-stat-card-value" style={{ fontSize: 15 }}>Pricing pressure</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Source coverage</div><div className="insights-stat-card-value" style={{ fontSize: 15 }}>4 sources</div></div>
      </div>
      <div className="ui-section-label" style={{ marginBottom: 2 }}>Demand themes</div>
      <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginBottom: 14 }}>Structured evidence behind each recurring theme.</p>
      <div className="theme-table-head">
        <div>Theme</div><div>Strength</div><div>Trend</div><div>High-intent</div><div>Evidence</div><div>Confidence</div>
      </div>
      {MAP_THEMES.map((row) => (
        <div className="theme-table-row" style={{ cursor: "default" }} key={row.label}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{row.label}</div>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{row.strength}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-positive)" }}>{row.trend}</div>
          <div style={{ fontSize: 13 }}>{row.intent}</div>
          <div style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>{row.evidence}</div>
          <div style={{ fontSize: 11.5, fontWeight: 600 }}>{row.confidence}</div>
        </div>
      ))}
    </div>
  );
}

const GAP_ROWS = [
  { label: "Workflow simplicity", signals: 96, gap: 42, market: "78%", positioning: "22%" },
  { label: "Pricing pressure", signals: 74, gap: 31, market: "64%", positioning: "31%" },
];

function GapPreview() {
  return (
    <div>
      <div className="marketing-gap-stats">
        <div className="insights-stat-card"><div className="insights-stat-card-label">Gap score</div><div className="insights-stat-card-value">42</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Highest missed theme</div><div className="insights-stat-card-value" style={{ fontSize: 15 }}>Workflow simplicity</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Urgency</div><div className="insights-stat-card-value" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 20 }}>High<span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-accent)" }} /></div></div>
      </div>
      <div className="ui-section-label" style={{ marginBottom: 2 }}>Market demand vs positioning coverage</div>
      <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginBottom: 16 }}>Each theme compared against how much your site currently communicates it.</p>
      {GAP_ROWS.map((row) => (
        <div className="gap-row" style={{ cursor: "default" }} key={row.label}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{row.label}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: "var(--color-ink-muted)" }}>
              <span>{row.signals} signals</span>
              <span style={{ fontWeight: 700, color: "var(--color-positive)" }}>Gap +{row.gap}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
            <div style={{ width: 130, fontSize: 11, color: "var(--color-ink-faint)", flexShrink: 0 }}>Market demand</div>
            <div className="gap-bar-track"><div className="gap-bar-fill" style={{ width: row.market, background: "var(--color-accent)" }} /></div>
            <div style={{ width: 40, fontSize: 12, fontWeight: 700, textAlign: "right" }}>{row.market}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 130, fontSize: 11, color: "var(--color-ink-faint)", flexShrink: 0 }}>Positioning coverage</div>
            <div className="gap-bar-track"><div className="gap-bar-fill" style={{ width: row.positioning, background: "#c9c9c0" }} /></div>
            <div style={{ width: 40, fontSize: 12, fontWeight: 700, textAlign: "right" }}>{row.positioning}</div>
          </div>
        </div>
      ))}
      <div className="gap-callout">
        <div><strong>Biggest gap detected:</strong> Buyers keep asking for workflow simplicity — your homepage barely mentions it.</div>
      </div>
    </div>
  );
}

function DriftPreview() {
  return (
    <div>
      <div className="marketing-drift-cols">
        <div>
          <div className="ui-section-label">What is rising</div>
          <div className="drift-row" style={{ cursor: "default" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--color-accent-tint)", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>1</span>
              <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>Pricing pressure</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-positive)", width: 50, textAlign: "right" }}>+31%</div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)", paddingLeft: 32 }}>74 mentions · 70% high-intent · High confidence</div>
          </div>
          <div className="drift-row" style={{ cursor: "default" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--color-accent-tint)", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>2</span>
              <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>Workflow simplicity</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-positive)", width: 50, textAlign: "right" }}>+9%</div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)", paddingLeft: 32 }}>148 mentions · 62% high-intent · High confidence</div>
          </div>
        </div>
        <div>
          <div className="ui-section-label">What is cooling</div>
          <div className="drift-row" style={{ cursor: "default" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--color-chip)", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>1</span>
              <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>Manual reporting</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-negative)", width: 50, textAlign: "right" }}>-12%</div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)", paddingLeft: 32 }}>41 mentions · 38% high-intent · Medium confidence</div>
          </div>
        </div>
      </div>
      <div className="ui-card ui-card-pad-lg" style={{ marginTop: 16 }}>
        <div className="ui-section-label">Emerging language</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--color-border-soft)" }}>
          <div style={{ flex: 1, fontSize: 13, color: "var(--color-ink-secondary)" }}>&ldquo;something that actually syncs with our CRM&rdquo;</div>
          <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)" }}>22</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
          <div style={{ flex: 1, fontSize: 13, color: "var(--color-ink-secondary)" }}>&ldquo;cheaper HubSpot alternative&rdquo;</div>
          <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)" }}>17</div>
        </div>
      </div>
    </div>
  );
}

function ActionsPreview() {
  return (
    <div className="action-card" style={{ cursor: "default" }}>
      <div className="action-card-header">
        <span>POSITIONING · HIGH PRIORITY</span>
        <span style={{ fontWeight: 500, color: "var(--color-ink-faint)", textTransform: "none", letterSpacing: 0 }}>Based on a demand theme</span>
      </div>
      <p className="action-card-title">Make workflow simplicity explicit in homepage positioning</p>
      <p className="action-card-why"><strong style={{ color: "var(--color-ink)" }}>Why now — </strong>Qualified signals, rising demand, and a positioning gap all point to the same theme.</p>
      <div className="action-evidence-strip">
        <div><strong style={{ color: "var(--color-ink)" }}>148</strong> qualified signals</div>
        <div><strong style={{ color: "var(--color-ink)" }}>+9%</strong> rising demand</div>
        <div><strong style={{ color: "var(--color-ink)" }}>Gap +42</strong> positioning gap</div>
      </div>
      <div className="action-card-footer">
        <span className="dashboard-button dashboard-button-secondary">Review action</span>
      </div>
    </div>
  );
}
