"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type UpgradePlan = "free" | "pro" | "growth";
export type UpgradeCadence = "monthly" | "annual";

type UpgradeSurfaceProps = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  currentPlan: UpgradePlan;
  defaultPlan?: "pro" | "growth";
};

type UpgradeTriggerProps = {
  workspaceId: string;
  currentPlan: UpgradePlan;
  label?: string;
  plan?: "pro" | "growth";
  className?: string;
  variant?: "primary" | "secondary" | "quiet";
};

const PLAN_FEATURES: Record<"pro" | "growth", string[]> = {
  pro: [
    "3 products",
    "Automatic monitoring every ~6 hours",
    "30 manual scans / month",
    "30-day Demand Drift history",
    "2 active experiments",
    "Regional Geo intelligence",
    "1 seat",
  ],
  growth: [
    "10 products",
    "Automatic monitoring every ~2 hours",
    "100 manual scans / month",
    "90-day Demand Drift history",
    "10 active experiments",
    "3 seats",
    "Broader monitoring budgets",
  ],
};

const PLAN_DETAILS = {
  pro: { name: "Pro", monthly: 49, annual: 468, goodFor: "Founders and small product teams" },
  growth: { name: "Growth", monthly: 99, annual: 948, goodFor: "Teams tracking multiple products and markets" },
} as const;

function displayPrice(plan: "pro" | "growth", cadence: UpgradeCadence): string {
  const value = PLAN_DETAILS[plan][cadence];
  return `$${value}/${cadence === "monthly" ? "month" : "year"}`;
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = body.error;
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

export function UpgradeModal({ open, onClose, workspaceId, currentPlan, defaultPlan = "pro" }: UpgradeSurfaceProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [cadence, setCadence] = useState<UpgradeCadence>("monthly");
  const [selectedPlan, setSelectedPlan] = useState<"pro" | "growth">(defaultPlan);
  const [busy, setBusy] = useState<"pro" | "growth" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = dialogRef.current?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    focusable?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? []).filter((node) => !node.hasAttribute("disabled"));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  async function startPlan(plan: "pro" | "growth") {
    setSelectedPlan(plan);
    setError(null);
    if (currentPlan !== "free") {
      setBusy("portal");
      try {
        const response = await fetch("/api/billing/portal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId }),
        });
        const body = await response.json() as unknown;
        if (!response.ok || !body || typeof body !== "object" || !("portalUrl" in body) || typeof body.portalUrl !== "string") throw new Error(errorMessage(body, "The billing portal is not available yet."));
        window.location.assign(body.portalUrl);
      } catch (value) {
        setError(value instanceof Error ? value.message : "The billing portal is not available yet.");
        setBusy(null);
      }
      return;
    }

    setBusy(plan);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, cadence, idempotencyKey: crypto.randomUUID() }),
      });
      const body = await response.json() as unknown;
      if (!response.ok || !body || typeof body !== "object" || !("checkoutUrl" in body) || typeof body.checkoutUrl !== "string") throw new Error(errorMessage(body, "Checkout could not be started."));
      window.location.assign(body.checkoutUrl);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Checkout could not be started.");
      setBusy(null);
    }
  }

  return (
    <div className="upgrade-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="upgrade-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="upgrade-dialog-header">
          <div>
            <p className="dashboard-eyebrow">Wanterest access</p>
            <h2 id={titleId}>Upgrade Wanterest</h2>
            <p>Unlock continuous demand intelligence, deeper history, and more products.</p>
          </div>
          <button className="upgrade-close" type="button" onClick={onClose} aria-label="Close upgrade dialog">×</button>
        </div>

        <div className="upgrade-cadence" role="group" aria-label="Billing cadence">
          {(["monthly", "annual"] as const).map((value) => (
            <button key={value} type="button" className={cadence === value ? "is-active" : ""} aria-pressed={cadence === value} onClick={() => setCadence(value)}>
              {value === "monthly" ? "Monthly" : "Annual"}
              {value === "annual" ? <span>Save 20%</span> : null}
            </button>
          ))}
        </div>

        <div className="upgrade-plan-grid">
          {(["pro", "growth"] as const).map((plan) => {
            const isCurrent = currentPlan === plan;
            const isGrowthEmphasis = plan === "growth";
            return (
              <article className={`upgrade-plan-card${selectedPlan === plan ? " is-selected" : ""}${isGrowthEmphasis ? " is-growth" : ""}`} key={plan}>
                <div className="upgrade-plan-card-topline"><span className="badge badge-neutral">{PLAN_DETAILS[plan].name}</span>{isCurrent ? <span className="badge badge-accent">Current plan</span> : null}</div>
                <div className="upgrade-plan-price">{displayPrice(plan, cadence)}</div>
                {cadence === "annual" ? <div className="upgrade-plan-monthly-equivalent">${Math.round(PLAN_DETAILS[plan].annual / 12)}/month equivalent</div> : <div className="upgrade-plan-monthly-equivalent">Billed monthly</div>}
                <p className="upgrade-plan-good-for">{PLAN_DETAILS[plan].goodFor}</p>
                <ul>{PLAN_FEATURES[plan].map((feature) => <li key={feature}>{feature}</li>)}</ul>
                {isCurrent ? <button className="dashboard-button dashboard-button-secondary" type="button" disabled>Current plan</button> : (
                  <button className={`dashboard-button ${isGrowthEmphasis ? "dashboard-button-accent" : "dashboard-button-primary"}`} type="button" onClick={() => void startPlan(plan)} disabled={busy !== null}>
                    {busy === plan ? "Preparing checkout…" : currentPlan === "free" ? `Upgrade to ${PLAN_DETAILS[plan].name}` : "Manage subscription"}
                  </button>
                )}
              </article>
            );
          })}
        </div>
        {currentPlan === "growth" ? <p className="upgrade-current-note">You’re already on the highest V1 plan. Manage your subscription from Billing.</p> : null}
        {error ? <p className="upgrade-error" role="alert">{error}</p> : null}
        <p className="upgrade-dialog-note">Your plan changes only after Wanterest receives and verifies the billing provider webhook.</p>
      </div>
    </div>
  );
}

export function UpgradeTrigger({ workspaceId, currentPlan, label = "Upgrade plan", plan = "pro", className, variant = "primary" }: UpgradeTriggerProps) {
  const [open, setOpen] = useState(false);
  const buttonClass = className ?? `dashboard-button dashboard-button-${variant}`;
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>{label}</button>
      <UpgradeModal key={open ? `${plan}-open` : "closed"} open={open} onClose={() => setOpen(false)} workspaceId={workspaceId} currentPlan={currentPlan} defaultPlan={plan} />
    </>
  );
}

export function CapabilityGate({ workspaceId, currentPlan, enabled, title, body, children, requiredPlan = "pro", current, limit }: {
  workspaceId: string;
  currentPlan: UpgradePlan;
  enabled: boolean;
  title: string;
  body: string;
  children?: ReactNode;
  requiredPlan?: "pro" | "growth";
  current?: number;
  limit?: number;
}) {
  if (enabled) return <>{children}</>;
  const message = current !== undefined && limit !== undefined ? `${body} ${current} of ${limit} used.` : body;
  return (
    <div className="capability-gate" role="region" aria-label={title}>
      <div className="capability-gate-copy"><span className="capability-gate-kicker">Available on {requiredPlan === "growth" ? "Growth" : "Pro"}</span><h2>{title}</h2><p>{message}</p></div>
      <UpgradeTrigger workspaceId={workspaceId} currentPlan={currentPlan} plan={requiredPlan} label={requiredPlan === "growth" ? "Upgrade to Growth" : "Upgrade to Pro"} />
    </div>
  );
}
