import type { ReactNode } from "react";

import type { DemandMapConcept, DemandMapV2ReadModel } from "@/server/modules/demand-intelligence/demand-map.policy";
import { formatDate, sourceLabel, themeLabel } from "./dashboard-utils";

const EXCLUSION_LABELS: Record<string, string> = {
  evaluation_superseded: "re-evaluated below the qualification bar",
  signal_invalidated: "invalidated",
  signal_retracted: "retracted",
  stale: "older than 90 days",
  duplicate_conversation: "duplicate conversation",
  duplicate_content: "duplicate content",
  evidence_unavailable: "evidence unavailable",
  not_in_latest_state: "awaiting recompute",
};

export function exclusionReasonLabel(reason: string): string {
  return EXCLUSION_LABELS[reason] ?? reason.replace(/_/g, " ");
}

/** "10 re-evaluated below the qualification bar · 1 invalidated" (largest first). */
export function exclusionSummary(exclusions: Record<string, number>): string {
  return Object.entries(exclusions)
    .filter(([, count]) => count > 0)
    .sort(([leftKey, left], [rightKey, right]) => right - left || leftKey.localeCompare(rightKey))
    .map(([reason, count]) => `${count} ${exclusionReasonLabel(reason)}`)
    .join(" · ");
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function conceptEvidenceCopy(concept: DemandMapConcept): string {
  return `${plural(concept.activeEvidenceCount, "distinct conversation")} · ${plural(concept.activeSourceCount, "source")}`;
}

export type DemandMapHeadline = { state: "current" | "none_current" | "none_clustered"; title: string; body: string };

/** Headline built only from live-validated current demand; legacy history never contributes. */
export function demandMapHeadline(model: DemandMapV2ReadModel): DemandMapHeadline {
  const { totals } = model;
  if (totals.currentConceptCount > 0) {
    return {
      state: "current",
      title: "Current demand",
      body: `${plural(totals.currentConceptCount, "demand concept")} backed by ${plural(totals.activeEvidenceCount, "distinct conversation")} from ${plural(totals.activeSourceCount, "source")}.`,
    };
  }
  if (model.previouslyObserved.length > 0) {
    return {
      state: "none_current",
      title: "No current demand confirmed",
      body: "Wanterest has observed related demand before, but none of it is valid right now: it was re-evaluated below the qualification bar, invalidated, retracted, or is older than 90 days. Nothing is counted as current until new qualifying evidence arrives.",
    };
  }
  return {
    state: "none_clustered",
    title: "No current demand confirmed",
    body: "No qualified evidence has been grouped into demand concepts for this product yet.",
  };
}

/** Overview "Market state" line (Layer 9A). */
export function marketStateCopy(model: DemandMapV2ReadModel): string {
  const top = model.current[0];
  if (!top) return "No current demand confirmed.";
  return `${top.label} leads current demand with ${plural(top.activeEvidenceCount, "distinct conversation")} from ${plural(top.activeSourceCount, "source")}.`;
}

function mixCopy(mix: Record<string, number>, label: (key: string) => string): string {
  return Object.entries(mix).sort(([leftKey, left], [rightKey, right]) => right - left || leftKey.localeCompare(rightKey)).map(([key, count]) => `${label(key)} ${count}`).join(" · ");
}

export function DemandMapCurrentConcepts({ concepts }: { concepts: DemandMapConcept[] }) {
  return (
    <div>
      {concepts.map((concept) => (
        <div key={concept.conceptKey} style={{ padding: "12px 0", borderBottom: "1px solid var(--color-border-soft)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{concept.label}</div>
            <div style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>{conceptEvidenceCopy(concept)}</div>
            {concept.level ? <div style={{ fontSize: 11.5, fontWeight: 600 }}>{themeLabel(concept.level)}</div> : null}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--color-ink-faint)", marginTop: 4 }}>
            {mixCopy(concept.sourceMix, sourceLabel)} · {mixCopy(concept.intentFamilyMix, themeLabel)} · last evidence {formatDate(concept.lastActiveEvidenceAt)}
            {concept.updatePending ? " · update pending" : ""}
          </div>
          {concept.buyerLanguage.length ? (
            <div style={{ fontSize: 12.5, color: "var(--color-ink-secondary)", marginTop: 6 }}>
              {concept.buyerLanguage.map((phrase) => <span key={phrase} style={{ marginRight: 12 }}>&ldquo;{phrase}&rdquo;</span>)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function DemandMapPreviouslyObserved({ concepts }: { concepts: DemandMapConcept[] }) {
  if (!concepts.length) return null;
  return (
    <details className="ui-card ui-card-pad-lg" style={{ marginBottom: 16 }}>
      <summary className="ui-section-label" style={{ cursor: "pointer" }}>Previously observed ({concepts.length}) - not current demand</summary>
      <p style={{ fontSize: 12, color: "var(--color-ink-faint)", margin: "8px 0 10px" }}>Evidence Wanterest saw earlier that no longer counts as current demand. Kept for history and provenance.</p>
      {concepts.map((concept) => (
        <div key={concept.conceptKey} style={{ padding: "8px 0", borderBottom: "1px solid var(--color-border-soft)" }}>
          <div style={{ fontSize: 13.5 }}>{concept.label} <span style={{ fontSize: 11.5, color: "var(--color-ink-muted)" }}>({plural(concept.observedEvidenceCount, "item")}, none current)</span></div>
          <div style={{ fontSize: 11.5, color: "var(--color-ink-faint)", marginTop: 2 }}>{exclusionSummary(concept.exclusions)} · last seen {formatDate(concept.lastObservedAt)}</div>
        </div>
      ))}
    </details>
  );
}

/** Legacy snapshot content, always collapsed and labelled as not lifecycle-filtered. */
export function HistoricalEvidenceSection({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <details className="ui-card ui-card-pad-lg" style={{ marginBottom: 16 }}>
      <summary className="ui-section-label" style={{ cursor: "pointer" }}>Historical evidence (not lifecycle-filtered)</summary>
      <p style={{ fontSize: 12, color: "var(--color-ink-faint)", margin: "8px 0 12px" }}>{caption} These figures include evidence that has since been re-evaluated, invalidated or retracted, so they are not current demand.</p>
      {children}
    </details>
  );
}

export function historicalCaption(legacy: NonNullable<DemandMapV2ReadModel["historical"]["legacy"]>): string {
  return `Snapshot ${formatDate(legacy.snapshot.period_start)} - ${formatDate(legacy.snapshot.period_end)}, ${plural(legacy.snapshot.sample_size, "conversation")}.`;
}
