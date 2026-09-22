"use client";

import { useState } from "react";

import { APP_START_URL } from "./links";

type BillingCycle = "monthly" | "annual";

type Plan = {
  key: string;
  name: string;
  description: string;
  /** 0 for the free plan. */
  monthlyPrice: number;
  /** Total billed once per year; 0 for the free plan. */
  annualPrice: number;
  popular?: boolean;
  icon: "free" | "pro" | "growth";
  /** Keep exact cadence entitlement-driven; the product dashboard shows the workspace's actual schedule. */
  features: string[];
};

const PLANS: Plan[] = [
  {
    key: "free",
    name: "Free",
    description: "Get started and explore.",
    monthlyPrice: 0,
    annualPrice: 0,
    icon: "free",
    features: ["Monitor 1 product", "Manual scans", "Preview Demand Map & Gap"],
  },
  {
    key: "pro",
    name: "Pro",
    description: "For builders and small teams.",
    monthlyPrice: 49,
    annualPrice: 468,
    popular: true,
    icon: "pro",
    features: [
      "Monitor up to 3 products",
      "Automatic monitoring included",
      "30 days of Demand Drift history",
      "2 active experiments",
    ],
  },
  {
    key: "growth",
    name: "Growth",
    description: "For growing brands and teams.",
    monthlyPrice: 99,
    annualPrice: 948,
    icon: "growth",
    features: [
      "Monitor up to 10 products",
      "Priority automatic monitoring",
      "90 days of Demand Drift history",
      "10 active experiments · 3 seats",
    ],
  },
];

function annualSavingsPercent(plan: Plan): number {
  if (plan.monthlyPrice <= 0) return 0;
  return Math.round((1 - plan.annualPrice / (plan.monthlyPrice * 12)) * 100);
}

// Both paid plans currently land on the same rounded savings rate; shown once on the toggle itself.
const HEADLINE_SAVINGS_PERCENT = annualSavingsPercent(PLANS.find((plan) => plan.key === "pro")!);

function PlanIcon({ type }: { type: Plan["icon"] }) {
  if (type === "pro") {
    return (
      <svg width="29" height="29" viewBox="0 0 30 30" fill="none" aria-hidden="true">
        <path d="m17.2 3.5-9 12.1h6.4l-1.8 10.9 9-12.2h-6.2l1.6-10.8Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    );
  }

  if (type === "growth") {
    return (
      <svg width="29" height="29" viewBox="0 0 30 30" fill="none" aria-hidden="true">
        <path d="M6 24V15M12 24V10M18 24V6M24 24V2" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width="29" height="29" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <path d="m15 3.5 10.2 5.8v11.4L15 26.5 4.8 20.7V9.3L15 3.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="m5.4 9.7 9.6 5.5 9.6-5.5M15 15.2v10.7" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
    </svg>
  );
}

function FeatureCheck() {
  return (
    <span className="marketing-price-feature-check" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="m2.2 6.2 2.2 2.2 5.3-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function TrustIcon({ type }: { type: "shield" | "change" | "teams" }) {
  if (type === "shield") {
    return <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.5 16 5v4.4c0 3.7-2.2 6.5-6 8.1-3.8-1.6-6-4.4-6-8.1V5l6-2.5Z" stroke="currentColor" strokeWidth="1.4" /></svg>;
  }
  if (type === "change") {
    return <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 14.5V9M8 14.5V5.5M12 14.5V8M16 14.5V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  }
  return <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.4" /><circle cx="14" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" /><path d="M2.8 16c.3-2.4 1.8-3.8 4.2-3.8s3.9 1.4 4.2 3.8M11.5 13c2.5-.7 4.9.3 5.7 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

export function PricingSection() {
  const [billing, setBilling] = useState<BillingCycle>("monthly");
  const isAnnual = billing === "annual";

  return (
    <section className="marketing-section marketing-pricing-section is-tight is-alt" id="pricing">
      <div className="marketing-section-inner marketing-pricing-inner">
        <div className="marketing-section-eyebrow">PRICING</div>
        <h2 className="marketing-heading marketing-section-title marketing-pricing-title">Simple pricing.</h2>
        <p className="marketing-pricing-subtitle">Everything you need to spot what&rsquo;s next.</p>

        <div className="marketing-pricing-toggle-row">
          <div className="marketing-pricing-toggle">
            <button type="button" className={`marketing-pricing-toggle-btn${isAnnual ? "" : " is-active"}`} onClick={() => setBilling("monthly")}>
              Monthly
            </button>
            <button type="button" className={`marketing-pricing-toggle-btn${isAnnual ? " is-active" : ""}`} onClick={() => setBilling("annual")}>
              Annual
              <span className="marketing-pricing-save-chip">Save {HEADLINE_SAVINGS_PERCENT}%</span>
            </button>
          </div>
        </div>

        <div className="marketing-pricing-grid">
          {PLANS.map((plan) => {
            const isFree = plan.monthlyPrice <= 0;
            const displayPrice = isAnnual && !isFree ? plan.annualPrice : plan.monthlyPrice;
            const showAnnualNote = isAnnual && !isFree;

            return (
              <div className={`marketing-price-card${plan.popular ? " is-popular" : ""}`} key={plan.key}>
                {plan.popular ? <span className="marketing-price-badge">Popular</span> : null}
                <div className="marketing-price-head">
                  <div className={`marketing-price-icon is-${plan.icon}`}><PlanIcon type={plan.icon} /></div>
                  <div>
                    <div className="marketing-price-name">{plan.name}</div>
                    <div className="marketing-price-description">{plan.description}</div>
                  </div>
                </div>
                <div className="marketing-price-value">
                  ${displayPrice}
                  {!isFree ? <span> / {isAnnual ? "year" : "month"}</span> : null}
                </div>
                <div className="marketing-price-annual-note" style={{ visibility: showAnnualNote ? "visible" : "hidden" }}>
                  Billed ${plan.annualPrice} annually · save {annualSavingsPercent(plan)}%
                </div>
                <div className="marketing-price-features">
                  {plan.features.map((feature) => (
                    <div key={feature}><FeatureCheck />{feature}</div>
                  ))}
                </div>
                <a className={`marketing-price-cta ${plan.popular ? "is-primary" : "is-secondary"}`} href={APP_START_URL}>
                  Start free
                </a>
              </div>
            );
          })}
        </div>
        <div className="marketing-pricing-trust-row">
          <div><TrustIcon type="shield" /><span>No credit card required</span></div>
          <i aria-hidden="true" />
          <div><TrustIcon type="change" /><span>Upgrade or downgrade anytime</span></div>
          <i aria-hidden="true" />
          <div><TrustIcon type="teams" /><span>Built for growing teams</span></div>
        </div>
      </div>
    </section>
  );
}
