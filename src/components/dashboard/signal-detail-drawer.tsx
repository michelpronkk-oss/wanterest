import type { SignalReadModel } from "@/server/modules/intelligence";
import { Drawer } from "@/components/ui/drawer";
import { ConfidenceBadge, IntentBadge, SourceBadge } from "@/components/ui/badge";
import { formatRelativeTime, safeExternalUrl, sourceLabel } from "./dashboard-utils";

export function SignalDetailDrawer({ signal, open, onClose }: { signal: SignalReadModel | null; open: boolean; onClose: () => void }) {
  if (!signal) return null;
  const sourceUrl = safeExternalUrl(signal.canonicalUrl);

  return (
    <Drawer open={open} onClose={onClose} title="Signal detail">
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <SourceBadge source={signal.source} label={sourceLabel(signal.source)} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{sourceLabel(signal.source)}</span>
        <span style={{ fontSize: 12, color: "var(--color-ink-faint)" }}>{formatRelativeTime(signal.publishedAt ?? signal.createdAt)}</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <IntentBadge intentType={signal.intentType} label={signal.intentType.replaceAll("_", " ")} />
        <span className="badge badge-neutral">{signal.matchPercent}% match</span>
        {signal.qualification ? <ConfidenceBadge score={signal.qualification.confidence} /> : null}
      </div>
      <p className="signal-excerpt">&ldquo;{signal.excerpt}&rdquo;</p>
      {signal.whyItMatters ? (
        <div>
          <div className="ui-section-label" style={{ marginBottom: 6 }}>Why it matters</div>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--color-ink-secondary)" }}>{signal.whyItMatters}</p>
        </div>
      ) : null}
      {signal.qualification && signal.qualification.matched_profile_concepts.length > 0 ? (
        <div>
          <div className="ui-section-label" style={{ marginBottom: 6 }}>Matched</div>
          <div className="signal-matched">
            {signal.qualification.matched_profile_concepts.map((concept) => <span key={concept}>{concept}</span>)}
          </div>
        </div>
      ) : null}
      {signal.qualification?.resonance.available ? (
        <div>
          <div className="ui-section-label" style={{ marginBottom: 6 }}>Market resonance</div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-ink-secondary)" }}>{signal.qualification.resonance.reason}</p>
        </div>
      ) : null}
      <div>
        <div className="ui-section-label" style={{ marginBottom: 6 }}>Evidence</div>
        <div className="signal-evidence-drawer-grid">
          <div><strong>Signal evidence</strong><code>{signal.evidence.signalEvidenceNodeId}</code></div>
          <div><strong>Match evaluation</strong><code>{signal.evidence.evaluationId}</code></div>
          <div><strong>Ranking</strong><code>{signal.evidence.rankingId}</code></div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {sourceUrl ? (
          <a className="dashboard-button dashboard-button-primary" href={sourceUrl} target="_blank" rel="noreferrer">
            Open source
          </a>
        ) : null}
      </div>
    </Drawer>
  );
}
