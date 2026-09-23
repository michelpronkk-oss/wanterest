import Link from "next/link";

import { UpgradeTrigger, type UpgradePlan } from "./upgrade-surface";

type UsageMetric = { label: string; used: number; limit: number };

export function PlanUsageSummary({ workspaceId, currentPlan, description, metrics, included, status, onPaidPlan, cadence, price }: {
  workspaceId: string;
  currentPlan: UpgradePlan;
  description: string;
  metrics: UsageMetric[];
  included: string[];
  status: string;
  onPaidPlan: boolean;
  cadence?: "monthly" | "annual" | null;
  price?: string | null;
}) {
  return (
    <div className="plan-summary-grid">
      <article className="plan-summary-card is-current">
        <div className="ui-section-label">Current plan</div>
        <h2>{currentPlan}</h2>
        <p>{description}</p>
        <div className="plan-summary-details">
          <div className="plan-summary-detail"><span>Status</span><strong>{status}</strong></div>
          {onPaidPlan ? <><div className="plan-summary-detail"><span>Billing cadence</span><strong>{cadence ?? "—"}</strong></div><div className="plan-summary-detail"><span>Price</span><strong>{price ?? "—"}</strong></div></> : null}
          <div className="plan-summary-detail"><span>Plan access</span><strong>{onPaidPlan ? "Continuous intelligence" : "Manual demand validation"}</strong></div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}>
          {onPaidPlan ? <Link className="dashboard-button dashboard-button-primary" href="/app/settings/billing">Manage billing</Link> : <UpgradeTrigger workspaceId={workspaceId} currentPlan={currentPlan} label="Upgrade plan" />}
          {currentPlan === "pro" ? <UpgradeTrigger workspaceId={workspaceId} currentPlan={currentPlan} plan="growth" label="Upgrade to Growth" variant="secondary" /> : null}
          <Link className="dashboard-button dashboard-button-secondary" href="/app/settings/billing">View billing</Link>
        </div>
      </article>

      <aside className="plan-summary-card">
        <div className="ui-section-label">Usage this month</div>
        <div className="plan-summary-usage">
          {metrics.map((metric) => {
            const percent = metric.limit > 0 ? Math.min(100, Math.round((metric.used / metric.limit) * 100)) : 0;
            return <div className="plan-summary-usage-row" key={metric.label}><div className="plan-summary-usage-head"><span>{metric.label}</span><strong>{metric.used} / {metric.limit}</strong></div><div className="plan-summary-usage-track" aria-label={`${metric.label}: ${metric.used} of ${metric.limit}`}><span style={{ width: `${percent}%` }} /></div></div>;
          })}
        </div>
        <div style={{ marginTop: 22 }}>
          <div className="ui-section-label">Included</div>
          <ul style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none", color: "var(--color-ink-secondary)", fontSize: 12.5, lineHeight: 1.4 }}>
            {included.map((item) => <li key={item}>✓ {item}</li>)}
          </ul>
        </div>
      </aside>
    </div>
  );
}
