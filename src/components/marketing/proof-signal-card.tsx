import { SourceBrandIcon } from "@/components/ui/source-brand-icon";

type Props = {
  source: string;
  sourceLabel: string;
  time: string;
  intentLabel: string;
  intentTone?: "accent" | "neutral" | "problem";
  /** Optional real score from a supplied authoritative fixture. Marketing examples omit it. */
  matchPercent?: number;
  evidenceLabel?: string;
  quote: string;
  tags?: string[];
  iconSize?: number;
};

/** Static, non-interactive rendering of a real Signal card — used as product proof on the marketing site. */
export function ProofSignalCard({ source, sourceLabel, time, intentLabel, intentTone = "neutral", matchPercent, evidenceLabel, quote, tags, iconSize = 20 }: Props) {
  return (
    <article className={`signal-card marketing-signal-static marketing-proof-signal-card${intentTone === "problem" ? " is-problem" : ""}`}>
      <div className="marketing-proof-signal-topline">
        <div className="marketing-proof-signal-source">
          <SourceBrandIcon sourceKey={source} label={sourceLabel} size={iconSize} />
          <span className="marketing-proof-signal-source-copy">
            <span className="signal-source-name">{sourceLabel}</span>
            <span className="signal-source-time">{time}</span>
          </span>
        </div>
        <span className="marketing-proof-signal-score">{evidenceLabel ?? (matchPercent === undefined ? "Evidence attached" : `${matchPercent}% match`)}</span>
      </div>
      <span className={`marketing-proof-signal-intent${intentTone === "accent" ? " is-accent" : ""}`}>{intentLabel}</span>
      <p className="marketing-proof-signal-quote">&ldquo;{quote}&rdquo;</p>
      {tags && tags.length > 0 ? (
        <div className="marketing-proof-signal-tags">
          {tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      ) : null}
    </article>
  );
}
