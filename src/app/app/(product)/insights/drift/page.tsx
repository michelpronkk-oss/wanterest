import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getDemandDriftQuery } from "@/server/modules/demand-intelligence/commands";
import { formatPercent, themeLabel } from "@/components/dashboard/dashboard-utils";
import { InsightsDataEmptyState, InsightsScopeEmptyState } from "@/components/dashboard/insights-empty-states";
import { DriftLists } from "@/components/dashboard/drift-lists";
import { CapabilityGate } from "@/components/dashboard/upgrade-surface";
import { resolveWorkspaceCapabilities } from "@/server/modules/entitlements/plan-capabilities";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";

export default async function DemandDriftPage() {
  const { workspace, product } = await getDashboardContext();
  if (!workspace || !product) return <InsightsScopeEmptyState workspace={workspace} product={product} />;

  const capabilities = await resolveWorkspaceCapabilities(createSupabaseServiceClient(), workspace.id);
  if (capabilities.history.driftHistoryDays === 0) {
    return (
      <CapabilityGate
        workspaceId={workspace.id}
        currentPlan={capabilities.plan}
        enabled={false}
        requiredPlan="pro"
        title="Demand Drift is a paid insight"
        body="Compare changing themes and emerging language across scans with 30 days of history."
      />
    );
  }

  const driftResult = await getDemandDriftQuery(workspace.id, product.id).catch(() => null);
  if (!driftResult) {
    return (
      <InsightsDataEmptyState
        workspaceId={workspace.id}
        productId={product.id}
        fallbackTitle="No drift comparison yet"
        fallbackBody="Drift needs two comparable scans of the same time window before rising and cooling themes can be measured."
      />
    );
  }

  const rising = [...driftResult.drifts].filter((row) => row.drift_direction === "rising").sort((a, b) => b.share_delta - a.share_delta);
  const cooling = [...driftResult.drifts].filter((row) => row.drift_direction === "cooling").sort((a, b) => a.share_delta - b.share_delta);
  const emergingPhrases = [...driftResult.phraseDrifts].filter((row) => row.drift_direction === "rising").sort((a, b) => (b.growth_rate ?? 0) - (a.growth_rate ?? 0)).slice(0, 5);
  const topRising = rising[0] ?? null;
  const topCooling = cooling[0] ?? null;

  return (
    <div style={{ marginTop: 20 }}>
      <div className="insights-stat-grid">
        <div className="insights-stat-card">
          <div className="insights-stat-card-label">Fastest growing</div>
          <div className="insights-stat-card-value" style={{ fontSize: 15 }}>{topRising ? <>{themeLabel(topRising.concept_key)} <span style={{ color: "var(--color-positive)", fontSize: 13 }}>+{formatPercent(topRising.share_delta)}</span></> : "—"}</div>
        </div>
        <div className="insights-stat-card">
          <div className="insights-stat-card-label">Biggest decline</div>
          <div className="insights-stat-card-value" style={{ fontSize: 15 }}>{topCooling ? <>{themeLabel(topCooling.concept_key)} <span style={{ color: "var(--color-negative)", fontSize: 13 }}>{formatPercent(topCooling.share_delta)}</span></> : "—"}</div>
        </div>
        <div className="insights-stat-card">
          <div className="insights-stat-card-label">Strongest emerging phrase</div>
          <div className="insights-stat-card-value" style={{ fontSize: 14 }}>{emergingPhrases[0]?.phrase ?? "—"}</div>
        </div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Comparing</div><div className="insights-stat-card-value" style={{ fontSize: 15 }}>Last two scans</div></div>
      </div>

      <DriftLists rising={rising} cooling={cooling} />

      <div className="ui-card ui-card-pad-lg">
        <div className="ui-section-label">Emerging language</div>
        {emergingPhrases.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>No emerging phrases yet.</p> : emergingPhrases.map((phrase) => (
          <div key={phrase.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--color-border-soft)" }}>
            <div style={{ flex: 1, fontSize: 13, color: "var(--color-ink-secondary)" }}>&ldquo;{phrase.phrase}&rdquo;</div>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)" }}>{phrase.current_mentions}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
