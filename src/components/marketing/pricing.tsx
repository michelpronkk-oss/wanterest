"use client";

import { useState } from "react";

import { APP_SIGNUP_URL } from "./links";

type BillingCycle = "monthly" | "annual";

type Plan = {
  key: string;
  name: string;
  /** 0 for the free plan. */
  monthlyPrice: number;
  /** Total billed once per year; 0 for the free plan. */
  annualPrice: number;
  popular?: boolean;
  /**
   * Kept plan-neutral on cadence: Automatic Monitoring v1 is still being built and its
   * entitlement values aren't final, so these bullets avoid promising an exact scan
   * frequency. Update once that work ships and is verified.
   */
  features: string[];
};

const PLANS: Plan[] = [
  {
    key: "free",
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    features: ["Monitor 1 product", "Manual scans", "Preview Demand Map & Gap"],
  },
  {
    key: "pro",
    name: "Pro",
    monthlyPrice: 49,
    annualPrice: 468,
    popular: true,
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
    monthlyPrice: 99,
    annualPrice: 948,
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

export function PricingSection() {
  const [billing, setBilling] = useState<BillingCycle>("monthly");
  const isAnnual = billing === "annual";

  return (
    <section className="marketing-section is-tight" id="pricing">
      <div className="marketing-section-inner">
        <div className="marketing-section-eyebrow">PRICING</div>
        <h2 className="marketing-heading marketing-section-title" style={{ marginBottom: 24 }}>Simple pricing.</h2>

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
            const displayPrice = isAnnual && !isFree ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice;
            const showAnnualNote = isAnnual && !isFree;

            return (
              <div className={`marketing-price-card${plan.popular ? " is-popular" : ""}`} key={plan.key}>
                {plan.popular ? <span className="marketing-price-badge">Popular</span> : null}
                <div className="marketing-price-name">{plan.name}</div>
                <div className="marketing-price-value">
                  {isFree ? "$0" : (
                    <>
                      ${displayPrice}
                      <span> / month</span>
                    </>
                  )}
                </div>
                <div className="marketing-price-annual-note" style={{ visibility: showAnnualNote ? "visible" : "hidden" }}>
                  Billed ${plan.annualPrice} annually · save {annualSavingsPercent(plan)}%
                </div>
                <div className="marketing-price-features">
                  {plan.features.map((feature) => (
                    <div key={feature}>{feature}</div>
                  ))}
                </div>
                <a className={`marketing-price-cta ${plan.popular ? "is-primary" : "is-secondary"}`} href={APP_SIGNUP_URL}>
                  Start free
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
