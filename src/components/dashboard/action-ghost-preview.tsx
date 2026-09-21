/** Structural preview of an Action card — real anatomy, placeholder copy, no fabricated evidence. */
export function ActionGhostPreview() {
  return (
    <div className="action-card is-ghost" aria-hidden="true">
      <div className="action-card-header">
        <span>POSITIONING · MEDIUM PRIORITY</span>
        <span style={{ fontWeight: 500, color: "var(--color-ink-faint)", textTransform: "none", letterSpacing: 0 }}>Based on a demand theme</span>
      </div>
      <p className="action-card-title is-ghost-text">Make [your differentiator] explicit</p>
      <p className="action-card-why is-ghost-text"><strong style={{ color: "var(--color-ink)" }}>Why now — </strong>Qualified signals, rising demand, and a positioning gap point to the same theme.</p>
      <div className="action-evidence-strip">
        <div><strong className="is-ghost-text">—</strong> qualified signals</div>
        <div><strong className="is-ghost-text">—</strong> rising demand</div>
        <div><strong className="is-ghost-text">—</strong> positioning gap</div>
      </div>
      <div className="action-card-footer">
        <span className="dashboard-button dashboard-button-secondary is-ghost-button">Review action</span>
      </div>
    </div>
  );
}
