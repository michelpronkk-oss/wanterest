import Link from "next/link";

import { BillingActions } from "@/components/dashboard/billing-actions";
import { BillingCheckoutStatus } from "@/components/dashboard/billing-checkout-status";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getBillingOverviewQuery } from "@/server/modules/billing";
import { getPlanCapabilities } from "@/server/modules/entitlements";

const prices = {
  pro: { monthly: "$49/month", annual: "$468/year" },
  growth: { monthly: "$99/month", annual: "$948/year" },
} as const;

function displayDate(value: string | null | undefined): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

function displayStatus(status: string | null | undefined, end: string | null | undefined): string {
  if (status === "canceling") return `Ends on ${displayDate(end)}`;
  if (status === "past_due") return "Payment needs attention";
  if (status === "canceled" || status === "expired") return "Ended";
  if (status === "trialing") return "Trialing";
  if (status === "active") return "Active";
  return "No active subscription";
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

export default async function BillingSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { workspace } = await getDashboardContext();
  if (!workspace) {
    return <section className="dashboard-page dashboard-state"><p className="dashboard-eyebrow">Billing</p><h1>Create a workspace first</h1><Link className="dashboard-button dashboard-button-primary" href="/app/setup/workspace">Create workspace</Link></section>;
  }

  const billing = await getBillingOverviewQuery(workspace.id).catch(() => null);
  const plan = billing?.effectivePlan ?? "free";
  const subscription = billing?.subscription;
  const cadence = subscription?.billing_interval === "annual" ? "annual" : "monthly";
  const price = plan === "pro" || plan === "growth" ? prices[plan][cadence] : "No active subscription";
  const capabilities = getPlanCapabilities(plan, subscription?.billing_interval === "monthly" || subscription?.billing_interval === "annual" ? subscription.billing_interval : null);
  const query = await searchParams;
  const checkoutState = first(query.checkout);

  return (
    <section className="dashboard-page">
      <header className="dashboard-page-header">
        <p className="dashboard-eyebrow">Settings / Billing</p>
        <h1>Billing</h1>
        <p style={{ color: "var(--color-ink-muted)", fontSize: 13 }}>Billing state is confirmed by Dodo webhooks and stays separate from feature entitlements.</p>
      </header>
      <BillingCheckoutStatus workspaceId={workspace.id} initialPlan={plan} state={checkoutState} />
      {subscription?.status === "past_due" || subscription?.payment_failure_state ? <div className="billing-warning" role="status">There’s an issue with your payment method. Manage subscription below.</div> : null}
      <div className="ui-card ui-card-pad-lg" style={{ maxWidth: 620, border: "1.5px solid var(--color-ink)" }}>
        <div className="settings-row"><span className="settings-row-label">Current plan</span><span className="settings-row-value" style={{ textTransform: "capitalize" }}>{plan}</span></div>
        <div className="settings-row"><span className="settings-row-label">Billing cadence</span><span className="settings-row-value" style={{ textTransform: "capitalize" }}>{plan === "free" ? "—" : cadence}</span></div>
        <div className="settings-row"><span className="settings-row-label">Price</span><span className="settings-row-value">{price}</span></div>
        <div className="settings-row"><span className="settings-row-label">Status</span><span className="settings-row-value">{displayStatus(subscription?.status, subscription?.current_period_end)}</span></div>
        <div className="settings-row"><span className="settings-row-label">Next renewal</span><span className="settings-row-value">{subscription?.cancel_at_period_end ? `Ends on ${displayDate(subscription.current_period_end)}` : displayDate(subscription?.current_period_end)}</span></div>
        <div style={{ marginTop: 20 }}><BillingActions workspaceId={workspace.id} currentPlan={plan} /></div>
      </div>
      <div className="ui-card ui-card-pad-lg" style={{ maxWidth: 620, marginTop: 16 }}>
        <div className="ui-section-label">Included in your plan</div>
        <div className="settings-row"><span className="settings-row-label">Products</span><span className="settings-row-value">{capabilities.products.maxProducts}</span></div>
        <div className="settings-row"><span className="settings-row-label">Monitoring</span><span className="settings-row-value">{capabilities.monitoring.enabled ? `Every ~${capabilities.monitoring.monitoringIntervalMinutes === 120 ? "2 hours" : "6 hours"}` : "Manual refreshes only"}</span></div>
        <div className="settings-row"><span className="settings-row-label">Demand Drift history</span><span className="settings-row-value">{capabilities.history.driftHistoryDays ? `${capabilities.history.driftHistoryDays} days` : "Not included"}</span></div>
        <div className="settings-row"><span className="settings-row-label">Seats</span><span className="settings-row-value">{capabilities.team.seats}</span></div>
      </div>
      <p style={{ marginTop: 16, fontSize: 12, color: "var(--color-ink-muted)" }}><Link href="/app/settings">Back to settings</Link></p>
    </section>
  );
}
