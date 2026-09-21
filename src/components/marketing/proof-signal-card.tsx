import { Badge, SourceBadge } from "@/components/ui/badge";

type Props = {
  source: string;
  sourceLabel: string;
  time: string;
  intentLabel: string;
  intentTone?: "accent" | "neutral";
  matchPercent: number;
  quote: string;
  why?: string;
  tags?: string[];
};

/** Static, non-interactive rendering of a real Signal card — used as product proof on the marketing site. */
export function ProofSignalCard({ source, sourceLabel, time, intentLabel, intentTone = "neutral", matchPercent, quote, why, tags }: Props) {
  return (
    <article className="signal-card marketing-signal-static">
      <div className="signal-card-topline">
        <SourceBadge source={source} label={sourceLabel} />
        <span className="signal-source-name">{sourceLabel}</span>
        <span className="signal-source-time">{time}</span>
        <div className="signal-topline-end">
          <Badge tone={intentTone}>{intentLabel}</Badge>
          <span className="signal-score">{matchPercent}% match</span>
        </div>
      </div>
      <p className="signal-excerpt">&ldquo;{quote}&rdquo;</p>
      {why ? (
        <p className="signal-why">
          <span className="signal-why-label">Why</span>
          {why}
        </p>
      ) : null}
      {tags && tags.length > 0 ? (
        <div className="signal-card-footer">
          <div className="signal-matched">
            {tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
