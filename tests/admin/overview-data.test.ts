import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../apps/admin/src/server/supabase", () => ({ createAdminServiceClient: vi.fn(() => null) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("read-only admin data contracts", () => {
  it("represents missing lifecycle data as unavailable rather than zero", async () => {
    const { getOverviewMetrics } = await import("../../apps/admin/src/server/overview");
    const snapshot = await getOverviewMetrics(new Date("2026-09-29T12:00:00.000Z"));
    expect(snapshot.metrics).toHaveLength(7);
    expect(snapshot.metrics.every((metric) => metric.value === null && metric.state === "unavailable")).toBe(true);
  });

  it("does not show fabricated visitor or pageview counts without server API access", async () => {
    vi.stubEnv("VERCEL_API_TOKEN", "");
    const { getWebAnalyticsSnapshot } = await import("../../apps/admin/src/server/vercel-analytics");
    const snapshot = await getWebAnalyticsSnapshot(new Date("2026-09-29T12:00:00.000Z"));
    expect(snapshot).toMatchObject({ state: "unavailable", pageviews: null, visitors: null, refreshedAt: null });
  });

  it("uses the documented Vercel API count response and labels it as traffic only", async () => {
    vi.stubEnv("VERCEL_API_TOKEN", "server-test-token");
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ data: { pageviews: 12, visitors: 8 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { getWebAnalyticsSnapshot } = await import("../../apps/admin/src/server/vercel-analytics");
    const snapshot = await getWebAnalyticsSnapshot(new Date("2026-09-29T12:00:00.000Z"));
    expect(snapshot).toMatchObject({ state: "available", pageviews: 12, visitors: 8 });
    expect(snapshot.detail).toContain("independently");
    expect(fetchMock.mock.calls[0]?.[0]?.toString()).toContain("prj_sNTTM87CHOT6h5gLNz5g9r8fducu");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", headers: { Authorization: "Bearer server-test-token" } });
  });

  it("refuses to inspect referrals through the side-effecting status RPC", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile("apps/admin/src/server/early-access.ts", "utf8"));
    expect(source).toContain('from("waitlist_referrals")');
    expect(source).toContain('from("waitlist_priority_access")');
    expect(source).not.toContain(".rpc(");
  });
});
