"use client";

import { useState, useTransition } from "react";

import type { ActionReadModel } from "@/server/modules/actions/action.service";
import { Drawer } from "@/components/ui/drawer";
import { updateActionStatusAction } from "@/app/app/actions";
import { themeLabel } from "./dashboard-utils";
import { actionTypeLabel, basisStatusLabel, buyerLanguageQuote, evidenceStrip, priorityLabel, TRANSITION_LABELS, workflowStatusLabel } from "./action-view-model";

type HumanTransition = "approved" | "in_progress" | "completed" | "dismissed";

export function ActionDetailDrawer({ item, open, onClose }: { item: ActionReadModel | null; workspaceId?: string; open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState(item?.action.status);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!item) return null;
  const { action } = item;
  const currentStatus = status ?? action.status;
  const strip = evidenceStrip(item);
  const quote = buyerLanguageQuote(item);
  const hasVariant = Boolean(action.current_state && action.suggested_change);

  const basisLabel = basisStatusLabel(item);
  // Layer 10: only transitions the server derived for this Action (live basis + role + plan). A local change disables further buttons until refresh.
  const allowed = (currentStatus === action.status ? item.liveBasis?.allowedTransitions ?? [] : []) as HumanTransition[];

  function transition(toStatus: HumanTransition) {
    setError(null);
    startTransition(() => {
      void updateActionStatusAction({ actionId: action.id, toStatus })
        .then((result) => { if (result.ok) setStatus(toStatus); else setError(result.message); })
        .catch(() => setError("This action could not be updated. Try again."));
    });
  }

  return (
    <Drawer open={open} onClose={onClose} title="Action detail">
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-ink-muted)", textTransform: "uppercase" }}>{actionTypeLabel(action.action_type)} · {priorityLabel(action.priority_score)} PRIORITY</div>
      <p className="action-card-title" style={{ margin: 0 }}>{action.title}</p>
      <div>
        <div className="ui-section-label" style={{ marginBottom: 6 }}>Why now</div>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--color-ink-secondary)" }}>{action.why}</p>
      </div>
      {hasVariant ? (
        <div className="action-diff">
          <div className="action-diff-box"><div className="action-diff-box-label">Current state / positioning</div>{action.current_state}</div>
          <span style={{ color: "var(--color-ink-faint)" }}>→</span>
          <div className="action-diff-box"><div className="action-diff-box-label">Suggested change</div>{action.suggested_change}</div>
        </div>
      ) : null}
      {strip.length > 0 ? (
        <div>
          <div className="ui-section-label" style={{ marginBottom: 6 }}>Evidence basis</div>
          <div className="action-evidence-strip">
            {strip.map((entry) => <div key={entry.label}><strong>{entry.val}</strong> {entry.label}</div>)}
          </div>
        </div>
      ) : null}
      <div>
        <div className="ui-section-label" style={{ marginBottom: 6 }}>Related demand theme</div>
        <span className="badge badge-neutral">{themeLabel(action.trigger_concept_key ?? action.trigger_type)}</span>
      </div>
      {quote ? (
        <div>
          <div className="ui-section-label" style={{ marginBottom: 6 }}>Supporting evidence</div>
          <p className="action-quote">&ldquo;{quote}&rdquo;</p>
        </div>
      ) : null}
      <div>
        <div className="ui-section-label" style={{ marginBottom: 6 }}>Recommended next step</div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-ink-secondary)" }}>{action.summary}</p>
      </div>
      {error ? <p className="signal-error" role="alert">{error}</p> : null}
      <div>
        <div className="ui-section-label" style={{ marginBottom: 6 }}>Status</div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-ink-secondary)" }}>{workflowStatusLabel(currentStatus)}{basisLabel ? ` · ${basisLabel}` : ""}</p>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-ink-muted)" }}>Wanterest proposes; you carry out the work. Starting and completing here only records what you did.</p>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {allowed.map((toStatus) => (
          <button key={toStatus} className={toStatus === "dismissed" ? "dashboard-button dashboard-button-quiet" : "dashboard-button dashboard-button-primary"} type="button" disabled={isPending} onClick={() => transition(toStatus)}>
            {TRANSITION_LABELS[toStatus]}
          </button>
        ))}
      </div>
    </Drawer>
  );
}
