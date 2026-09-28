import { describe, expect, it, vi } from "vitest";

import { createHash } from "node:crypto";
import { AppError } from "../../src/server/lib/errors";
import { WaitlistAdmissionService } from "../../src/server/modules/waitlist/waitlist-admission.service";
import type { WaitlistAdmissionRepository } from "../../src/server/modules/waitlist/waitlist-admission.repository";

vi.mock("server-only", () => ({}));

const applicationId = "11111111-1111-4111-8111-111111111111";
const inviteId = "22222222-2222-4222-8222-222222222222";
const admissionId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const workspaceId = "55555555-5555-4555-8555-555555555555";
const rawToken = "A".repeat(64);
const now = "2026-09-28T00:00:00.000Z";
const emailProvider = { send: vi.fn(async (_message: { to: string; subject: string; html: string; text: string }) => ({ ok: true as const, providerMessageId: null })) };

function repository(): WaitlistAdmissionRepository {
  return {
    issue: vi.fn(async ({ tokenHash }) => ({
      inviteId,
      waitlistApplicationId: applicationId,
      recipientEmail: "founder@example.com",
      firstName: "Founder",
      companyName: "Acme Labs",
      status: "issued" as const,
      issuedAt: now,
      expiresAt: "2026-10-05T00:00:00.000Z",
      reissued: Boolean(tokenHash),
    })),
    revoke: vi.fn(async () => ({ inviteId, status: "revoked", changed: true })),
    getStatus: vi.fn(async () => ({
      applicationStatus: "approved_for_invite",
      inviteStatus: "issued" as const,
      inviteExpiresAt: "2026-10-05T00:00:00.000Z",
      admissionStatus: "not_admitted" as const,
      admissionId: null,
      workspaceId: null,
      cohort: null,
      cohortNumber: null,
      cohortLimit: null,
      displayIdentity: null,
      benefitPolicyKey: null,
      benefitDiscountPercent: null,
      benefitDurationMonths: null,
      benefitStatus: null,
      onboardingStatus: null,
      admittedAt: null,
    })),
    accept: vi.fn(async ({ tokenHash, userId: acceptedUserId }) => ({
      admissionId,
      inviteId,
      waitlistApplicationId: applicationId,
      userId: acceptedUserId,
      workspaceId,
      cohort: "founding_25" as const,
      cohortNumber: 1,
      cohortLimit: 25,
      benefitPolicyKey: "founding_25_v1",
      benefitStatus: "eligible" as const,
      profileInitialized: true,
      onboardingStatus: "required" as const,
      admittedAt: now,
      idempotent: tokenHash.length === 64,
    })),
  };
}

describe("13A.5 admission service", () => {
  it("hashes opaque invite tokens before persistence and prepares a future email payload without sending", async () => {
    const repo = repository();
    const send = vi.fn();
    const service = new WaitlistAdmissionService({ repository: repo, randomToken: () => rawToken, emailProvider: { send } });

    const result = await service.issueInvite(applicationId, { requestOrigin: "https://wanterest.com" });

    expect(repo.issue).toHaveBeenCalledWith({ applicationId, tokenHash: createHash("sha256").update(rawToken).digest("hex"), actorUserId: null });
    expect(result.rawToken).toBe(rawToken);
    expect(result.emailPayload.inviteUrl).toContain("/invite/accept?token=");
    expect(result.emailPayload.inviteUrl).toContain(rawToken);
    expect(result.emailPayload.expiresAt).toBe("2026-10-05T00:00:00.000Z");
    expect(result.delivery).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("can explicitly send through the existing email port, without embedding a provider SDK", async () => {
    const repo = repository();
    const send = vi.fn(async (_message: { to: string; subject: string; html: string; text: string }) => ({ ok: true as const, providerMessageId: "provider-message" }));
    const service = new WaitlistAdmissionService({ repository: repo, randomToken: () => rawToken, emailProvider: { send } });

    const result = await service.issueInvite(applicationId, { sendEmail: true });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].to).toBe("founder@example.com");
    expect(result.delivery).toEqual({ ok: true, providerMessageId: "provider-message" });
  });

  it("hashes status tokens and returns the private admission read model", async () => {
    const repo = repository();
    const service = new WaitlistAdmissionService({ repository: repo, emailProvider });
    const status = await service.getPrivateStatus("B".repeat(40));

    expect(repo.getStatus).toHaveBeenCalledWith(createHash("sha256").update("B".repeat(40)).digest("hex"));
    expect(status.admissionStatus).toBe("not_admitted");
  });

  it("rejects malformed or unsafe origins and tokens", async () => {
    const service = new WaitlistAdmissionService({ repository: repository(), randomToken: () => rawToken, emailProvider });
    await expect(service.issueInvite(applicationId, { requestOrigin: "https://evil.example/path" })).rejects.toBeInstanceOf(AppError);
    await expect(service.acceptInvite("short", userId)).rejects.toBeInstanceOf(AppError);
  });

  it("passes the authenticated user identity to the authoritative admission operation", async () => {
    const repo = repository();
    const service = new WaitlistAdmissionService({ repository: repo, randomToken: () => rawToken, emailProvider });
    const result = await service.acceptInvite(rawToken, userId, "trace-13a5");

    expect(repo.accept).toHaveBeenCalledWith({ tokenHash: createHash("sha256").update(rawToken).digest("hex"), userId, traceId: "trace-13a5" });
    expect(result.workspaceId).toBe(workspaceId);
    expect(result.cohort).toBe("founding_25");
  });
});
