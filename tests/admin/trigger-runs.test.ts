import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Trigger production run read", () => {
  it("does not query production with a development-scoped key", async () => {
    vi.stubEnv("TRIGGER_SECRET_KEY", "tr_dev_sk_test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getTriggerRunsSnapshot } = await import("../../apps/admin/src/server/trigger-runs");
    const result = await getTriggerRunsSnapshot();
    expect(result).toMatchObject({ state: "unavailable", runs: null, routingRuns: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads only the documented production runs endpoint and returns a sanitized projection", async () => {
    vi.stubEnv("TRIGGER_SECRET_KEY", "tr_prod_sk_server-test");
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ data: [{ id: "run_1", taskIdentifier: "match-refreshed-partition", status: "FAILED", createdAt: "2026-09-29T12:00:00Z", finishedAt: "2026-09-29T12:00:05Z", durationMs: 5000, version: "20260927.11", output: "private payload" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { getTriggerRunsSnapshot } = await import("../../apps/admin/src/server/trigger-runs");
    const result = await getTriggerRunsSnapshot();
    expect(result.state).toBe("available");
    expect(result.runs?.[0]).toEqual({ id: "run_1", taskIdentifier: "match-refreshed-partition", status: "FAILED", createdAt: "2026-09-29T12:00:00Z", finishedAt: "2026-09-29T12:00:05Z", durationMs: 5000, version: "20260927.11" });
    expect(result.routingRuns?.[0]?.id).toBe("run_1");
    expect(JSON.stringify(result)).not.toContain("private payload");
    expect(fetchMock.mock.calls[0]?.[0]?.toString()).toContain("api.trigger.dev/api/v1/runs");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", headers: { Authorization: "Bearer tr_prod_sk_server-test" } });
  });
});
