import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getGeographyQuery } from "@/server/modules/demand-intelligence/commands";
import { GeographySurface } from "@/components/dashboard/geography-surface";
import { InsightsDataEmptyState, InsightsScopeEmptyState } from "@/components/dashboard/insights-empty-states";
import { geographyWindowSchema, parseGeographySelection, type GeographyWindow } from "@/server/modules/geography/geography.schemas";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

export default async function GeographyPage({ searchParams }: { searchParams: SearchParams }) {
  const { workspace, product } = await getDashboardContext();
  if (!workspace || !product) return <InsightsScopeEmptyState workspace={workspace} product={product} />;
  const query = await searchParams;
  const parsedWindow = geographyWindowSchema.safeParse(first(query.window));
  const window = (parsedWindow.success ? parsedWindow.data : "30d") as GeographyWindow;
  const data = await getGeographyQuery(workspace.id, product.id, window, parseGeographySelection(query)).catch(() => null);
  if (!data) return <InsightsDataEmptyState workspaceId={workspace.id} productId={product.id} fallbackTitle="Geography is not ready yet" fallbackBody="Complete a scan to build location-aware demand intelligence." />;
  if (!data.totalQualifiedSignalCount) return <GeographySurface data={data} />;
  return <div style={{ marginTop: 8 }}><GeographySurface data={data} /></div>;
}
