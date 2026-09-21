import type { ActionReadModel } from "@/server/modules/actions/action.service";
import { themeLabel } from "./dashboard-utils";
import { actionTypeLabel, buyerLanguageQuote, evidenceStrip, priorityLabel } from "./action-view-model";

export function ActionCard({ item, onOpen }: { item: ActionReadModel; onOpen: (id: string) => void }) {
  const { action } = item;
  const priority = priorityLabel(action.priority_score);
  const strip = evidenceStrip(item);
  const quote = buyerLanguageQuote(item);
  const hasVariant = Boolean(action.current_state && action.suggested_change);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(action.id);
    }
  }

  return (
    <div className="action-card" role="button" tabIndex={0} onClick={() => onOpen(action.id)} onKeyDown={handleKeyDown}>
      <div className="action-card-header">
        <span style={{ color: priority === "HIGH" ? "var(--color-negative)" : "var(--color-ink-muted)" }}>{actionTypeLabel(action.action_type)} · {priority} PRIORITY</span>
        <span style={{ fontWeight: 500, color: "var(--color-ink-faint)", textTransform: "none", letterSpacing: 0 }}>Based on {themeLabel(action.trigger_concept_key ?? action.trigger_type)}</span>
      </div>
      <p className="action-card-title">{action.title}</p>
      <p className="action-card-why"><strong style={{ color: "var(--color-ink)" }}>Why now — </strong>{action.why}</p>
      {hasVariant ? (
        <div className="action-diff">
          <div className="action-diff-box"><div className="action-diff-box-label">Current</div>{action.current_state}</div>
          <span style={{ color: "var(--color-ink-faint)" }}>→</span>
          <div className="action-diff-box"><div className="action-diff-box-label">Suggested</div>{action.suggested_change}</div>
        </div>
      ) : null}
      {strip.length > 0 ? (
        <div className="action-evidence-strip">
          {strip.map((entry) => (
            <div key={entry.label}><strong>{entry.val}</strong> {entry.label}</div>
          ))}
        </div>
      ) : null}
      {quote ? <p className="action-quote">&ldquo;{quote}&rdquo;</p> : null}
      <div className="action-card-footer" onClick={(event) => event.stopPropagation()}>
        <button className="dashboard-button dashboard-button-primary" type="button" onClick={() => onOpen(action.id)}>Review action</button>
      </div>
    </div>
  );
}
