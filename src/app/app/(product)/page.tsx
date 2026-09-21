import Link from "next/link";

import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { listSignalsQuery } from "@/server/modules/intelligence/commands";
import { listActionsQuery } from "@/server/modules/actions/commands";
import { getDemandDriftQuery } from "@/server/modules/demand-intelligence/commands";
import { listDigestsQuery } from "@/server/modules/digests/commands";
import { MetricCard } from "@/components/ui/card";
import { ZeroState } from "@/components/ui/zero-state";
import { EmptyState } from "@/components/ui/empty-state";
import { SignalCard } from "@/components/dashboard/signal-card";
import { PipelineFlow } from "@/components/dashboard/pipeline-flow";
import { formatPercent, themeLabel } from "@/components/dashboard/dashboard-utils";
import { getProductScanState } from "@/components/dashboard/scan-state";
import { scanResultEmptyBody } from "@/components/dashboard/scan-status.view-model";
import { ScanStatusBanner } from "@/components/dashboard/scan-status-banner";
import { getMonitoringOverview } from "@/server/modules/monitoring/monitoring.read-model";

const HOME_PIPELINE = [
  { label: "Understand", hint: "Wanterest reads your product and market." },
  { label: "Find", hint: "Qualifies real conversations across sources." },
  { label: "Act", hint: "Turns evidence into recommended moves." },
];

const HIGH_INTENT = new Set(["high_intent", "switching_intent"]);

export default async function HomePage() {
  const { workspace, product } = await getDashboardContext();

  if (!workspace) {
    return (
      <section className="dashboard-page dashboard-state">
        <p className="dashboard-eyebrow">Welcome to Wanterest</p>
        <h1>Create your first workspace</h1>
        <p>Your account is ready. Create a workspace to start collecting product context and demand signals.</p>
        <Link className="dashboard-button dashboard-button-primary" href="/app/setup/workspace">Create workspace</Link>
      </section>
    );
  }
  if (!product) {
    return (
      <section className="dashboard-page">
        <ZeroState
          eyebrow="Product context needed"
          title="Find the demand around your product."
          body="Add a product and Wanterest will understand what you sell, identify which conversations matter, and prepare your first demand scan."
          primaryCta={{ label: "Add product", href: "/app/setup/product" }}
          note="Usually takes only a few minutes to get started."
        />
        <div className="home-section" style={{ marginTop: 32 }}>
          <PipelineFlow stages={HOME_PIPELINE} />
        </div>
      </section>
    );
  }

  const [signals, actionsResult, driftResult, digestsResult, monitoring] = await Promise.all([
    listSignalsQuery(workspace.id, product.id, { limit: 50 }),
    listActionsQuery(workspace.id, product.id, { status: "proposed" }).catch(() => []),
    getDemandDriftQuery(workspace.id, product.id).catch(() => null),
    listDigestsQuery(workspace.id, product.id).catch(() => []),
    getMonitoringOverview(workspace.id, product.id).catch(() => null),
  ]);

  const scanState = await getProductScanState(workspace.id, product.id, signals.length > 0);

  if (scanState.kind === "no_scan") {
    return (
      <section className="dashboard-page">
        <ZeroState
          eyebrow="Getting started"
          title="Start your first demand scan."
          body={`Wanterest will search the conversations that matter for ${product.name}, qualify real demand, and build your first market picture.`}
          primaryCta={{ label: "Start first scan", href: "/app/setup/scan" }}
        />
        <div className="home-section" style={{ marginTop: 32 }}>
          <PipelineFlow stages={HOME_PIPELINE} />
        </div>
      </section>
    );
  }

  const highIntentCount = signals.filter((signal) => HIGH_INTENT.has(signal.intentType)).length;
  const topSignals = signals.slice(0, 3);
  const topAction = [...actionsResult].sort((a, b) => b.action.priority_score - a.action.priority_score)[0] ?? null;
  const latestDigest = digestsResult[0] ?? null;
  const drifts = driftResult?.drifts ?? [];
  const topRising = [...drifts].filter((row) => row.drift_direction === "rising").sort((a, b) => b.share_delta - a.share_delta)[0] ?? null;
  const topCooling = [...drifts].filter((row) => row.drift_direction === "cooling").sort((a, b) => a.share_delta - b.share_delta)[0] ?? null;

  return (
    <section className="dashboard-page">
      <header className="dashboard-page-header">
        <p className="dashboard-eyebrow">Today</p>
        <h1>Today</h1>
        <p className="dashboard-subtitle">{signals.length} qualified signal{signals.length === 1 ? "" : "s"} for {product.name}.</p>
      </header>

      <ScanStatusBanner state={scanState} workspaceId={workspace.id} productId={product.id} />

      {monitoring ? (
        <div className="home-section monitoring-summary" aria-label="Automatic monitoring">
          <div className="home-section-header">
            <div>
              <div className="ui-section-label" style={{ marginBottom: 4 }}>Monitoring</div>
              <div style={{ fontSize: 15, fontWeight: 650 }}>{monitoring.enabled ? "Active" : "Paused"}</div>
            </div>
            <Link className="dashboard-button dashboard-button-secondary" href="/app/setup/scan">Refresh intelligence</Link>
          </div>
          <div className="monitoring-summary-meta">
            <span>{monitoring.cadenceLabel}</span>
            {monitoring.lastCycleAt ? <span>Last cycle {new Date(monitoring.lastCycleAt).toLocaleDateString()}</span> : <span>No cycle completed yet</span>}
            {monitoring.nextRefreshAt && monitoring.enabled ? <span>Next refresh {new Date(monitoring.nextRefreshAt).toLocaleDateString()}</span> : null}
            {monitoring.sources.length ? <span>{monitoring.sources.join(" · ")}</span> : null}
          </div>
          {monitoring.lastStatus === "limited" ? <p className="monitoring-summary-note">The last cycle completed with limited source coverage.</p> : null}
          {monitoring.lastStatus === "failed" ? <p className="monitoring-summary-note">The last cycle could not finish. Refresh intelligence to try again.</p> : null}
        </div>
      ) : null}

      {signals.length === 0 && (scanState.kind === "completed_no_signals" || scanState.kind === "partial_failure") ? (
        <div className="home-section">
          <EmptyState
            title="No high-confidence demand found in this scan"
            body={scanResultEmptyBody(scanState.summary)}
            cta={{ label: "Run another scan", href: "/app/setup/scan" }}
          />
        </div>
      ) : null}

      <div className="metric-grid home-section">
        <MetricCard label="Qualified signals" value={signals.length} />
        <MetricCard label="High intent" value={highIntentCount} accent={highIntentCount > 0} />
        <MetricCard label="Proposed actions" value={actionsResult.length} />
      </div>

      {latestDigest && latestDigest.items.length > 0 ? (
        <div className="home-section">
          <div className="ui-section-label">What changed</div>
          <div className="home-what-changed">
            {latestDigest.items.slice(0, 5).map((item) => (
              <div className="home-what-changed-row" key={item.id}>
                <span className="badge-dot" style={{ color: "var(--color-accent)" }} />
                <span>{item.reason}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {topSignals.length > 0 ? (
        <div className="home-section">
          <div className="home-section-header">
            <div className="ui-section-label" style={{ marginBottom: 0 }}>Top signals</div>
            <Link href="/app/signals" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)" }}>View all →</Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {topSignals.map((signal) => <SignalCard key={signal.signalId} signal={signal} workspaceId={workspace.id} />)}
          </div>
        </div>
      ) : null}

      {topAction ? (
        <div className="home-section">
          <div className="ui-section-label">Recommended next move</div>
          <div className="home-next-move">
            <span className="badge badge-accent">{topAction.action.priority_score >= 0.7 ? "HIGH IMPACT" : "OPPORTUNITY"}</span>
            <p className="home-next-move-title">{topAction.action.title}</p>
            <p className="home-next-move-body">{topAction.action.why}</p>
            <Link className="dashboard-button dashboard-button-accent" href="/app/actions">View action →</Link>
          </div>
        </div>
      ) : null}

      {topRising || topCooling ? (
        <div className="home-section">
          <div className="ui-section-label">Demand movement</div>
          <div className="home-movement-grid">
            {topRising ? (
              <div className="metric-card">
                <div className="metric-card-label">Rising</div>
                <div className="home-movement-card">
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{themeLabel(topRising.concept_key)}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-positive)" }}>+{formatPercent(topRising.share_delta)}</span>
                </div>
              </div>
            ) : null}
            {topCooling ? (
              <div className="metric-card">
                <div className="metric-card-label">Cooling</div>
                <div className="home-movement-card">
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{themeLabel(topCooling.concept_key)}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-negative)" }}>{formatPercent(topCooling.share_delta)}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
