import type { Metadata } from "next";

import { ContactForm } from "@/components/marketing/contact-form";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";

const TITLE = "Contact Wanterest";
const DESCRIPTION = "Contact Wanterest for product questions, support, billing assistance, or general enquiries.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/contact" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/contact" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

const TOPICS = ["Product questions", "Support & workspace issues", "Billing & partnerships"];

export default function ContactPage() {
  return (
    <MarketingPageShell activeHref="/contact">
      <main>
        {/* Hero */}
        <section className="marketing-content-wrap marketing-content-split marketing-contact-hero">
          <div className="marketing-contact-hero-copy">
            <div className="marketing-content-eyebrow">
              <span className="marketing-content-eyebrow-dot" />
              CONTACT
            </div>
            <h1 className="marketing-contact-hero-title">Talk to Wanterest.</h1>
            <p className="marketing-contact-hero-body">Questions about the product, billing, or your workspace? Get in touch.</p>
            <ul className="marketing-contact-topics">
              {TOPICS.map((topic) => (
                <li className="marketing-contact-topic" key={topic}>
                  <span className="marketing-contact-topic-dot" aria-hidden="true" />
                  {topic}
                </li>
              ))}
            </ul>
          </div>

          <div className="marketing-contact-card">
            <ContactForm />
          </div>
        </section>

        {/* Secondary */}
        <section className="marketing-content-wrap marketing-contact-secondary">
          Not sure where your question fits? Send it anyway.
        </section>
      </main>
    </MarketingPageShell>
  );
}
