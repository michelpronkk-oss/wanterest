import { describe, expect, it, vi, beforeEach } from "vitest";
import { AppError } from "@/server/lib/errors";
const handlers = vi.hoisted(() => ({ getWorkspacePublicCohortProfileQuery: vi.fn(), updateWorkspacePublicCohortProfileCommand: vi.fn() }));
vi.mock("@/server/modules/cohort-public", () => handlers);
import { GET, PATCH } from "@/app/api/workspaces/[workspaceId]/public-profile/route";
const workspace = "00000000-0000-4000-8000-000000000001";
const context = () => ({ params: Promise.resolve({ workspaceId: workspace }) });
beforeEach(() => { vi.clearAllMocks(); });

describe("private profile route cache and authorization handoff", () => {
  it("never caches private reads or writes and preserves independent consent inputs", async () => {
    const input = { publicSlug: "company", displayName: "Company", wallVisible: false, passVisible: true };
    handlers.getWorkspacePublicCohortProfileQuery.mockResolvedValue(input);
    handlers.updateWorkspacePublicCohortProfileCommand.mockResolvedValue(input);
    const read = await GET(new Request("https://example.com/api/profile"), context());
    const write = await PATCH(new Request("https://example.com/api/profile", { method: "PATCH", body: JSON.stringify(input) }), context());
    for (const response of [read, write]) expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(handlers.getWorkspacePublicCohortProfileQuery).toHaveBeenCalledWith(workspace);
    expect(handlers.updateWorkspacePublicCohortProfileCommand).toHaveBeenCalledWith(workspace, input, expect.any(String));
  });
  it("does not return a previous profile after permission loss", async () => {
    handlers.getWorkspacePublicCohortProfileQuery.mockResolvedValueOnce({ displayName: "Company" }).mockRejectedValueOnce(new AppError("FORBIDDEN", "Access denied"));
    const request = new Request("https://example.com/api/profile");
    expect((await GET(request, context())).status).toBe(200);
    const revoked = await GET(request, context());
    expect(revoked.status).toBe(403);
    expect(revoked.headers.get("cache-control")).toBe("private, no-store");
    expect(await revoked.text()).not.toContain("Company");
  });
  it("does not echo private URL input in validation errors", async () => {
    handlers.updateWorkspacePublicCohortProfileCommand.mockRejectedValue(new AppError("VALIDATION_ERROR", "Invalid public profile", 422, { issues: [{ input: "https://name:password@example.com/private" }] }));
    const response = await PATCH(new Request("https://example.com/api/profile", { method: "PATCH", body: "{}" }), context());
    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("password");
  });
});
