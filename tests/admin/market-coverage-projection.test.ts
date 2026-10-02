import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../apps/admin/src/server/auth", () => ({ requireAdminPermission: vi.fn() }));
vi.mock("../../apps/admin/src/server/supabase", () => ({ createAdminServiceClient: vi.fn() }));

import { requireAdminPermission } from "../../apps/admin/src/server/auth";
import { createAdminServiceClient } from "../../apps/admin/src/server/supabase";

function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    vertical_key: "saas", market_key: "project-management", partition_key: `market_coverage_partition_v1:${"a".repeat(64)}`,
    source_family: "community_forum", evidence_role: "demand", geography_code: null, language_code: "en", surface_subtype: null,
    relevance_state: "relevant", availability_state: "active", rights_state: "permitted", coverage_state: "healthy",
    window_start: "2026-09-02T12:00:00.000Z", window_end: "2026-10-02T12:00:00.000Z",
    independent_roots: 8, provider_count: 2, provider_root_attributions: 9, duplicate_root_ratio: 0.111,
    max_provider_root_share: 0.666, duplicate_observations: 2, observed_source_items: 10,
    published_month_buckets: 2, roots_without_published_time: 0, distinct_geographies: 3,
    roots_without_geography: 1, interested_products: 4, latest_observed_at: "2026-10-02T11:00:00.000Z", ...overrides,
  };
}

describe("Admin Market Coverage Operations projection", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireAdminPermission).mockResolvedValue({} as never); });

  it("authorizes operations access before reading the aggregate RPC", async () => {
    const rpc = vi.fn(async () => ({ data: [summaryRow()], error: null }));
    vi.mocked(createAdminServiceClient).mockReturnValue({ rpc } as never);
    const { getMarketCoverageAdminSnapshot } = await import("../../apps/admin/src/server/market-coverage");
    const snapshot = await getMarketCoverageAdminSnapshot();
    expect(requireAdminPermission).toHaveBeenCalledWith("operations.read");
    expect(rpc).toHaveBeenCalledWith("market_coverage_summary_v1");
    expect(snapshot.state).toBe("available");
    expect(snapshot.rows?.[0].independent_roots).toBe(8);
  });

  it("does not query if authorization rejects", async () => {
    const rpc = vi.fn();
    vi.mocked(requireAdminPermission).mockRejectedValueOnce(new Error("denied"));
    vi.mocked(createAdminServiceClient).mockReturnValue({ rpc } as never);
    const { getMarketCoverageAdminSnapshot } = await import("../../apps/admin/src/server/market-coverage");
    await expect(getMarketCoverageAdminSnapshot()).rejects.toThrow("denied");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns unavailable instead of zeroes for missing migration/RPC or malformed output", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PGRST202", message: "private db detail" } }));
    vi.mocked(createAdminServiceClient).mockReturnValue({ rpc } as never);
    const { getMarketCoverageAdminSnapshot } = await import("../../apps/admin/src/server/market-coverage");
    const snapshot = await getMarketCoverageAdminSnapshot();
    expect(snapshot.state).toBe("unavailable");
    expect(snapshot.rows).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain("private db detail");
  });

  it("keeps empty data distinct from a measured zero for a configured family", async () => {
    vi.mocked(createAdminServiceClient).mockReturnValue({ rpc: vi.fn(async () => ({ data: [], error: null })) } as never);
    const { getMarketCoverageAdminSnapshot } = await import("../../apps/admin/src/server/market-coverage");
    expect((await getMarketCoverageAdminSnapshot()).state).toBe("empty");
  });

  it("accepts unknown-rights rows only with unavailable metrics left null", async () => {
    const unknown = summaryRow({
      rights_state: "unknown", coverage_state: "unknown", independent_roots: null, provider_count: null,
      provider_root_attributions: null, duplicate_root_ratio: null, max_provider_root_share: null,
      duplicate_observations: null, observed_source_items: null, published_month_buckets: null,
      roots_without_published_time: null, distinct_geographies: null, roots_without_geography: null,
      interested_products: null, latest_observed_at: null,
    });
    vi.mocked(createAdminServiceClient).mockReturnValue({ rpc: vi.fn(async () => ({ data: [unknown], error: null })) } as never);
    const { getMarketCoverageAdminSnapshot } = await import("../../apps/admin/src/server/market-coverage");
    const result = await getMarketCoverageAdminSnapshot();
    expect(result.rows?.[0].coverage_state).toBe("unknown");
    expect(result.rows?.[0].independent_roots).toBeNull();
  });
});
