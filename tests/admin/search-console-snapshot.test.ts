import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getSearchConsoleRanges, getSearchConsoleSnapshot } from "../../apps/admin/src/server/search-console/snapshot";

const credentials = {
  SEARCH_CONSOLE_OAUTH_CLIENT_ID: "test-client.apps.googleusercontent.com",
  SEARCH_CONSOLE_OAUTH_CLIENT_SECRET: "fixture-client-secret",
  SEARCH_CONSOLE_OAUTH_REFRESH_TOKEN: "fixture-refresh-token",
};

const now = new Date("2026-09-30T18:00:00.000Z");

function mockGoogle(options: { empty?: boolean; freshness?: "provisional" | "settled" | "unknown" | "old" } = {}) {
  const requests: Array<Record<string, unknown>> = [];
  const ranges = getSearchConsoleRanges(now);
  const fetcher: typeof fetch = vi.fn(async (input, init) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "snapshot-access-token" });
    if (url.endsWith("/sites/sc-domain%3Awanterest.com")) return Response.json({ permissionLevel: "siteRestrictedUser" });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    const dimensions = body.dimensions as string[] | undefined;
    if (dimensions?.[0] === "date") {
      if (options.freshness === "unknown" || options.empty) return Response.json({ rows: [] });
      return Response.json({
        rows: [{ keys: [options.freshness === "old" ? "2026-09-15" : "2026-09-29"], clicks: 1, impressions: 4, ctr: 0.25, position: 8 }],
        metadata: options.freshness === "settled" || options.freshness === "old" ? {} : { firstIncompleteDate: "2026-09-28" },
      });
    }
    if (options.empty) return Response.json({ rows: [] });

    const isCurrent = body.startDate === ranges.period.startDate;
    if (!dimensions?.length) {
      return Response.json({ rows: [{ keys: [], clicks: isCurrent ? 12 : 8, impressions: isCurrent ? 440 : 300, ctr: isCurrent ? 12 / 440 : 8 / 300, position: 9.3 }] });
    }
    if (dimensions.length === 1 && dimensions[0] === "query") {
      return Response.json({ rows: isCurrent ? [
        { keys: ["Wanterest"], clicks: 3, impressions: 20, ctr: 0.15, position: 2 },
        { keys: ["team knowledge base"], clicks: 6, impressions: 180, ctr: 1 / 30, position: 12 },
        { keys: ["shared search"], clicks: 2, impressions: 140, ctr: 2 / 140, position: 15 },
      ] : [
        { keys: ["Wanterest"], clicks: 2, impressions: 18, ctr: 2 / 18, position: 3 },
        { keys: ["team knowledge base"], clicks: 4, impressions: 100, ctr: 0.04, position: 14 },
        { keys: ["shared search"], clicks: 1, impressions: 80, ctr: 1 / 80, position: 16 },
      ] });
    }
    if (dimensions.length === 1 && dimensions[0] === "page") {
      return Response.json({ rows: isCurrent ? [
        { keys: ["https://www.wanterest.com/product/"], clicks: 3, impressions: 60, ctr: 0.05, position: 11 },
        { keys: ["https://www.wanterest.com/product/?ref=campaign"], clicks: 2, impressions: 40, ctr: 0.05, position: 13 },
        { keys: ["https://app.wanterest.com/login"], clicks: 40, impressions: 400, ctr: 0.1, position: 1 },
      ] : [
        { keys: ["https://www.wanterest.com/product"], clicks: 5, impressions: 130, ctr: 5 / 130, position: 9 },
      ] });
    }
    return Response.json({ rows: isCurrent ? [
      { keys: ["team knowledge base", "https://www.wanterest.com/product/"], clicks: 5, impressions: 100, ctr: 0.05, position: 12 },
      { keys: ["team knowledge base", "https://www.wanterest.com/product?ref=campaign"], clicks: 1, impressions: 50, ctr: 0.02, position: 14 },
    ] : [
      { keys: ["team knowledge base", "https://www.wanterest.com/product"], clicks: 2, impressions: 70, ctr: 2 / 70, position: 14 },
    ] });
  });
  return { fetcher, requests, ranges };
}

describe("Search Console snapshot", () => {
  it("calculates report dates in Pacific Time across UTC midnight", () => {
    const boundary = getSearchConsoleRanges(new Date("2026-10-01T05:30:00.000Z"));
    expect(boundary.period.endDate).toBe("2026-09-26");
    expect(boundary.recent.endDate).toBe("2026-09-30");
  });
  it("uses Pacific dates, two adjacent finalized 28-day windows, and a separate recent provisional window", async () => {
    const { fetcher, requests, ranges } = mockGoogle();
    const snapshot = await getSearchConsoleSnapshot({ now, environment: credentials, fetcher });
    expect(ranges.period).toEqual({ startDate: "2026-08-30", endDate: "2026-09-26", days: 28 });
    expect(ranges.comparison).toEqual({ startDate: "2026-08-02", endDate: "2026-08-29", days: 28 });
    expect(snapshot.state).toBe("available");
    if (snapshot.state !== "available") return;
    expect(snapshot.metrics).toEqual({ clicks: 12, impressions: 440, ctr: 12 / 440, position: 9.3 });
    expect(snapshot.freshness).toMatchObject({ state: "provisional", latestAvailableDate: "2026-09-29", firstIncompleteDate: "2026-09-28" });
    expect(snapshot.period).toEqual(ranges.period);
    expect(snapshot.comparison).toEqual(ranges.comparison);
    expect(snapshot.queries).toHaveLength(3);
    expect(snapshot.pages.map((row) => row.key)).toEqual(["https://www.wanterest.com/product"]);
    expect(snapshot.pages[0]).toMatchObject({ clicks: 5, impressions: 100, ctr: 0.05, position: 11.8 });
    expect(snapshot.queryPages[0]?.key).toBe(JSON.stringify(["team knowledge base", "https://www.wanterest.com/product"]));
    expect(snapshot.queryPages[0]).toMatchObject({ clicks: 6, impressions: 150, ctr: 0.04, position: 12.666666666666666 });
    expect(snapshot.previousQueryPages[0]?.key).toBe(snapshot.queryPages[0]?.key);
    expect(requests.filter((request) => request.dataState === "final")).toHaveLength(8);
    expect(requests.filter((request) => request.dataState === "all")).toHaveLength(1);
  });

  it("keeps empty responses distinct from actual zero-valued metric rows", async () => {
    const empty = mockGoogle({ empty: true });
    const emptySnapshot = await getSearchConsoleSnapshot({ now, environment: credentials, fetcher: empty.fetcher });
    expect(emptySnapshot.state).toBe("empty");
    if (emptySnapshot.state === "empty") expect(emptySnapshot.metrics).toBeNull();

    const zeroFetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "zero-fixture-token" });
      if (url.endsWith("/sites/sc-domain%3Awanterest.com")) return Response.json({ permissionLevel: "siteRestrictedUser" });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const dimensions = body.dimensions as string[] | undefined;
      if (dimensions?.[0] === "date") return Response.json({ rows: [] });
      if (!dimensions?.length) return Response.json({ rows: [{ keys: [], clicks: 0, impressions: 0, ctr: 0, position: 0 }] });
      return Response.json({ rows: [] });
    });
    const zeroSnapshot = await getSearchConsoleSnapshot({ now, environment: credentials, fetcher: zeroFetcher });
    expect(zeroSnapshot.state).toBe("available");
    if (zeroSnapshot.state === "available") expect(zeroSnapshot.metrics).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
  });

  it("returns not configured without making any external request", async () => {
    const fetcher = vi.fn();
    const result = await getSearchConsoleSnapshot({ now, environment: {}, fetcher });
    expect(result.state).toBe("not_configured");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not count recent provisional rows in the finalized metrics", async () => {
    const { fetcher } = mockGoogle();
    const result = await getSearchConsoleSnapshot({ now, environment: credentials, fetcher });
    expect(result.state).toBe("available");
    if (result.state === "available") expect(result.metrics?.impressions).toBe(440);
  });

  it("keeps recent maturity unknown when date rows stop before the finalized window", async () => {
    const { fetcher } = mockGoogle({ freshness: "old" });
    const result = await getSearchConsoleSnapshot({ now, environment: credentials, fetcher });
    expect(result.state).toBe("available");
    if (result.state === "available") expect(result.freshness.state).toBe("unknown");
  });
  it("reports unknown freshness when the recent date request has no rows", async () => {
    const { fetcher } = mockGoogle({ freshness: "unknown" });
    const result = await getSearchConsoleSnapshot({ now, environment: credentials, fetcher });
    expect(result.state).toBe("available");
    if (result.state === "available") expect(result.freshness.state).toBe("unknown");
  });
});
