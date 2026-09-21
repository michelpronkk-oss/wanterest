"use client";

import { useState, useTransition } from "react";

import type { ActionReadModel } from "@/server/modules/actions/action.service";
import { Drawer } from "@/components/ui/drawer";
import { updateActionStatusAction } from "@/app/app/actions";
import { themeLabel } from "./dashboard-utils";
import { actionTypeLabel, buyerLanguageQuote, evidenceStrip, priorityLabel } from "./action-view-model";

export function ActionDetailDrawer({ item, workspaceId, open, onClose }: { item: ActionReadModel | null; workspaceId: string; open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState(item?.action.status);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!item) return null;
  const { action } = item;
  const currentStatus = status ?? action.status;
  const strip = evidenceStrip(item);
  const quote = buyerLanguageQuote(item);
  const hasVariant = Boolean(action.current_state && action.suggested_change);

  function transition(toStatus: "approved" | "dismissed") {
    setError(null);
    startTransition(() => {
      void updateActionStatusAction({ workspaceId, actionId: action.id, toStatus })
        .then(() => setStatus(toStatus))
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="dashboard-button dashboard-button-primary" type="button" disabled={isPending || currentStatus !== "proposed"} onClick={() => transition("approved")}>
          {currentStatus === "approved" ? "Approved" : "Mark reviewed"}
        </button>
        <button className="dashboard-button dashboard-button-quiet" type="button" disabled={isPending || currentStatus !== "proposed"} onClick={() => transition("dismissed")}>
          {currentStatus === "dismissed" ? "Dismissed" : "Dismiss"}
        </button>
      </div>
    </Drawer>
  );
}
