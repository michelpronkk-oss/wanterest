import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSearchConsoleSetup, SearchConsoleProviderError } from "../../apps/admin/src/server/search-console/google";

const credentials = {
  SEARCH_CONSOLE_OAUTH_CLIENT_ID: "test-client.apps.googleusercontent.com",
  SEARCH_CONSOLE_OAUTH_CLIENT_SECRET: "fixture-client-secret",
  SEARCH_CONSOLE_OAUTH_REFRESH_TOKEN: "fixture-refresh-token",
};

afterEach(() => vi.unstubAllEnvs());

describe("Google Search Console provider", () => {
  it("returns not configured without any credentials and does not call Google", () => {
    const fetcher = vi.fn();
    const result = createSearchConsoleSetup({ environment: {}, fetcher });
    expect(result).toEqual({ state: "not_configured", reason: expect.any(String) });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not use credentials in Vercel Preview", () => {
    const fetcher = vi.fn();
    const result = createSearchConsoleSetup({
      environment: { ...credentials, VERCEL: "1", VERCEL_ENV: "preview" },
      fetcher,
    });
    expect(result.state).toBe("not_configured");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("treats partial credentials as unavailable without exposing their contents", () => {
    const result = createSearchConsoleSetup({
      environment: { SEARCH_CONSOLE_OAUTH_CLIENT_ID: "private-client-name" },
    });
    expect(result.state).toBe("unavailable");
    if (result.state === "unavailable") {
      expect(result.reason).not.toContain("private-client-name");
      expect(result.reason).not.toContain("fixture");
    }
  });

  it("uses OAuth refresh authorization, verifies the fixed property, normalizes paired keys, and caches access for this request", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === "https://oauth2.googleapis.com/token") {
        const form = new URLSearchParams(String(init?.body));
        expect(form.get("grant_type")).toBe("refresh_token");
        expect(form.get("client_id")).toBe(credentials.SEARCH_CONSOLE_OAUTH_CLIENT_ID);
        expect(form.get("client_secret")).toBe(credentials.SEARCH_CONSOLE_OAUTH_CLIENT_SECRET);
        expect(form.get("refresh_token")).toBe(credentials.SEARCH_CONSOLE_OAUTH_REFRESH_TOKEN);
        return Response.json({ access_token: "request-only-access-token" });
      }
      if (url.endsWith("/sites/sc-domain%3Awanterest.com")) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer request-only-access-token");
        return Response.json({ permissionLevel: "siteRestrictedUser" });
      }
      const body = JSON.parse(String(init?.body)) as { dimensions?: string[]; dataState: string };
      expect(body.dataState).toBe("all");
      return Response.json({
        rows: [{ keys: ["phrase with · delimiter", "https://www.wanterest.com/product"], clicks: 3, impressions: 30, ctr: 0.1, position: 5 }],
        metadata: { firstIncompleteDate: "2026-09-29" },
      });
    });

    const setup = createSearchConsoleSetup({ environment: credentials, fetcher });
    expect(setup.state).toBe("configured");
    if (setup.state !== "configured") return;

    await setup.provider.verifyProperty();
    const result = await setup.provider.query({
      startDate: "2026-09-01",
      endDate: "2026-09-28",
      dimensions: ["query", "page"],
      dataState: "all",
    });

    expect(calls.filter((call) => call.url === "https://oauth2.googleapis.com/token")).toHaveLength(1);
    expect(calls[0]?.init?.cache).toBe("no-store");
    expect(result.rows).toEqual([expect.objectContaining({
      key: JSON.stringify(["phrase with · delimiter", "https://www.wanterest.com/product"]),
      clicks: 3,
      impressions: 30,
      ctr: 0.1,
      position: 5,
    })]);
    expect(result.firstIncompleteDate).toBe("2026-09-29");
  });

  it("rejects malformed metric rows instead of converting them to an empty response", async () => {
    const fetcher: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "temporary-token" });
      if (url.endsWith("/sites/sc-domain%3Awanterest.com")) return Response.json({ permissionLevel: "siteRestrictedUser" });
      return Response.json({ rows: [{ keys: ["one query"], clicks: 1, impressions: "unknown", ctr: 0, position: 4 }] });
    });
    const setup = createSearchConsoleSetup({ environment: credentials, fetcher });
    if (setup.state !== "configured") throw new Error("expected configured provider");
    await expect(setup.provider.query({ startDate: "2026-09-01", endDate: "2026-09-28", dimensions: ["query"], dataState: "final" }))
      .rejects.toThrow("invalid metrics");
  });
  it("requires Restricted property access", async () => {
    const fetcher: typeof fetch = vi.fn(async (input) => String(input) === "https://oauth2.googleapis.com/token"
      ? Response.json({ access_token: "temporary-token" })
      : Response.json({ permissionLevel: "siteFullUser" }));
    const setup = createSearchConsoleSetup({ environment: credentials, fetcher });
    if (setup.state !== "configured") throw new Error("expected configured provider");
    await expect(setup.provider.verifyProperty()).rejects.toThrow("must have Restricted access");
  });

  it("sanitizes Google error bodies and never returns credential values", async () => {
    const fetcher: typeof fetch = vi.fn(async (input) => String(input) === "https://oauth2.googleapis.com/token"
      ? Response.json({ access_token: "temporary-token" })
      : new Response(JSON.stringify({ error: "fixture-client-secret private-search-phrase" }), { status: 403 }));
    const setup = createSearchConsoleSetup({ environment: credentials, fetcher });
    if (setup.state !== "configured") throw new Error("expected configured provider");
    let caught: unknown;
    try { await setup.provider.verifyProperty(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(SearchConsoleProviderError);
    const message = (caught as Error).message;
    expect(message).toContain("Restricted access");
    expect(message).not.toContain("fixture-client-secret");
    expect(message).not.toContain("private-search-phrase");
  });
});
