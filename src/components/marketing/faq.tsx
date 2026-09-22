"use client";

import { useState } from "react";

const FAQ_ITEMS = [
  {
    q: "Which sources does Wanterest scan?",
    a: "Reddit, Hacker News, and Bluesky today, with LinkedIn and more forums rolling out. All sources pull only from public, already-visible conversations.",
  },
  {
    q: "Is this just social listening with a new name?",
    a: "No. Social listening tracks mentions of your brand. Wanterest finds public conversations describing the problem you solve, then ranks their buying intent.",
  },
  {
    q: "How is data collected, and is it compliant?",
    a: "We read public posts only. Nothing private, gated, or behind a login.",
  },
  {
    q: "How accurate is the match score?",
    a: 'Matches are scored against your product and audience, not generic keywords. Each score includes a visible "Why it matters" explanation.',
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel anytime from Settings, with no calls or emails required.",
  },
];

function ChevronIcon() {
  return (
    <svg className="marketing-faq-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Answers stay expanded on desktop; below 640px this becomes a tap-to-expand accordion (see globals.css). */
export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="marketing-section is-tight">
      <div className="marketing-section-inner marketing-section-readable">
        <div className="marketing-section-eyebrow">QUESTIONS</div>
        <h2 className="marketing-heading marketing-section-title marketing-section-title-compact is-content">Before you start.</h2>
        <div className="marketing-faq-list">
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <div className={`marketing-faq-item${isOpen ? " is-open" : ""}`} key={item.q}>
                <button
                  type="button"
                  className="marketing-faq-question"
                  aria-expanded={isOpen}
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                >
                  <span>{item.q}</span>
                  <ChevronIcon />
                </button>
                <div className="marketing-faq-answer-wrap">
                  <div>
                    <div className="marketing-faq-answer">{item.a}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
