import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../apps/admin/src/server/auth", () => ({ requireAdminPermission: vi.fn() }));
vi.mock("../../apps/admin/src/server/search-console/snapshot", () => ({ getSearchConsoleSnapshot: vi.fn() }));

import { requireAdminPermission } from "../../apps/admin/src/server/auth";
import { getSearchConsoleSnapshot } from "../../apps/admin/src/server/search-console/snapshot";
import { getAuthorizedSearchConsoleSnapshot } from "../../apps/admin/src/server/search-console/authorized";

describe("Search Console authorization boundary", () => {
  it("requires the existing analytics.read Admin permission before provider access", async () => {
    vi.mocked(requireAdminPermission).mockRejectedValue(new Error("denied"));
    await expect(getAuthorizedSearchConsoleSnapshot()).rejects.toThrow("denied");
    expect(requireAdminPermission).toHaveBeenCalledWith("analytics.read");
    expect(getSearchConsoleSnapshot).not.toHaveBeenCalled();
  });

  it("calls the provider only after Admin authorization succeeds", async () => {
    vi.mocked(requireAdminPermission).mockResolvedValue({ userId: "admin-user", role: "read_only_analyst", roleLabel: "Read-only Analyst", initials: "RA" });
    vi.mocked(getSearchConsoleSnapshot).mockResolvedValue({ state: "not_configured" } as never);
    const result = await getAuthorizedSearchConsoleSnapshot();
    expect(result.context.role).toBe("read_only_analyst");
    expect(getSearchConsoleSnapshot).toHaveBeenCalledOnce();
  });
});
