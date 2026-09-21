"use client";

import { useState, useTransition } from "react";

import type { SignalReadModel } from "@/server/modules/intelligence";
import { updateSignalLifecycleAction } from "@/app/app/actions";
import { confidenceLabel, IntentBadge, SourceBadge } from "@/components/ui/badge";
import { formatRelativeTime, sourceLabel } from "./dashboard-utils";

type Props = {
  signal: SignalReadModel;
  workspaceId: string;
  onOpen?: (signalId: string) => void;
  showNote?: boolean;
};

export function SignalCard({ signal, workspaceId, onOpen, showNote = false }: Props) {
  const [lifecycleStatus, setLifecycleStatus] = useState(signal.lifecycleStatus);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isSaved = lifecycleStatus === "saved";
  const isDismissed = lifecycleStatus === "dismissed";

  function updateLifecycle(nextStatus: "active" | "saved" | "dismissed") {
    setError(null);
    startTransition(() => {
      void updateSignalLifecycleAction({ workspaceId, signalId: signal.signalId, lifecycleStatus: nextStatus })
        .then(() => setLifecycleStatus(nextStatus))
        .catch(() => setError("This signal could not be updated. Try again."));
    });
  }

  function stopPropagation(event: React.MouseEvent) {
    event.stopPropagation();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (!onOpen) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(signal.signalId);
    }
  }

  return (
    <article
      className={`signal-card${isDismissed ? " is-dismissed" : ""}`}
      onClick={() => onOpen?.(signal.signalId)}
      onKeyDown={handleKeyDown}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      <div className="signal-card-topline">
        <SourceBadge source={signal.source} label={sourceLabel(signal.source)} />
        <span className="signal-source-name">{sourceLabel(signal.source)}</span>
        <span className="signal-source-time">{formatRelativeTime(signal.publishedAt ?? signal.createdAt)}</span>
        <div className="signal-topline-end">
          <IntentBadge intentType={signal.intentType} label={signal.intentType.replaceAll("_", " ")} />
          <span className="signal-score">{signal.matchPercent}% match</span>
        </div>
      </div>
      <p className="signal-excerpt">&ldquo;{signal.excerpt || "Untitled signal"}&rdquo;</p>
      {signal.whyItMatters ? (
        <p className="signal-why">
          <span className="signal-why-label">Why</span>
          {signal.whyItMatters}
        </p>
      ) : null}
      <div className="signal-card-footer">
        <div className="signal-matched">
          {signal.qualification?.matched_profile_concepts.slice(0, 3).map((concept) => <span key={concept}>{concept}</span>)}
        </div>
        <div className="signal-card-actions" onClick={stopPropagation}>
          <button className={`dashboard-button ${isSaved ? "dashboard-button-primary" : "dashboard-button-secondary"}`} type="button" disabled={isPending} onClick={() => updateLifecycle(isSaved ? "active" : "saved")}>
            {isSaved ? "Saved" : "Save"}
          </button>
          <button className="dashboard-button dashboard-button-quiet" type="button" disabled={isPending} onClick={() => updateLifecycle(isDismissed ? "active" : "dismissed")}>
            {isDismissed ? "Dismissed" : "Dismiss"}
          </button>
        </div>
      </div>
      {error ? <p className="signal-error" role="alert">{error}</p> : null}
      {showNote ? <p className="signal-card-note">+ Add note</p> : null}
      {signal.qualification ? <span className="sr-only">{confidenceLabel(signal.qualification.confidence)}</span> : null}
    </article>
  );
}
