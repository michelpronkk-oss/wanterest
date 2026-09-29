import { MarketingBand, MarketingPill } from "./marketing-band";

const COMMITMENTS = [
  {
    title: "Nothing invented",
    body: "Every Signal starts from a real public conversation. Wanterest never generates market facts.",
    tags: ["Source attached"],
  },
  {
    title: "Every claim cited",
    body: "Each insight links to the conversation, source and observation date behind it.",
    tags: ["Open original", "Observation date"],
  },
  {
    title: "Uncertainty shown",
    body: "When evidence is thin, you see what was searched and how many conversations qualified.",
    tags: ["Confidence level"],
  },
  {
    title: "No contact scraping",
    body: "We read public conversations to understand demand, not to turn people into lead lists.",
    tags: ["No personal data"],
  },
] as const;

/** Why Wanterest — "Wanterest Qualification + Why.dc.html", screen 2. */
export function WhyWanterestSection() {
  return (
    <MarketingBand
      id="why-wanterest"
      tone="soft"
      eyebrow="WHY WANTEREST"
      title="Built for evidence, not guesses."
      subtitle="Four commitments behind every Signal we show you."
      subtitleMaxWidth={440}
    >
      <ol className="marketing-band-pair marketing-commitments">
        {COMMITMENTS.map((commitment, index) => (
          <li className="marketing-commitment-card" key={commitment.title}>
            <div className="marketing-commitment-head">
              <h3>{commitment.title}</h3>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            </div>
            <p className="marketing-commitment-body">{commitment.body}</p>
            <div className="marketing-commitment-tags">
              {commitment.tags.map((tag) => (
                <MarketingPill key={tag}>{tag}</MarketingPill>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </MarketingBand>
  );
}
