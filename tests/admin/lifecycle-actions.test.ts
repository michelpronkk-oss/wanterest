import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  assertHostname: vi.fn(),
  rpc: vi.fn(),
  sendEmail: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
vi.mock("@admin/server/auth", () => ({ requireAdminPermission: state.requirePermission }));
vi.mock("@admin/server/request", () => ({ assertAdminHostnameRequest: state.assertHostname }));
vi.mock("@admin/server/supabase", () => ({ createAdminServiceClient: () => ({ rpc: state.rpc }) }));
vi.mock("@/server/providers/email", () => ({ getEmailProvider: () => ({ send: state.sendEmail }) }));
vi.mock("@/server/modules/waitlist/waitlist-emails", () => ({ invitationEmail: (input: { inviteUrl: string }) => ({ subject: "Invitation", html: "<p>Invitation</p>", text: input.inviteUrl }) }));
vi.mock("@/shared/config/site", () => ({ SITE_ORIGIN: "https://wanterest.com" }));

const applicationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const inviteId = "33333333-3333-4333-8333-333333333333";

function formData(action: string, overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ applicationId, inviteId: "", action, reason: "", requestId: "44444444-4444-4444-8444-444444444444", confirm: "yes", ...overrides })) data.set(key, value);
  return data;
}

async function expectRedirect(promise: Promise<never>, pathname: string) {
  await expect(promise).rejects.toThrow(`REDIRECT:${pathname}`);
}

describe("Admin Early Access server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.requirePermission.mockResolvedValue({ userId: actorId, role: "founder" });
    state.assertHostname.mockResolvedValue(undefined);
    state.sendEmail.mockResolvedValue({ ok: true, providerMessageId: "provider-message" });
  });

  it("checks production Admin hostname and lifecycle.write before a database call", async () => {
    state.requirePermission.mockRejectedValue(new Error("membership or AAL2 required"));
    const { applyEarlyAccessAction } = await import("../../apps/admin/src/server/lifecycle-actions");
    await expect(applyEarlyAccessAction(formData("approve"))).rejects.toThrow("membership or AAL2 required");
    expect(state.assertHostname).toHaveBeenCalledOnce();
    expect(state.requirePermission).toHaveBeenCalledWith("lifecycle.write");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("rejects unconfirmed or malformed actions before reaching the mutation RPC", async () => {
    const { applyEarlyAccessAction } = await import("../../apps/admin/src/server/lifecycle-actions");
    await expectRedirect(applyEarlyAccessAction(formData("approve", { confirm: "no" })), "/early-access?result=invalid");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("uses the canonical lifecycle wrapper and reports invalid state without retrying another path", async () => {
    state.rpc.mockResolvedValue({ data: { ok: false, idempotent: false, status: "declined" }, error: null });
    const { applyEarlyAccessAction } = await import("../../apps/admin/src/server/lifecycle-actions");
    await expectRedirect(applyEarlyAccessAction(formData("approve")), `/early-access/${applicationId}?result=invalid-transition`);
    expect(state.rpc).toHaveBeenCalledOnce();
    expect(state.rpc.mock.calls[0]?.[0]).toBe("admin_transition_waitlist_application");
    expect(state.rpc.mock.calls[0]?.[1]).toMatchObject({ p_application_id: applicationId, p_actor_user_id: actorId, p_action: "approve" });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("does not re-send an idempotent invite issuance whose one-time token is no longer available", async () => {
    state.rpc.mockResolvedValue({ data: { ok: true, idempotent: true }, error: null });
    const { applyEarlyAccessAction } = await import("../../apps/admin/src/server/lifecycle-actions");
    await expectRedirect(applyEarlyAccessAction(formData("send")), `/early-access/${applicationId}?result=already-recorded`);
    expect(state.rpc).toHaveBeenCalledOnce();
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("hashes the one-time invite token and returns no recipient, token, or credential in the redirect", async () => {
    state.rpc
      .mockResolvedValueOnce({ data: { ok: true, idempotent: false, inviteId, expiresAt: "2026-10-07T12:00:00.000Z", recipientEmail: "person@example.com", firstName: "Ari", companyName: "Acme" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const { applyEarlyAccessAction } = await import("../../apps/admin/src/server/lifecycle-actions");
    await expectRedirect(applyEarlyAccessAction(formData("send")), `/early-access/${applicationId}?result=sent`);
    const issue = state.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(issue.p_actor_user_id).toBe(actorId);
    expect(issue.p_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(issue.p_token_hash).not.toContain("person@example.com");
    expect(state.sendEmail).toHaveBeenCalledOnce();
    expect(state.sendEmail.mock.calls[0]?.[0]).toMatchObject({ to: "person@example.com", subject: "Invitation" });
    expect(state.sendEmail.mock.calls[0]?.[0].text).toContain("/invite/accept?token=");
    expect(state.rpc.mock.calls[1]?.[0]).toBe("admin_record_invite_delivery");
    expect(state.rpc.mock.calls[1]?.[1]).toMatchObject({ p_invite_id: inviteId, p_actor_user_id: actorId, p_delivery_state: "sent" });
  });

  it("contains no logging of action payloads or provider secrets", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile("apps/admin/src/server/lifecycle-actions.ts", "utf8"));
    expect(source).not.toMatch(/console\.(?:log|info|warn|error)\s*\(/);
    expect(source).not.toContain("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY");
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY=");
  });
});
