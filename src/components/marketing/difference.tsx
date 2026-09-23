import { LogoMark } from "@/components/dashboard/nav-icons";
import { ResponsiveText } from "./responsive-text";

function FilterIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <span className="marketing-difference-check" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="m2.2 6.2 2.2 2.2 5.3-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** A drawn curly-brace, not a stretched text glyph — stays crisp at any size. `flip` mirrors it for the right-hand side. */
function DifferenceBrace({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      className={`marketing-difference-brace-svg${flip ? " is-flipped" : ""}`}
      viewBox="0 0 20 160"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M14,2 C18,2 18,9 18,22 L18,58 C18,72 2,73 2,80 C2,87 18,88 18,102 L18,138 C18,151 18,158 14,158"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

type DifferencePoint = { title: string; full: string; short: string };

const DEFAULT_OLD_TITLE = "Lead finder";

const DEFAULT_OLD_POINTS: DifferencePoint[] = [
  { title: "Company filters", full: "Find companies that match your ICP.", short: "Find companies that match your ICP." },
  { title: "Contact lists", full: "Get names and email addresses.", short: "Get names and email addresses." },
  { title: "Cold outreach", full: "Hope your message gets a response.", short: "Hope your message gets a response." },
];

const DEFAULT_MODERN_POINTS: DifferencePoint[] = [
  { title: "Real conversations", full: "People discussing your problem in the wild.", short: "People discussing your problem." },
  { title: "Visible pain", full: "See what they are struggling with.", short: "See what they are struggling with." },
  { title: "Active intent", full: "Find buyers before they reach out to competitors.", short: "Find buyers before competitors do." },
  { title: "Context and timing", full: "Understand the why, not just the who.", short: "Understand the why, not just the who." },
];

const DEFAULT_LEFT_ANNOTATION = ["Lots of data.", "Not enough signal."];
const DEFAULT_RIGHT_ANNOTATION = ["Real people.", "Real problems.", "Real opportunities."];

/**
 * The old-way-vs-Wanterest comparison visual (cards, braces, VS badge). Shared by the
 * homepage difference section and the /product "why Wanterest" section so both carry the
 * same high-end visual with page-appropriate copy.
 */
export function DifferenceStage({
  oldCardTitle = DEFAULT_OLD_TITLE,
  oldPoints = DEFAULT_OLD_POINTS,
  modernPoints = DEFAULT_MODERN_POINTS,
  brandStatusLabel = "Real demand",
  leftAnnotation = DEFAULT_LEFT_ANNOTATION,
  rightAnnotation = DEFAULT_RIGHT_ANNOTATION,
}: {
  oldCardTitle?: string;
  oldPoints?: DifferencePoint[];
  modernPoints?: DifferencePoint[];
  brandStatusLabel?: string;
  leftAnnotation?: string[];
  rightAnnotation?: string[];
}) {
  return (
    <div className="marketing-difference-stage">
      {/* DOM order matches the stage's 3-column grid (annotation, cards, annotation) —
          grid auto-placement is source-order-based, so this can't be reshuffled freely. */}
      <div className="marketing-difference-annotation is-left" aria-hidden="true">
        <div className="marketing-difference-annotation-text">
          {leftAnnotation.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
        <DifferenceBrace />
      </div>

      <div className="marketing-difference-cards">
        <article className="marketing-difference-old-card">
          <div className="marketing-difference-card-eyebrow">THE OLD WAY</div>
          <h3>{oldCardTitle}</h3>
          <div className="marketing-difference-fake-tool" aria-hidden="true">
            <div className="marketing-difference-fake-list">
              {["", "", "", ""].map((_, index) => (
                <div className="marketing-difference-fake-row" key={index}>
                  <span />
                  <span />
                  <b />
                </div>
              ))}
            </div>
            <div className="marketing-difference-filter"><FilterIcon /></div>
          </div>
          <div className="marketing-difference-old-points">
            {oldPoints.map((point) => (
              <div key={point.title}>
                <span className="marketing-difference-cross" aria-hidden="true">×</span>
                <p><strong>{point.title}</strong><small><ResponsiveText full={point.full} short={point.short} /></small></p>
              </div>
            ))}
          </div>
        </article>

        <article className="marketing-difference-modern-card">
          <div className="marketing-difference-card-eyebrow">THE MODERN WAY</div>
          <div className="marketing-difference-brand-row">
            <div className="marketing-difference-brand">
              <span className="marketing-difference-brand-mark"><LogoMark size={18} /></span>
              <span>wanterest</span>
            </div>
            <span className="marketing-difference-status"><b />{brandStatusLabel}</span>
          </div>
          <div className="marketing-difference-modern-points">
            {modernPoints.map((point) => (
              <div className="marketing-difference-modern-point" key={point.title}>
                <CheckIcon />
                <p><strong>{point.title}</strong><small><ResponsiveText full={point.full} short={point.short} /></small></p>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="marketing-difference-annotation is-right" aria-hidden="true">
        <DifferenceBrace flip />
        <div className="marketing-difference-annotation-text">
          {rightAnnotation.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      </div>

      <div className="marketing-difference-vs" aria-hidden="true">
        <span />
        <b>VS</b>
        <span />
      </div>
    </div>
  );
}

export function DifferenceSection() {
  return (
    <section className="marketing-section marketing-difference-section is-alt">
      <div className="marketing-section-inner marketing-difference-inner">
        <div className="marketing-section-eyebrow">THE DIFFERENCE</div>
        <h2 className="marketing-heading marketing-difference-title">
          <span className="marketing-copy-full">
            Lead finders show you who might fit.
            <br />
            {" "}Wanterest shows you who is showing <br className="marketing-difference-final-break" />need.
          </span>
          <span className="marketing-copy-short">Lead finders show fit. Wanterest shows need.</span>
        </h2>
        <p className="marketing-difference-subtitle">
          <ResponsiveText
            full="Stop guessing who to contact. Start with people already talking about the problem you solve."
            short="Stop guessing who to contact. Start with people already talking about it."
          />
        </p>

        <DifferenceStage />
      </div>
    </section>
  );
}
