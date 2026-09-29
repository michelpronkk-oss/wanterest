import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";
vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/modules/auth", () => auth);
import { createSupabaseCohortPublicRepository } from "@/server/modules/cohort-public/cohort-public.repository";
import { CohortPublicService } from "@/server/modules/cohort-public/cohort-public.service";

const workspace = "00000000-0000-4000-8000-000000000001";
const publicRow = { public_slug: "company", display_name: "Company", logo_url: "https://example.com/logo?token=value", avatar_url: "https://name:password@example.com/avatar", website_url: "https://private.local/account", monogram: "C", headline: null, cohort: "founding_25", cohort_number: 1, cohort_limit: 25, assigned_at: "2026-09-28T00:00:00.000Z", workspace_id: workspace, provider_payload: { private: true } };
function adapter(data: unknown, error: { code: string; message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const repository = createSupabaseCohortPublicRepository({ rpc } as unknown as SupabaseClient<Database>);
  return { rpc, repository, service: new CohortPublicService(repository) };
}
beforeEach(() => { auth.requireUser.mockReset().mockResolvedValue({ id: "authorized-owner" }); });

describe("public profile authority boundaries (mocked RPC, not SQL runtime proof)", () => {
  it("cleans direct RPC data before wall/pass DTOs leave the repository", async () => {
    const { repository } = adapter([publicRow]);
    const wall = await repository.getPublicWall("founding_25");
    const pass = await repository.getPublicProfile("company");
    expect(wall[0]).toEqual(pass);
    expect(pass).toMatchObject({ logoUrl: null, avatarUrl: null, websiteUrl: null, number: 1 });
    expect(JSON.stringify(wall)).not.toMatch(/password|token=value|workspace_id|provider_payload|private.local/);
  });
  it.each([[false, false], [true, false], [false, true], [true, true]])("keeps explicit wall/pass consent independent: %s / %s", async (wall, pass) => {
    const { service, rpc } = adapter([{ ...publicRow, profile_id: "00000000-0000-4000-8000-000000000002", wall_visible: wall, pass_visible: pass }]);
    const profile = await service.updatePrivateProfile(workspace, { publicSlug: "company", displayName: "Company", wallVisible: wall, passVisible: pass });
    expect(profile).toMatchObject({ workspaceId: workspace, wallVisible: wall, passVisible: pass });
    expect(rpc).toHaveBeenCalledWith("upsert_workspace_public_cohort_profile", expect.objectContaining({ p_workspace_id: workspace, p_wall_visible: wall, p_pass_visible: pass }));
  });
  it("rejects unsafe input before persistence and does not forward invalid workspace IDs", async () => {
    const { service, rpc } = adapter([]);
    await expect(service.updatePrivateProfile(workspace, { publicSlug: "company", displayName: "Company", websiteUrl: "https://example.com/login?code=value" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.getPrivateProfile("not-a-uuid")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.updatePrivateProfile(workspace, { publicSlug: "company", displayName: "Company", cohort: "founding_25", number: 1, workspaceId: "00000000-0000-4000-8000-000000000003" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("stops unauthenticated mutations before RPC access", async () => {
    const { service, rpc } = adapter([]);
    auth.requireUser.mockRejectedValue(new Error("Authentication required"));
    await expect(service.updatePrivateProfile(workspace, { publicSlug: "company", displayName: "Company" })).rejects.toThrow("Authentication required");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("propagates SQL cross-workspace/owner denial safely on repeated requests", async () => {
    const { service, rpc } = adapter(null, { code: "42501", message: "public_cohort_profile_access_denied" });
    for (let request = 0; request < 2; request++) await expect(service.getPrivateProfile(workspace)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("get_workspace_public_cohort_profile", { p_workspace_id: workspace });
  });
});
