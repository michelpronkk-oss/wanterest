import type { ReadFirstProductIntelligence } from "@/server/modules/operations/read-first-intelligence.service";

type Props = Pick<ReadFirstProductIntelligence, "freshness" | "refresh" | "intelligence">;
type Freshness = Props["freshness"];

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

/**
 * Stage 2E copy: separates "how recently Wanterest checked this market for
 * the product" from "how recent the newest qualifying demand is", so a quiet
 * market is never presented as stale intelligence.
 */
export function freshnessHeadline(freshness: Freshness): string {
  if (freshness.state === "empty") {
    return freshness.interpretation.lastCheckedAt ? "Market checked - no qualifying demand yet" : "Building your first market view";
  }
  if (freshness.interpretation.state === "fresh") {
    return freshness.state === "fresh" ? "Intelligence is up to date" : "Up to date - no new qualifying demand since the last signal";
  }
  if (freshness.state === "fresh") return "Intelligence is up to date";
  if (freshness.state === "recent" || freshness.interpretation.state === "recent") return "Intelligence is recent";
  return "Intelligence is stale";
}

export function refreshStatusCopy(status: Props["refresh"]["status"], refreshDue: boolean): string {
  if (status === "queued") return "Refresh queued";
  if (status === "running") return "Refresh running in the background";
  if (refreshDue) return "Refresh due";
  return "No refresh needed";
}

export function lastCheckedCopy(freshness: Freshness): string | null {
  const { lastCheckedAt, lastCheckSource } = freshness.interpretation;
  if (!lastCheckedAt) return null;
  return lastCheckSource === "incremental" ? `Market checked automatically ${formatTime(lastCheckedAt)}` : `Market checked ${formatTime(lastCheckedAt)}`;
}

export function ReadFirstIntelligenceStatus({ freshness, refresh }: Props) {
  const checked = lastCheckedCopy(freshness);
  const newest = freshness.evidence.newestPublishedAt;
  return (
    <div className="home-section monitoring-summary" aria-label="Product intelligence status">
      <div className="monitoring-summary-meta">
        <span>{freshnessHeadline(freshness)}</span>
        <span>{refreshStatusCopy(refresh.status, freshness.refreshDue)}</span>
        {checked ? <span>{checked}</span> : null}
        {newest ? <span>Newest demand {formatTime(newest)}</span> : null}
      </div>
    </div>
  );
}
