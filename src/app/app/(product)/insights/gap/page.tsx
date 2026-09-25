import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getDemandGapQuery, getDemandGapV2Query, isDownstreamIntelligenceV2Enabled } from "@/server/modules/demand-intelligence/commands";
import { InsightsDataEmptyState, InsightsScopeEmptyState } from "@/components/dashboard/insights-empty-states";
import { GapPageBody } from "@/components/dashboard/gap-sections";
import { demandGapV2Headline, GapV2List } from "@/components/dashboard/downstream-v2-sections";
import { HistoricalEvidenceSection } from "@/components/dashboard/demand-map-concepts";

export default async function DemandGapPage() {
  const { workspace, product } = await getDashboardContext();
  if (!workspace || !product) return <InsightsScopeEmptyState workspace={workspace} product={product} />;

  if (isDownstreamIntelligenceV2Enabled()) {
    const gapV2 = await getDemandGapV2Query(workspace.id, product.id).catch(() => null);
    const legacy = await getDemandGapQuery(workspace.id, product.id).catch(() => null);
    if (!gapV2 && !legacy) {
      return <InsightsDataEmptyState workspaceId={workspace.id} productId={product.id} fallbackTitle="Gap is temporarily unavailable" fallbackBody="Your saved intelligence is unchanged; try again shortly." />;
    }
    const headline = gapV2 ? demandGapV2Headline(gapV2) : { title: "No current gap evidence", body: "Gap could not be loaded." };
    return (
      <div style={{ marginTop: 20 }}>
        <div className="ui-card ui-card-pad-lg" style={{ marginBottom: 16 }}>
          <div className="ui-section-label" style={{ marginBottom: 2 }}>{headline.title}</div>
          <p style={{ fontSize: 12.5, color: "var(--color-ink-muted)", marginBottom: gapV2?.items.length ? 10 : 0 }}>{headline.body}</p>
          {gapV2 ? <GapV2List items={gapV2.items} /> : null}
        </div>
        {legacy && legacy.gaps.length > 0 ? (
          <HistoricalEvidenceSection caption={`${legacy.gaps.length} legacy gap row${legacy.gaps.length === 1 ? "" : "s"} from the snapshot pipeline.`}>
            <GapPageBody gaps={legacy.gaps} />
          </HistoricalEvidenceSection>
        ) : null}
      </div>
    );
  }

  const gapResult = await getDemandGapQuery(workspace.id, product.id).catch(() => null);
  if (!gapResult || gapResult.gaps.length === 0) {
    return (
      <InsightsDataEmptyState
        workspaceId={workspace.id}
        productId={product.id}
        fallbackTitle="No gap analysis yet"
        fallbackBody="Gap analysis builds up once your demand map has enough qualified conversations to compare against your current positioning."
      />
    );
  }

  return <GapPageBody gaps={gapResult.gaps} />;
}
