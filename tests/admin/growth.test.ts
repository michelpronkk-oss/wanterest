import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../apps/admin/src/server/supabase", () => ({ createAdminServiceClient: vi.fn(() => null) }));

const now = new Date("2026-09-30T12:00:00.000Z");

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Admin Growth measurement boundaries", () => {
  it("validates UTC periods and caps custom ranges", async () => {
    const { parseGrowthPeriod } = await import("../../apps/admin/src/server/growth");
    expect(parseGrowthPeriod({ period: "7d" }, now)).toMatchObject({ startDate: "2026-09-24", endDate: "2026-09-30", days: 7 });
    expect(parseGrowthPeriod({ period: "custom", from: "2025-01-01", to: "2026-09-30" }, now).days).toBe(30);
    expect(parseGrowthPeriod({ period: "custom", from: "2026-09-31", to: "2026-09-30" }, now).days).toBe(30);
  });

  it("keeps traffic unavailable when instrumentation start or server API access is missing", async () => {
    vi.stubEnv("VERCEL_API_TOKEN", "");
    vi.stubEnv("VERCEL_WEB_ANALYTICS_START_AT", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getGrowthSnapshot, parseGrowthPeriod } = await import("../../apps/admin/src/server/growth");
    const snapshot = await getGrowthSnapshot(parseGrowthPeriod({ period: "30d" }, now), now);
    expect(snapshot.trafficState).toBe("unavailable");
    expect(snapshot.visitors).toMatchObject({ value: null, state: "unavailable" });
    expect(snapshot.sessions).toMatchObject({ value: null, state: "unavailable" });
    expect(snapshot.landingPages).toBeNull();
    expect(snapshot.lifecycleState).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the documented aggregate response and keeps traffic separate from lifecycle events", async () => {
    vi.stubEnv("VERCEL_API_TOKEN", "server-only-test-token");
    vi.stubEnv("VERCEL_WEB_ANALYTICS_START_AT", "2026-09-25T09:00:00.000Z");
    const fetchMock = vi.fn<typeof fetch>(async (input, _init) => {
      void _init;
      const url = new URL(input.toString());
      const by = url.searchParams.get("by");
      if (url.pathname.endsWith("visits/count")) {
        if (url.searchParams.get("filter") === "requestPath eq '/waitlist'") return new Response(JSON.stringify({ data: { visitors: 9, pageviews: 12 } }), { status: 200 });
        return new Response(JSON.stringify({ data: { visitors: 20, pageviews: 37 } }), { status: 200 });
      }
      if (url.pathname.endsWith("events/count")) return new Response(JSON.stringify({ data: { count: 5 } }), { status: 200 });
      const result: Record<string, unknown[]> = {
        day: [{ timestamp: "2026-09-30T00:00:00.000Z", visitors: 20, pageviews: 37 }],
        requestPath: [{ requestPath: "/waitlist", visitors: 9, pageviews: 12 }],
        referrerHostname: [{ referrerHostname: "google.com", visitors: 7, pageviews: 13 }],
        utmSource: [{ utmSource: "newsletter", visitors: 4, pageviews: 8 }],
        utmMedium: [{ utmMedium: "email", visitors: 4, pageviews: 8 }],
        utmCampaign: [{ utmCampaign: "launch", visitors: 4, pageviews: 8 }],
      };
      return new Response(JSON.stringify({ data: result[by ?? ""] ?? [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getGrowthSnapshot, parseGrowthPeriod } = await import("../../apps/admin/src/server/growth");
    const snapshot = await getGrowthSnapshot(parseGrowthPeriod({ period: "7d" }, now), now);
    expect(snapshot).toMatchObject({ trafficState: "partial", visitors: { value: 20, state: "available" }, pageviews: { value: 37, state: "available" }, homepagePageviews: { value: 37, state: "available" }, earlyAccessVisitors: { value: 9, state: "available" }, applicationStarted: { value: 5, state: "available" }, utmState: "available", lifecycleState: "unavailable" });
    expect(snapshot.dailyTraffic).toEqual([{ date: "2026-09-30", visitors: 20, pageviews: 37 }]);
    expect(snapshot.referrers).toEqual([{ label: "google.com", visitors: 7, pageviews: 13, category: "Organic search" }]);
    expect(snapshot.utmSource).toEqual([{ label: "newsletter", visitors: 4, pageviews: 8 }]);
    expect(fetchMock.mock.calls.some(([input]) => new URL(input.toString()).pathname.endsWith("events/count"))).toBe(true);
    expect(snapshot.sessions.value).toBeNull();
    expect(snapshot.landingPages).toBeNull();
    expect(fetchMock.mock.calls.every(([, init]) => init?.cache === "no-store" && new Headers(init.headers).get("authorization") === "Bearer server-only-test-token")).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => new URL(input.toString()).searchParams.get("projectId") === "prj_sNTTM87CHOT6h5gLNz5g9r8fducu")).toBe(true);
  });

  it("marks unsupported UTM groupings unavailable instead of inventing zero-tagged traffic", async () => {
    vi.stubEnv("VERCEL_API_TOKEN", "server-only-test-token");
    vi.stubEnv("VERCEL_WEB_ANALYTICS_START_AT", "2026-09-01T00:00:00.000Z");
    const fetchMock = vi.fn<typeof fetch>(async (input, _init) => {
      void _init;
      const url = new URL(input.toString());
      if (url.pathname.endsWith("visits/count")) return new Response(JSON.stringify({ data: { visitors: 1, pageviews: 1 } }), { status: 200 });
      if (["utmSource", "utmMedium", "utmCampaign"].includes(url.searchParams.get("by") ?? "")) return new Response("unavailable", { status: 403 });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getGrowthSnapshot, parseGrowthPeriod } = await import("../../apps/admin/src/server/growth");
    const snapshot = await getGrowthSnapshot(parseGrowthPeriod({ period: "today" }, now), now);
    expect(snapshot.utmState).toBe("unavailable");
    expect(snapshot.utmSource).toBeNull();
  });
});
