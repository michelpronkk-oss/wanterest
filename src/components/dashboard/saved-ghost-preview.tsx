const ROWS = ["Switching intent · pricing pressure", "Problem signal · workflow friction", "High intent · buyer language"];

/** Quiet, archive-like structural preview for the Saved page — no card, just a bookmarked list. */
export function SavedGhostPreview() {
  return (
    <div className="saved-ghost-list" aria-hidden="true">
      {ROWS.map((row) => (
        <div className="saved-ghost-row" key={row}>
          <span className="saved-ghost-mark" aria-hidden="true">
            <svg width="11" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 2.5H12V14L8 11L4 14V2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
          </span>
          <span className="saved-ghost-label">{row}</span>
        </div>
      ))}
    </div>
  );
}
