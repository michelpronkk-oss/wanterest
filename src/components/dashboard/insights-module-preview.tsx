/** Structural, data-free preview of the three Insights modules — labels and skeleton bars only. */
export function InsightsModulePreview() {
  return (
    <div className="insights-module-grid" aria-hidden="true">
      <div className="insights-module-card">
        <div className="insights-module-title">Demand Map</div>
        <div className="insights-module-row"><span className="ghost-bar is-wide" /><span className="ghost-bar is-narrow" /></div>
        <div className="insights-module-row"><span className="ghost-bar is-medium" /><span className="ghost-bar is-narrow" /></div>
        <div className="insights-module-legend"><span>Theme</span><span>Strength</span></div>
      </div>
      <div className="insights-module-card">
        <div className="insights-module-title">Demand Gap</div>
        <div className="insights-module-bar-row"><span className="insights-module-bar-label">Market demand</span><div className="gap-bar-track"><div className="ghost-fill" style={{ width: "72%" }} /></div></div>
        <div className="insights-module-bar-row"><span className="insights-module-bar-label">Positioning coverage</span><div className="gap-bar-track"><div className="ghost-fill is-muted" style={{ width: "28%" }} /></div></div>
      </div>
      <div className="insights-module-card">
        <div className="insights-module-title">Demand Drift</div>
        <div className="insights-module-row"><span style={{ fontSize: 11.5, color: "var(--color-positive)", fontWeight: 600 }}>Rising</span><span className="ghost-bar is-narrow" /></div>
        <div className="insights-module-row"><span style={{ fontSize: 11.5, color: "var(--color-negative)", fontWeight: 600 }}>Cooling</span><span className="ghost-bar is-narrow" /></div>
      </div>
    </div>
  );
}
