import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getCurrentGeographyQuery, getGeographyQuery, isDownstreamIntelligenceV2Enabled, isGeographyV2Enabled } from "@/server/modules/demand-intelligence/commands";
import { GeographySurface } from "@/components/dashboard/geography-surface";
import { CurrentGeographySummary, currentGeographyCaption } from "@/components/dashboard/current-geography-summary";
import { HistoricalEvidenceSection } from "@/components/dashboard/demand-map-concepts";
import { currentGeographyHeadline } from "@/server/modules/geography/current-geography.policy";
import { InsightsDataEmptyState, InsightsScopeEmptyState } from "@/components/dashboard/insights-empty-states";
import { geographyWindowSchema, parseGeographySelection, type GeographyWindow } from "@/server/modules/geography/geography.schemas";
import { CapabilityGate } from "@/components/dashboard/upgrade-surface";
import { resolveWorkspaceCapabilities } from "@/server/modules/entitlements/plan-capabilities";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

export default async function GeographyPage({ searchParams }: { searchParams: SearchParams }) {
  const { workspace, product } = await getDashboardContext();
  if (!workspace || !product) return <InsightsScopeEmptyState workspace={workspace} product={product} />;
  const query = await searchParams;
  const parsedWindow = geographyWindowSchema.safeParse(first(query.window));
  const window = (parsedWindow.success ? parsedWindow.data : "30d") as GeographyWindow;
  const capabilities = await resolveWorkspaceCapabilities(createSupabaseServiceClient(), workspace.id);
  const requestedDays = Number(window.slice(0, -1));
  if (requestedDays > 30 && capabilities.geography.historyDays < requestedDays) {
    return (
      <CapabilityGate
        workspaceId={workspace.id}
        currentPlan={capabilities.plan}
        enabled={false}
        requiredPlan="growth"
        title="Broader Geo history is available on Growth"
        body="Growth keeps up to 90 days of regional context for comparing market movement over time."
      />
    );
  }
  const data = await getGeographyQuery(workspace.id, product.id, window, parseGeographySelection(query)).catch(() => null);
  if (!data) return <InsightsDataEmptyState workspaceId={workspace.id} productId={product.id} fallbackTitle="Geography is not ready yet" fallbackBody="Complete a scan to build location-aware demand intelligence." />;

  // Layer 9D: current, lifecycle-aware Geography renders first; the legacy
  // raw-window view below becomes clearly labelled historical context. See
  // docs/architecture.md §19.
  if (isGeographyV2Enabled()) {
    const geography = await getCurrentGeographyQuery(workspace.id, product.id);
    const headline = currentGeographyHeadline(geography);
    return (
      <div style={{ marginTop: 8 }}>
        <CurrentGeographySummary geography={geography} headline={headline} />
        <HistoricalEvidenceSection caption={currentGeographyCaption(geography)}>
          <GeographySurface data={data} workspaceId={workspace.id} />
        </HistoricalEvidenceSection>
      </div>
    );
  }

  // Layer 9B: Geography is not yet re-derived from lifecycle-verified current
  // evidence (deferred; docs/architecture.md §17) — label only, no rework here.
  const notice = isDownstreamIntelligenceV2Enabled() ? <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginBottom: 12 }}>Not lifecycle-filtered.</p> : null;
  if (!data.totalQualifiedSignalCount) return <>{notice}<GeographySurface data={data} workspaceId={workspace.id} /></>;
  return <div style={{ marginTop: 8 }}>{notice}<GeographySurface data={data} workspaceId={workspace.id} /></div>;
}
