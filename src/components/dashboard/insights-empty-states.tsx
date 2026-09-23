import type { ProductRow, WorkspaceRow } from "@/server/db/database.helpers";
import { ZeroState } from "@/components/ui/zero-state";
import { EmptyState } from "@/components/ui/empty-state";
import { InsightsModulePreview } from "./insights-module-preview";
import { RescanRetryLink } from "./rescan-retry-link";
import { getProductScanState } from "./scan-state";
import { ScanStatusBanner } from "./scan-status-banner";
import { scanResultEmptyBody } from "./scan-status.view-model";

const INSIGHTS_BODY = "Once your first scan is complete, Wanterest will show what buyers repeatedly want, where your positioning misses demand, what is rising or cooling, and which themes deserve attention.";

/** Shared "no workspace / no product" state for every Insights tab. */
export function InsightsScopeEmptyState({ workspace, product }: { workspace: Pick<WorkspaceRow, "id" | "name" | "slug" | "status"> | null; product: Pick<ProductRow, "id" | "workspace_id" | "name" | "slug" | "website_url" | "status" | "current_snapshot_id" | "current_demand_profile_id"> | null }) {
  if (!workspace) {
    return (
      <div className="dashboard-state" style={{ marginTop: 4 }}>
        <p>Insights are scoped to a workspace and product. Create a workspace to continue.</p>
      </div>
    );
  }
  void product;
  return (
    <div style={{ marginTop: 4 }}>
      <ZeroState
        title="Turn qualified Signals into market intelligence."
        body={INSIGHTS_BODY}
        primaryCta={{ label: "Add product", href: "/app/setup/product" }}
      />
      <div style={{ marginTop: 28 }}>
        <InsightsModulePreview />
      </div>
    </div>
  );
}

/** Shared "product exists but this tab has no data yet" state, aware of scan progress. */
export async function InsightsDataEmptyState({
  workspaceId,
  productId,
  fallbackTitle,
  fallbackBody,
}: {
  workspaceId: string;
  productId: string;
  fallbackTitle: string;
  fallbackBody: string;
}) {
  const scanState = await getProductScanState(workspaceId, productId, false);

  if (scanState.kind === "no_scan") {
    return (
      <div style={{ marginTop: 4 }}>
        <ZeroState
          title="Start your first demand scan."
          body="Once your first scan completes, this view builds up from your qualified conversations."
          primaryCta={{ label: "Start first scan", href: "/app/setup/scan" }}
        />
        <div style={{ marginTop: 28 }}>
          <InsightsModulePreview />
        </div>
      </div>
    );
  }
  if (scanState.kind === "running") {
    return (
      <div style={{ marginTop: 20 }}>
        <ScanStatusBanner state={scanState} workspaceId={workspaceId} productId={productId} />
        <EmptyState title={fallbackTitle} body={fallbackBody} />
      </div>
    );
  }
  if ((scanState.kind === "completed_no_signals" || scanState.kind === "partial_failure") && scanState.summary) {
    return (
      <div style={{ marginTop: 20 }}>
        <ScanStatusBanner state={scanState} workspaceId={workspaceId} productId={productId} />
        <EmptyState title="No high-confidence demand found in this scan" body={scanResultEmptyBody(scanState.summary)}>
          <RescanRetryLink workspaceId={workspaceId} productId={productId} label="Run another scan" />
        </EmptyState>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 20 }}>
      <ScanStatusBanner state={scanState} workspaceId={workspaceId} productId={productId} />
      <EmptyState title={fallbackTitle} body={fallbackBody} />
    </div>
  );
}
