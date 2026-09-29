import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("../../apps/admin/src/server/supabase", () => ({
  createAdminSessionClient: vi.fn(),
  createAdminServiceClient: vi.fn(),
}));
vi.mock("../../apps/admin/src/server/request", () => ({ isAdminHostnameRequest: vi.fn(async () => true) }));

import { createAdminServiceClient, createAdminSessionClient } from "../../apps/admin/src/server/supabase";

const userId = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(() => ({ membership: null as null | { role: string }, aal: "aal2" as string }));

function configureAuth() {
  const session = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: userId, user_metadata: { role: "founder" } } }, error: null })),
      mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: mocks.aal }, error: null })) },
    },
  };
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: mocks.membership, error: null })),
  };
  vi.mocked(createAdminSessionClient).mockResolvedValue(session as never);
  vi.mocked(createAdminServiceClient).mockReturnValue({ from: vi.fn(() => query) } as never);
}

describe("admin server authorization", () => {
  beforeEach(() => {
    mocks.membership = null;
    mocks.aal = "aal2";
    vi.clearAllMocks();
  });

  it("does not let editable user metadata grant admin membership", async () => {
    configureAuth();
    const { getAdminContext } = await import("../../apps/admin/src/server/auth");
    await expect(getAdminContext()).resolves.toBeNull();
  });

  it("requires MFA assurance for an active admin membership", async () => {
    mocks.membership = { role: "founder" };
    mocks.aal = "aal1";
    configureAuth();
    const { getAdminContext } = await import("../../apps/admin/src/server/auth");
    await expect(getAdminContext()).rejects.toThrow("REDIRECT:/mfa-required");
  });

  it("enforces role permissions on the server", async () => {
    mocks.membership = { role: "support" };
    configureAuth();
    const { requireAdminPermission } = await import("../../apps/admin/src/server/auth");
    await expect(requireAdminPermission("operations.read")).rejects.toThrow("REDIRECT:/forbidden");
  });

  it("keeps every initial role read-only, including the founder role", async () => {
    mocks.membership = { role: "founder" };
    configureAuth();
    const { requireAdminPermission } = await import("../../apps/admin/src/server/auth");
    await expect(requireAdminPermission("operations.read")).resolves.toMatchObject({ role: "founder" });
    await expect(requireAdminPermission("lifecycle.review")).rejects.toThrow("REDIRECT:/forbidden");
    await expect(requireAdminPermission("admission.manage")).rejects.toThrow("REDIRECT:/forbidden");
    await expect(requireAdminPermission("share_cards.manage")).rejects.toThrow("REDIRECT:/forbidden");
    await expect(requireAdminPermission("incidents.recover")).rejects.toThrow("REDIRECT:/forbidden");
  });
});
