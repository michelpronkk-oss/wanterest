export const SEARCH_CONSOLE_PROPERTY = "sc-domain:wanterest.com";
export const SEARCH_CONSOLE_SOURCE = "Google Search Console · Search Analytics API";
export const SEARCH_CONSOLE_WINDOW_DAYS = 28;

export type SearchConsoleMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SearchConsoleRange = {
  startDate: string;
  endDate: string;
  days: number;
};

export type SearchConsoleRow = SearchConsoleMetrics & {
  key: string;
};

export type SearchConsoleFreshness = {
  state: "provisional" | "settled" | "unknown";
  latestAvailableDate: string | null;
  firstIncompleteDate: string | null;
  detail: string;
};

export type SearchConsolePermission = "siteOwner" | "siteFullUser" | "siteRestrictedUser";

type SnapshotBase = {
  property: string;
  source: string;
  checkedAt: string | null;
  period: SearchConsoleRange;
  comparison: SearchConsoleRange;
};

export type SearchConsoleUnavailableSnapshot = SnapshotBase & {
  state: "not_configured" | "unavailable";
  reason: string;
};

export type SearchConsoleReadySnapshot = SnapshotBase & {
  state: "available" | "empty";
  permission: SearchConsolePermission;
  metrics: SearchConsoleMetrics | null;
  previousMetrics: SearchConsoleMetrics | null;
  queries: SearchConsoleRow[];
  previousQueries: SearchConsoleRow[];
  pages: SearchConsoleRow[];
  previousPages: SearchConsoleRow[];
  queryPages: SearchConsoleRow[];
  previousQueryPages: SearchConsoleRow[];
  freshness: SearchConsoleFreshness;
  rowLimit: number;
};

export type SearchConsoleSnapshot =
  | SearchConsoleUnavailableSnapshot
  | SearchConsoleReadySnapshot;
