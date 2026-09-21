/** Structural preview of an Experiment shell — real anatomy, placeholder copy, no fabricated lift/confidence values. */
export function ExperimentGhostPreview() {
  return (
    <div className="experiment-card is-ghost" aria-hidden="true">
      <div className="experiment-card-header">
        <span className="badge badge-neutral">Draft</span>
      </div>
      <p className="experiment-linked is-ghost-text">Linked to an approved Action</p>
      <p className="experiment-title is-ghost-text">Test a clearer positioning statement</p>
      <p className="experiment-hypothesis is-ghost-text">If we state [X] explicitly, more qualified visitors will take the next step.</p>
      <div className="experiment-diff">
        <div className="action-diff-box"><div className="action-diff-box-label">Control</div>Current positioning</div>
        <div className="action-diff-box"><div className="action-diff-box-label">Variant</div>Updated positioning</div>
      </div>
      <div className="experiment-metrics">
        <div><div className="experiment-metric-label">Lift vs control</div><div className="experiment-metric-value is-ghost-text">—</div></div>
        <div><div className="experiment-metric-label">Result</div><div className="experiment-metric-value is-ghost-text" style={{ fontSize: 14 }}>Not started</div></div>
        <div><div className="experiment-metric-label">Sample size</div><div className="experiment-metric-value is-ghost-text">—</div></div>
        <div><div className="experiment-metric-label">Primary metric</div><div className="experiment-metric-value is-ghost-text" style={{ fontSize: 14 }}>cta click</div></div>
      </div>
    </div>
  );
}
