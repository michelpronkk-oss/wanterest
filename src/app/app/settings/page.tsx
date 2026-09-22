import Link from "next/link";

import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getCurrentProductSnapshotQuery } from "@/server/modules/intelligence/commands";
import { getBillingOverviewQuery } from "@/server/modules/billing";
import { listWorkspaceMembersQuery } from "@/server/modules/workspaces";
import { initialSourceAvailability } from "@/server/modules/operations/source-control.service";
import { getProductDemandScanSummary } from "@/server/modules/operations/product-demand-scan.service";
import { SettingsTabs } from "@/components/dashboard/settings-tabs";
import { formatDate, sourceLabel } from "@/components/dashboard/dashboard-utils";
import { SourceBrandIcon } from "@/components/ui/source-brand-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { ProductLifecycle } from "@/components/dashboard/product-lifecycle";

type BusinessClassification = { business_type?: string; market_scope?: string; primary_category?: string };

export default async function SettingsPage() {
  const { workspace, product, archivedProducts } = await getDashboardContext();
  if (!workspace) {
    return <section className="dashboard-page dashboard-state"><p className="dashboard-eyebrow">Settings</p><h1>Create a workspace first</h1><Link className="dashboard-button dashboard-button-primary" href="/app/setup/workspace">Create workspace</Link></section>;
  }

  const [snapshot, billing, members, scanSummary] = await Promise.all([
    product ? getCurrentProductSnapshotQuery(workspace.id, product.id).catch(() => null) : Promise.resolve(null),
    getBillingOverviewQuery(workspace.id).catch(() => null),
    listWorkspaceMembersQuery(workspace.id).catch(() => []),
    product ? getProductDemandScanSummary(workspace.id, product.id).catch(() => null) : Promise.resolve(null),
  ]);

  const classification = (snapshot?.metadata as { business_classification?: BusinessClassification } | null)?.business_classification ?? null;

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
      <ProductLifecycle workspaceId={workspace.id} activeProduct={product} archivedProducts={archivedProducts} />
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

  const planSection = !billing ? (
    <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>Plan and usage details are unavailable right now.</p>
  ) : (
    <>
      <div className="ui-card ui-card-pad-lg" style={{ marginBottom: 16, border: "1.5px solid var(--color-ink)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, textTransform: "capitalize" }}>{billing.effectivePlan} plan</div>
        <div style={{ fontSize: 12.5, color: "var(--color-ink-muted)" }}>{billing.subscription?.status ?? "No active subscription"}</div>
      </div>
      {billing.usage.map((usage) => (
        <div className="settings-usage-row" key={usage.usageType}>
          <div className="settings-row-label">{usage.usageType.replaceAll("_", " ")}</div>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{usage.amount}</div>
        </div>
      ))}
      {billing.usage.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>No usage recorded yet this period.</p> : null}
    </>
  );

  const teamSection = (
    <>
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
