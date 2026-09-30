import "server-only";

import { SEARCH_CONSOLE_PROPERTY, SEARCH_CONSOLE_SOURCE, SEARCH_CONSOLE_WINDOW_DAYS, type SearchConsoleMetrics, type SearchConsoleRange, type SearchConsoleRow, type SearchConsoleSnapshot } from "./model";
import { createSearchConsoleSetup, metricsFromRows, SEARCH_CONSOLE_ROW_LIMIT, SearchConsoleProviderError, type GoogleSearchConsoleProvider, type SearchConsoleEnvironment } from "./google";

const FINAL_DATA_BUFFER_DAYS = 4;
const RECENT_DATA_LOOKBACK_DAYS = 10;

function pacificDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "2000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return year + "-" + month + "-" + day;
}

function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function getSearchConsoleRanges(now: Date = new Date()): { period: SearchConsoleRange; comparison: SearchConsoleRange; recent: SearchConsoleRange } {
  const today = pacificDate(now);
  const periodEnd = shiftDate(today, -FINAL_DATA_BUFFER_DAYS);
  const periodStart = shiftDate(periodEnd, -(SEARCH_CONSOLE_WINDOW_DAYS - 1));
  const comparisonEnd = shiftDate(periodStart, -1);
  const comparisonStart = shiftDate(comparisonEnd, -(SEARCH_CONSOLE_WINDOW_DAYS - 1));
  return {
    period: { startDate: periodStart, endDate: periodEnd, days: SEARCH_CONSOLE_WINDOW_DAYS },
    comparison: { startDate: comparisonStart, endDate: comparisonEnd, days: SEARCH_CONSOLE_WINDOW_DAYS },
    recent: { startDate: shiftDate(today, -(RECENT_DATA_LOOKBACK_DAYS - 1)), endDate: today, days: RECENT_DATA_LOOKBACK_DAYS },
  };
}

function unavailable(state: "not_configured" | "unavailable", reason: string, checkedAt: string | null, ranges: ReturnType<typeof getSearchConsoleRanges>): SearchConsoleSnapshot {
  return {
    state,
    property: SEARCH_CONSOLE_PROPERTY,
    source: SEARCH_CONSOLE_SOURCE,
    checkedAt,
    period: ranges.period,
    comparison: ranges.comparison,
    reason,
  };
}

function canonicalPage(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "www.wanterest.com" || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "/";
    return url.origin + pathname;
  } catch {
    return null;
  }
}

function canonicalRows(rows: SearchConsoleRow[], kind: "page" | "query-page"): SearchConsoleRow[] {
  const canonical = kind === "page"
    ? rows.flatMap((row) => {
      const page = canonicalPage(row.key);
      return page ? [{ ...row, key: page }] : [];
    })
    : rows.flatMap((row) => {
      let keys: unknown;
      try {
        keys = JSON.parse(row.key);
      } catch {
        return [];
      }
      if (!Array.isArray(keys) || keys.length !== 2 || !keys.every((key) => typeof key === "string")) return [];
      const [query, rawPage] = keys as [string, string];
      const page = canonicalPage(rawPage);
      return page && query ? [{ ...row, key: JSON.stringify([query, page]) }] : [];
    });

  const aggregated = new Map<string, { clicks: number; impressions: number; weightedPosition: number; fallbackPosition: number; rows: number }>();
  for (const row of canonical) {
    const current = aggregated.get(row.key) ?? { clicks: 0, impressions: 0, weightedPosition: 0, fallbackPosition: 0, rows: 0 };
    current.clicks += row.clicks;
    current.impressions += row.impressions;
    current.weightedPosition += row.position * row.impressions;
    current.fallbackPosition += row.position;
    current.rows += 1;
    aggregated.set(row.key, current);
  }
  return [...aggregated].map(([key, value]) => ({
    key,
    clicks: value.clicks,
    impressions: value.impressions,
    ctr: value.impressions > 0 ? value.clicks / value.impressions : 0,
    position: value.impressions > 0 ? value.weightedPosition / value.impressions : value.fallbackPosition / value.rows,
  }));
}

async function safeFreshness(provider: GoogleSearchConsoleProvider, recent: SearchConsoleRange, finalizedThrough: string) {
  try {
    const result = await provider.query({ ...recent, dimensions: ["date"], dataState: "all" });
    const dates = result.rows.map((row) => row.key).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
    const latestAvailableDate = dates.at(-1) ?? null;
    const firstIncompleteDate = result.firstIncompleteDate;
    if (firstIncompleteDate) {
      return {
        state: "provisional" as const,
        latestAvailableDate,
        firstIncompleteDate,
        detail: "Recent Search Console rows from this date onward are preliminary and excluded from the finalized comparison.",
      };
    }
    if (latestAvailableDate && latestAvailableDate >= finalizedThrough) {
      return {
        state: "settled" as const,
        latestAvailableDate,
        firstIncompleteDate: null,
        detail: "The latest recent date is at or beyond the finalized window and the API returned no incomplete-date marker. Comparisons still use finalized data only.",
      };
    }
    if (latestAvailableDate) {
      return {
        state: "unknown" as const,
        latestAvailableDate,
        firstIncompleteDate: null,
        detail: "The latest returned date is earlier than the finalized window. Missing later rows do not establish zero traffic, so freshness is unknown.",
      };
    }
    return {
      state: "unknown" as const,
      latestAvailableDate: null,
      firstIncompleteDate: null,
      detail: "Google did not return recent date rows, so recent data maturity is unknown.",
    };
  } catch {
    return {
      state: "unknown" as const,
      latestAvailableDate: null,
      firstIncompleteDate: null,
      detail: "Recent data maturity could not be checked. Finalized historical queries remain separate.",
    };
  }
}
async function loadWindow(provider: GoogleSearchConsoleProvider, range: SearchConsoleRange) {
  const [totals, queries, pages, queryPages] = await Promise.all([
    provider.query({ ...range, dataState: "final", aggregationType: "byProperty" }),
    provider.query({ ...range, dimensions: ["query"], dataState: "final" }),
    provider.query({ ...range, dimensions: ["page"], dataState: "final" }),
    provider.query({ ...range, dimensions: ["query", "page"], dataState: "final" }),
  ]);
  return {
    metrics: metricsFromRows(totals.rows),
    queries: queries.rows,
    pages: canonicalRows(pages.rows, "page"),
    queryPages: canonicalRows(queryPages.rows, "query-page"),
  };
}

export async function getSearchConsoleSnapshot(options: {
  now?: Date;
  environment?: SearchConsoleEnvironment;
  fetcher?: typeof fetch;
} = {}): Promise<SearchConsoleSnapshot> {
  const now = options.now ?? new Date();
  const ranges = getSearchConsoleRanges(now);
  const setup = createSearchConsoleSetup({ environment: options.environment, fetcher: options.fetcher });
  if (setup.state === "not_configured") return unavailable("not_configured", setup.reason, null, ranges);
  if (setup.state === "unavailable") return unavailable("unavailable", setup.reason, null, ranges);

  try {
    const permission = await setup.provider.verifyProperty();
    const [current, previous, freshness] = await Promise.all([
      loadWindow(setup.provider, ranges.period),
      loadWindow(setup.provider, ranges.comparison),
      safeFreshness(setup.provider, ranges.recent, ranges.period.endDate),
    ]);
    const checkedAt = new Date().toISOString();
    const hasCurrentRows = current.metrics !== null || current.queries.length > 0 || current.pages.length > 0 || current.queryPages.length > 0;
    const metrics: SearchConsoleMetrics | null = current.metrics;
    return {
      state: hasCurrentRows ? "available" : "empty",
      property: SEARCH_CONSOLE_PROPERTY,
      source: SEARCH_CONSOLE_SOURCE,
      checkedAt,
      permission,
      period: ranges.period,
      comparison: ranges.comparison,
      metrics,
      previousMetrics: previous.metrics,
      queries: current.queries,
      previousQueries: previous.queries,
      pages: current.pages,
      previousPages: previous.pages,
      queryPages: current.queryPages,
      previousQueryPages: previous.queryPages,
      freshness,
      rowLimit: SEARCH_CONSOLE_ROW_LIMIT,
    };
  } catch (error) {
    const reason = error instanceof SearchConsoleProviderError
      ? error.message
      : "Search Console could not be read. Check the production connection and try again later.";
    return unavailable("unavailable", reason, new Date().toISOString(), ranges);
  }
}
