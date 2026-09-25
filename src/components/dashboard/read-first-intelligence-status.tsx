import type { ReadFirstProductIntelligence } from "@/server/modules/operations/read-first-intelligence.service";

type Props = Pick<ReadFirstProductIntelligence, "freshness" | "refresh" | "intelligence">;

function freshnessCopy(state: Props["freshness"]["state"]): string {
  if (state === "fresh") return "Intelligence is up to date";
  if (state === "recent") return "Intelligence is recent";
  if (state === "stale") return "Intelligence is stale";
  return "Building your first market view";
}

function refreshCopy(status: Props["refresh"]["status"], refreshDue: boolean): string {
  if (status === "queued") return "Refresh queued";
  if (status === "running") return "Refresh running in the background";
  if (status === "complete" && refreshDue) return "Refresh due";
  if (status === "complete") return "Refresh complete";
  return refreshDue ? "Refresh available" : "No refresh needed";
}

export function ReadFirstIntelligenceStatus({ freshness, refresh, intelligence }: Props) {
  return (
    <div className="home-section monitoring-summary" aria-label="Product intelligence status">
      <div className="monitoring-summary-meta">
        <span>{freshnessCopy(freshness.state)}</span>
        <span>{refreshCopy(refresh.status, freshness.refreshDue)}</span>
        {intelligence.lastSuccessfulRefreshAt ? <span>Last updated {new Date(intelligence.lastSuccessfulRefreshAt).toLocaleString()}</span> : null}
      </div>
    </div>
  );
}
