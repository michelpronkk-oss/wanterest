import Link from "next/link";

import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getCurrentProductSnapshotQuery } from "@/server/modules/intelligence/commands";
import { getBillingOverviewQuery } from "@/server/modules/billing";
import { getPlanCapabilities } from "@/server/modules/entitlements";
import { getActiveExperimentsQuery } from "@/server/modules/experiments/commands";
import { listWorkspaceMembersQuery } from "@/server/modules/workspaces";
import { initialSourceAvailability } from "@/server/modules/operations/source-control.service";
import { getProductDemandScanSummary } from "@/server/modules/operations/product-demand-scan.service";
import { SettingsTabs } from "@/components/dashboard/settings-tabs";
import { formatDate, sourceLabel } from "@/components/dashboard/dashboard-utils";
import { SourceBrandIcon } from "@/components/ui/source-brand-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { ProductLifecycle } from "@/components/dashboard/product-lifecycle";
import { PlanUsageSummary } from "@/components/dashboard/plan-usage-summary";
import { UpgradeTrigger } from "@/components/dashboard/upgrade-surface";

type BusinessClassification = { business_type?: string; market_scope?: string; primary_category?: string };

export default async function SettingsPage() {
  const { workspace, product, products, archivedProducts } = await getDashboardContext();
  if (!workspace) {
    return <section className="dashboard-page dashboard-state"><p className="dashboard-eyebrow">Settings</p><h1>Create a workspace first</h1><Link className="dashboard-button dashboard-button-primary" href="/app/setup/workspace">Create workspace</Link></section>;
  }

  const [snapshot, billing, members, scanSummary, activeExperiments] = await Promise.all([
    product ? getCurrentProductSnapshotQuery(workspace.id, product.id).catch(() => null) : Promise.resolve(null),
    getBillingOverviewQuery(workspace.id).catch(() => null),
    listWorkspaceMembersQuery(workspace.id).catch(() => []),
    product ? getProductDemandScanSummary(workspace.id, product.id).catch(() => null) : Promise.resolve(null),
    getActiveExperimentsQuery(workspace.id).catch(() => []),
  ]);

  const classification = (snapshot?.metadata as { business_classification?: BusinessClassification } | null)?.business_classification ?? null;
  const currentPlan = billing?.effectivePlan ?? "free";
  const capabilities = getPlanCapabilities(currentPlan, billing?.subscription?.billing_interval === "monthly" || billing?.subscription?.billing_interval === "annual" ? billing.subscription.billing_interval : null);

  const generalSection = (
    <>
      <div className="settings-row"><span className="settings-row-label">Workspace</span><span className="settings-row-value">{workspace.name}</span></div>
      <div className="settings-row"><span className="settings-row-label">Default product</span><span className="settings-row-value">{product?.name ?? "Not set"}</span></div>
      <div className="settings-row"><span className="settings-row-label">Timezone</span><span className="settings-row-value" style={{ color: "var(--color-ink-faint)" }}>Not yet configurable</span></div>
      <div className="settings-row"><span className="settings-row-label">Digest cadence</span><span className="settings-row-value" style={{ color: "var(--color-ink-faint)" }}>Not yet configurable</span></div>
      <div className="settings-row"><span className="settings-row-label">Notifications</span><span className="settings-row-value" style={{ color: "var(--color-ink-faint)" }}>Not yet configurable</span></div>
    </>
  );

  const productSection = (
    <>
      {product ? (
        <>
          <div className="settings-row"><span className="settings-row-label">Product name</span><span className="settings-row-value">{product.name}</span></div>
          <div className="settings-row"><span className="settings-row-label">Domain</span><span className="settings-row-value">{product.website_url ?? "Not set"}</span></div>
          <div className="settings-row"><span className="settings-row-label">Business type</span><span className="settings-row-value">{classification?.business_type?.replaceAll("_", " ") ?? "Available after next scan"}</span></div>
          <div className="settings-row"><span className="settings-row-label">Primary category</span><span className="settings-row-value">{classification?.primary_category ?? "Available after next scan"}</span></div>
          <div className="settings-row"><span className="settings-row-label">Market scope</span><span className="settings-row-value">{classification?.market_scope?.replaceAll("_", " ") ?? "Available after next scan"}</span></div>
          <div className="settings-row">
            <span className="settings-row-label">Product understanding</span>
            <span className={`badge ${snapshot ? "badge-accent" : "badge-neutral"}`}>{snapshot ? "Up to date" : "Not built yet"}</span>
          </div>
          <div className="settings-row"><span className="settings-row-label">Last rebuilt</span><span className="settings-row-value">{snapshot ? formatDate(snapshot.captured_at) : "Never"}</span></div>
          <div className="settings-row">
            <span className="settings-row-label">Domain ownership</span>
            <span className="badge badge-neutral">Coming soon</span>
          </div>
        </>
      ) : (
        <EmptyState title="No active product yet" body="Add a product to start tracking demand. Archived product history remains available below." cta={{ label: "Add product", href: "/app/setup/product?new=1" }} />
      )}
      <ProductLifecycle workspaceId={workspace.id} activeProduct={product} activeProductCount={products.length} maxProducts={capabilities.products.maxProducts} currentPlan={currentPlan} archivedProducts={archivedProducts} />
    </>
  );

  const sourcesSection = (
    <>
      {scanSummary ? (
        <p style={{ fontSize: 12, color: "var(--color-ink-muted)", marginBottom: 12 }}>
          Last scan: {scanSummary.sourcesCompleted} of {scanSummary.sourcesPlanned} sources completed{scanSummary.sourcesFailed > 0 ? `, ${scanSummary.sourcesFailed} unavailable` : ""}.
        </p>
      ) : null}
      {initialSourceAvailability.map((source) => {
        const label = sourceLabel(source.sourceKey);
        const active = source.state === "enabled";
        return (
          <div className="settings-source-row" key={source.sourceKey}>
            <SourceBrandIcon sourceKey={source.sourceKey} size={22} className="settings-source-badge" decorative />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)" }}>
                {source.reason === "credentials_missing" ? "Insufficient credentials to enable" : source.reason === "approval_pending_or_credentials_missing" ? "Pending approval" : source.configured ? "Configured" : "Not configured"}
              </div>
            </div>
            <span className={`badge ${active ? "badge-accent" : "badge-neutral"}`}>{active ? "Active" : source.state === "paused" ? "Paused" : "Unavailable"}</span>
          </div>
        );
      })}
    </>
  );

  const usageByType = new Map((billing?.usage ?? []).map((usage) => [usage.usageType, usage.amount]));
  const planDescription = currentPlan === "free"
    ? "For trying Wanterest and validating demand manually."
    : currentPlan === "pro"
      ? "For founders and small product teams building a continuous view of demand."
      : "For teams tracking multiple products and markets.";
  const included = [
    capabilities.monitoring.enabled ? `Automatic monitoring every ~${capabilities.monitoring.monitoringIntervalMinutes === 120 ? "2 hours" : "6 hours"}` : "Manual demand validation",
    capabilities.history.driftHistoryDays > 0 ? `${capabilities.history.driftHistoryDays}-day Demand Drift history` : "No historical Demand Drift",
    capabilities.geography.regionDrilldown ? "Regional Geo intelligence" : "Country-level Geo snapshot",
    `${capabilities.experiments.maxActiveExperiments} active experiments`,
    `${capabilities.team.seats} seat${capabilities.team.seats === 1 ? "" : "s"}`,
  ];
  const planSection = !billing ? (
    <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>Plan and usage details are unavailable right now.</p>
  ) : (
    <PlanUsageSummary
      workspaceId={workspace.id}
      currentPlan={currentPlan}
      description={planDescription}
      status={billing.subscription?.status ?? "No active subscription"}
      cadence={currentPlan === "free" ? null : billing.subscription?.billing_interval === "annual" ? "annual" : "monthly"}
      price={currentPlan === "pro" ? (billing.subscription?.billing_interval === "annual" ? "$468/year" : "$49/month") : currentPlan === "growth" ? (billing.subscription?.billing_interval === "annual" ? "$948/year" : "$99/month") : null}
      onPaidPlan={currentPlan !== "free"}
      metrics={[
        { label: "Manual scans", used: usageByType.get("manual_scan") ?? 0, limit: capabilities.manual.manualScansPerMonth },
        { label: "Products", used: products.length, limit: capabilities.products.maxProducts },
        { label: "Active experiments", used: activeExperiments.length, limit: capabilities.experiments.maxActiveExperiments },
      ]}
      included={included}
    />
  );

  const teamSection = (
    <>
      {members.filter((member) => member.status === "active").length >= capabilities.team.seats ? (
        <div className="capability-gate" style={{ marginBottom: 14 }}>
          <div className="capability-gate-copy"><span className="capability-gate-kicker">Seat limit reached</span><h2>Invite more teammates on Growth</h2><p>{capabilities.team.seats} seat{capabilities.team.seats === 1 ? "" : "s"} included in {currentPlan === "free" ? "Free" : currentPlan === "pro" ? "Pro" : "Growth"}.</p></div>
          {currentPlan === "growth" ? <Link className="dashboard-button dashboard-button-secondary" href="/app/settings/billing">Manage billing</Link> : <UpgradeTrigger workspaceId={workspace.id} currentPlan={currentPlan} plan="growth" label="Unlock more seats" />}
        </div>
      ) : null}
      {members.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>No members found.</p> : members.map((member) => (
        <div className="settings-row" key={member.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="dashboard-avatar">{(member.email?.[0] ?? "?").toUpperCase()}</span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{member.email ?? member.user_id}</div>
              <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)", textTransform: "capitalize" }}>{member.role}</div>
            </div>
          </div>
          <span className={`badge ${member.status === "active" ? "badge-accent" : "badge-neutral"}`}>{member.status}</span>
        </div>
      ))}
    </>
  );

  return (
    <section className="dashboard-page">
      <header className="dashboard-page-header">
        <p className="dashboard-eyebrow">Settings</p>
        <h1>Settings</h1>
      </header>
      <SettingsTabs sections={{ general: generalSection, product: productSection, sources: sourcesSection, plan: planSection, team: teamSection }} />
    </section>
  );
}
