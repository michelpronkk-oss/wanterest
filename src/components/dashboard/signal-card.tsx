"use client";

import { useState, useTransition } from "react";

import type { SignalReadModel } from "@/server/modules/intelligence";
import { updateSignalLifecycleAction } from "@/app/app/actions";
import { formatDate, formatScore, lifecycleLabel, safeExternalUrl, sourceLabel } from "./dashboard-utils";

type Props = { signal: SignalReadModel; workspaceId: string };

export function SignalCard({ signal, workspaceId }: Props) {
  const [lifecycleStatus, setLifecycleStatus] = useState(signal.lifecycleStatus);
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sourceUrl = safeExternalUrl(signal.canonicalUrl);
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

  return (
    <article className={`signal-card${isDismissed ? " is-dismissed" : ""}`}>
      <div className="signal-card-topline">
        <div className="signal-source"><span className="signal-source-mark" aria-hidden="true">↗</span><span>{sourceLabel(signal.source)}</span></div>
        <span className="signal-score" title="Backend opportunity score">{formatScore(signal.opportunityScore)} opportunity</span>
      </div>
      <div className="signal-card-body">
        <div className="signal-card-heading">
          <div>
            <p className="signal-intent">{sourceLabel(signal.intentType)}</p>
            <h2>{signal.excerpt || "Untitled signal"}</h2>
          </div>
          <span className={`signal-status status-${lifecycleStatus}`}>{lifecycleLabel(lifecycleStatus)}</span>
        </div>
        <p className="signal-why">{signal.whyItMatters}</p>
        <div className="signal-meta">
          <span>{signal.matchPercent}% match</span>
          <span>{formatDate(signal.publishedAt ?? signal.createdAt)}</span>
          {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">View source<span className="sr-only"> (opens in a new tab)</span></a> : <span>Source link unavailable</span>}
        </div>
        {signal.tags.length > 0 ? <div className="signal-tags">{signal.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
      </div>
      <div className="signal-card-actions">
        <button className="dashboard-button dashboard-button-secondary" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? "Hide details" : "Inspect evidence"}
        </button>
        <button className={`dashboard-button ${isSaved ? "dashboard-button-primary" : "dashboard-button-quiet"}`} type="button" disabled={isPending} onClick={() => updateLifecycle(isSaved ? "active" : "saved")}>
          {isSaved ? "Saved" : "Save"}
        </button>
        <button className={`dashboard-button ${isDismissed ? "dashboard-button-primary" : "dashboard-button-quiet"}`} type="button" disabled={isPending} onClick={() => updateLifecycle(isDismissed ? "active" : "dismissed")}>
          {isDismissed ? "Dismissed" : "Dismiss"}
        </button>
      </div>
      {error ? <p className="dashboard-inline-error signal-error" role="alert">{error}</p> : null}
      {expanded ? (
        <div className="signal-evidence" aria-label="Signal evidence provenance">
          <div><strong>Signal evidence</strong><code>{signal.evidence.signalEvidenceNodeId}</code></div>
          <div><strong>Match evaluation</strong><code>{signal.evidence.evaluationId}</code></div>
          <div><strong>Ranking</strong><code>{signal.evidence.rankingId}</code></div>
          <div><strong>Conversation evidence</strong><code>{signal.evidence.conversationEvidenceNodeId || "Unavailable"}</code></div>
          <div><strong>Source item</strong><code>{signal.evidence.sourceItemId || "Unavailable"}</code></div>
          <div><strong>Demand profile</strong><code>{signal.evidence.demandProfileEvidenceNodeId || "Unavailable"}</code></div>
          {signal.buyerLanguage.length > 0 ? <div><strong>Buyer language</strong><span>{signal.buyerLanguage.join(", ")}</span></div> : null}
          {signal.painThemes.length > 0 ? <div><strong>Pain themes</strong><span>{signal.painThemes.join(", ")}</span></div> : null}
        </div>
      ) : null}
    </article>
  );
}
