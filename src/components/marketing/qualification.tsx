import { SourceBrandIcon } from "@/components/ui/source-brand-icon";
import { MarketingBand } from "./marketing-band";

/** Three ascending bars — the design's signal-strength glyph. */
export function SignalBarsIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="1" y="7" width="2" height="4" rx="0.5" />
      <rect x="5" y="4" width="2" height="7" rx="0.5" />
      <rect x="9" y="1" width="2" height="10" rx="0.5" />
    </svg>
  );
}

type QualificationExample = {
  source: "x" | "reddit";
  sourceName: string;
  likes: string;
  quote: string;
  facets: { intent: string | null; pain: string | null; requirement: string | null };
  qualified: boolean;
};

const EXAMPLES: QualificationExample[] = [
  {
    source: "x",
    sourceName: "X",
    likes: "500K likes",
    quote: "HubSpot lol",
    facets: { intent: null, pain: null, requirement: null },
    qualified: false,
  },
  {
    source: "reddit",
    sourceName: "Reddit",
    likes: "2 likes",
    quote: "Looking for a cheaper HubSpot alternative with SSO",
    facets: { intent: "Switching", pain: "Price", requirement: "SSO" },
    qualified: true,
  },
];

const FACET_LABELS = [
  ["intent", "Intent"],
  ["pain", "Pain"],
  ["requirement", "Requirement"],
] as const;

function QualificationCard({ example }: { example: QualificationExample }) {
  return (
    <article className={`marketing-qualify-card${example.qualified ? " is-qualified" : ""}`}>
      <header className="marketing-qualify-card-head">
        <div className="marketing-source-id">
          <SourceBrandIcon sourceKey={example.source} size={22} decorative />
          <div className="marketing-source-id-text">
            <span className="marketing-source-id-name">{example.sourceName}</span>
            <span className="marketing-source-id-meta">Observation date</span>
          </div>
        </div>
        <span className="marketing-qualify-card-likes">{example.likes}</span>
      </header>
      <blockquote className="marketing-qualify-card-quote">
        <p>&ldquo;{example.quote}&rdquo;</p>
      </blockquote>
      <dl className="marketing-qualify-facets">
        {FACET_LABELS.map(([key, label]) => {
          const value = example.facets[key];
          return (
            <div className="marketing-qualify-facet" key={key}>
              <dt>{label}</dt>
              {value ? (
                <dd>{value}</dd>
              ) : (
                <dd className="is-empty">
                  <span aria-hidden="true">&mdash;</span>
                  <span className="sr-only">None</span>
                </dd>
              )}
            </div>
          );
        })}
      </dl>
      <div className="marketing-qualify-card-foot">
        {example.qualified ? (
          <span className="marketing-qualify-verdict is-signal"><SignalBarsIcon />HIGH-CONFIDENCE SIGNAL</span>
        ) : (
          <span className="marketing-qualify-verdict">NOT A SIGNAL</span>
        )}
      </div>
    </article>
  );
}

/** Qualification — "Wanterest Qualification + Why.dc.html", screen 1. */
export function QualificationSection() {
  return (
    <MarketingBand
      id="qualification"
      tone="stone"
      compactFoot
      eyebrow="QUALIFICATION"
      title="Not every mention is demand."
      subtitle="Popularity doesn’t create demand. Intent does."
      subtitleMaxWidth={420}
    >
      <div className="marketing-band-pair">
        {EXAMPLES.map((example) => (
          <QualificationCard key={example.source} example={example} />
        ))}
      </div>
    </MarketingBand>
  );
}
