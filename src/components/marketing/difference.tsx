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

const MODERN_POINTS = [
  { title: "Real conversations", full: "People discussing your problem in the wild.", short: "People discussing your problem." },
  { title: "Visible pain", full: "See what they are struggling with.", short: "See what they are struggling with." },
  { title: "Active intent", full: "Find buyers before they reach out to competitors.", short: "Find buyers before competitors do." },
  { title: "Context and timing", full: "Understand the why, not just the who.", short: "Understand the why, not just the who." },
] as const;

export function DifferenceSection() {
  return (
    <section className="marketing-section marketing-difference-section is-alt">
      <div className="marketing-section-inner marketing-difference-inner">
        <div className="marketing-section-eyebrow">THE DIFFERENCE</div>
        <h2 className="marketing-heading marketing-difference-title">
          Lead finders show you who might fit.
          <br />
          {" "}Wanterest shows you who is showing <br className="marketing-difference-final-break" />need.
        </h2>
        <p className="marketing-difference-subtitle">
          <ResponsiveText
            full="Stop guessing who to contact. Start with people already talking about the problem you solve."
            short="Stop guessing who to contact. Start with people already talking about it."
          />
        </p>

        <div className="marketing-difference-stage">
          <div className="marketing-difference-annotation is-left" aria-hidden="true">
            <span>Lots of data.</span>
            <span>Not enough signal.</span>
            <i />
          </div>
          <div className="marketing-difference-annotation is-right" aria-hidden="true">
            <span>Real people.</span>
            <span>Real problems.</span>
            <span>Real opportunities.</span>
            <i />
          </div>

          <div className="marketing-difference-cards">
            <article className="marketing-difference-old-card">
              <div className="marketing-difference-card-eyebrow">THE OLD WAY</div>
              <h3>Lead finder</h3>
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
                <div>
                  <span className="marketing-difference-cross" aria-hidden="true">×</span>
                  <p><strong>Company filters</strong><small>Find companies that match your ICP.</small></p>
                </div>
                <div>
                  <span className="marketing-difference-cross" aria-hidden="true">×</span>
                  <p><strong>Contact lists</strong><small>Get names and email addresses.</small></p>
                </div>
                <div>
                  <span className="marketing-difference-cross" aria-hidden="true">×</span>
                  <p><strong>Cold outreach</strong><small>Hope your message gets a response.</small></p>
                </div>
              </div>
            </article>

            <article className="marketing-difference-modern-card">
              <div className="marketing-difference-card-eyebrow">THE MODERN WAY</div>
              <div className="marketing-difference-brand-row">
                <div className="marketing-difference-brand">
                  <span className="marketing-difference-brand-mark"><LogoMark size={18} /></span>
                  <span>wanterest</span>
                </div>
                <span className="marketing-difference-status"><b />Real demand</span>
              </div>
              <div className="marketing-difference-modern-points">
                {MODERN_POINTS.map((point) => (
                  <div className="marketing-difference-modern-point" key={point.title}>
                    <CheckIcon />
                    <p><strong>{point.title}</strong><small><ResponsiveText full={point.full} short={point.short} /></small></p>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <div className="marketing-difference-vs" aria-hidden="true">
            <span />
            <b>VS</b>
            <span />
          </div>
        </div>
      </div>
    </section>
  );
}
