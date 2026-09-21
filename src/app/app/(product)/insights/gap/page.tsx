import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getDemandGapQuery } from "@/server/modules/demand-intelligence/commands";
import { InsightsDataEmptyState, InsightsScopeEmptyState } from "@/components/dashboard/insights-empty-states";
import { GapPageBody } from "@/components/dashboard/gap-sections";

export default async function DemandGapPage() {
  const { workspace, product } = await getDashboardContext();
  if (!workspace || !product) return <InsightsScopeEmptyState workspace={workspace} product={product} />;

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
