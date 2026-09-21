import Link from "next/link";

import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { listActionsQuery } from "@/server/modules/actions/commands";
import { ZeroState } from "@/components/ui/zero-state";
import { ActionList } from "@/components/dashboard/action-list";
import { ActionGhostPreview } from "@/components/dashboard/action-ghost-preview";
import { isWithinLastDays } from "@/components/dashboard/dashboard-utils";
import { getProductScanState } from "@/components/dashboard/scan-state";
import { ScanStatusBanner } from "@/components/dashboard/scan-status-banner";
import { scanResultEmptyBody } from "@/components/dashboard/scan-status.view-model";

export default async function ActionsPage() {
  const { workspace, product } = await getDashboardContext();
  if (!workspace) {
    return <section className="dashboard-page dashboard-state"><p className="dashboard-eyebrow">Actions</p><h1>Create a workspace first</h1><Link className="dashboard-button dashboard-button-primary" href="/app/setup/workspace">Create workspace</Link></section>;
  }
  if (!product) {
    return (
      <section className="dashboard-page">
        <ZeroState
          eyebrow="Actions"
          title="Turn market evidence into the next move."
          body="Wanterest turns qualified demand, gaps, and market movement into evidence-backed recommendations for positioning, product, GTM, content, onboarding, and more."
          primaryCta={{ label: "Add product", href: "/app/setup/product" }}
        />
        <div style={{ marginTop: 32, maxWidth: 520 }}>
          <p className="ui-section-label">What an action looks like</p>
          <ActionGhostPreview />
        </div>
      </section>
    );
  }

  const actions = await listActionsQuery(workspace.id, product.id, { stale: false });
  const highCount = actions.filter((item) => item.action.priority_score >= 0.66).length;
  const readyToTestCount = actions.filter((item) => item.action.status === "approved").length;
  const newThisWeek = actions.filter((item) => isWithinLastDays(item.action.created_at, 7)).length;
  const scanState = actions.length === 0 ? await getProductScanState(workspace.id, product.id, false) : null;

  return (
    <section className="dashboard-page">
      <header className="dashboard-page-header">
        <p className="dashboard-eyebrow">Actions</p>
        <h1>Actions</h1>
        <p className="dashboard-subtitle">Evidence-backed moves based on what your market is asking for.</p>
      </header>

      {scanState ? <ScanStatusBanner state={scanState} workspaceId={workspace.id} productId={product.id} /> : null}

      {actions.length > 0 ? (
        <div className="actions-summary">
          <div className="actions-summary-item"><strong>{highCount}</strong><span>High priority</span></div>
          <div className="actions-summary-item"><strong>{readyToTestCount}</strong><span>Ready to test</span></div>
          <div className="actions-summary-item"><strong>{newThisWeek}</strong><span>New this week</span></div>
        </div>
      ) : null}

      {actions.length === 0 ? (
        <div style={{ maxWidth: 520 }}>
          <p style={{ fontSize: 13.5, color: "var(--color-ink-secondary)", marginBottom: 16 }}>
            {(scanState?.kind === "completed_no_signals" || scanState?.kind === "partial_failure") && scanState.summary
              ? scanResultEmptyBody(scanState.summary)
              : scanState?.kind === "no_scan"
              ? "Actions appear once enough qualified evidence is available. Start your first scan to begin."
              : "Actions appear once enough qualified evidence is available."}
          </p>
          <ActionGhostPreview />
          <div style={{ marginTop: 16 }}>
            {scanState?.kind === "no_scan" ? (
              <Link className="dashboard-button dashboard-button-primary" href="/app/setup/scan">Run scan</Link>
            ) : (
              <Link className="dashboard-button dashboard-button-secondary" href="/app/signals">View Signals</Link>
            )}
          </div>
        </div>
      ) : (
        <ActionList actions={actions} workspaceId={workspace.id} />
      )}
    </section>
  );
}
