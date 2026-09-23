import Link from "next/link";

import { BillingActions } from "@/components/dashboard/billing-actions";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getBillingOverviewQuery } from "@/server/modules/billing";

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

export default async function BillingSettingsPage() {
  const { workspace } = await getDashboardContext();
  if (!workspace) {
    return <section className="dashboard-page dashboard-state"><p className="dashboard-eyebrow">Billing</p><h1>Create a workspace first</h1><Link className="dashboard-button dashboard-button-primary" href="/app/setup/workspace">Create workspace</Link></section>;
  }

  const billing = await getBillingOverviewQuery(workspace.id).catch(() => null);
  const plan = billing?.effectivePlan ?? "free";
  const subscription = billing?.subscription;
  const cadence = subscription?.billing_interval === "annual" ? "annual" : "monthly";
  const price = plan === "pro" || plan === "growth" ? prices[plan][cadence] : "No active subscription";

  return (
    <section className="dashboard-page">
      <header className="dashboard-page-header">
        <p className="dashboard-eyebrow">Settings / Billing</p>
        <h1>Billing</h1>
        <p style={{ color: "var(--color-ink-muted)", fontSize: 13 }}>Billing state is confirmed by Dodo webhooks and stays separate from feature entitlements.</p>
      </header>
      <div className="ui-card ui-card-pad-lg" style={{ maxWidth: 620, border: "1.5px solid var(--color-ink)" }}>
        <div className="settings-row"><span className="settings-row-label">Current plan</span><span className="settings-row-value" style={{ textTransform: "capitalize" }}>{plan}</span></div>
        <div className="settings-row"><span className="settings-row-label">Billing cadence</span><span className="settings-row-value" style={{ textTransform: "capitalize" }}>{plan === "free" ? "—" : cadence}</span></div>
        <div className="settings-row"><span className="settings-row-label">Price</span><span className="settings-row-value">{price}</span></div>
        <div className="settings-row"><span className="settings-row-label">Status</span><span className="settings-row-value">{displayStatus(subscription?.status, subscription?.current_period_end)}</span></div>
        <div className="settings-row"><span className="settings-row-label">Next renewal</span><span className="settings-row-value">{subscription?.cancel_at_period_end ? `Ends on ${displayDate(subscription.current_period_end)}` : displayDate(subscription?.current_period_end)}</span></div>
        <div style={{ marginTop: 20 }}><BillingActions workspaceId={workspace.id} paid={plan !== "free"} /></div>
      </div>
      <p style={{ marginTop: 16, fontSize: 12, color: "var(--color-ink-muted)" }}><Link href="/app/settings">Back to settings</Link></p>
    </section>
  );
}
