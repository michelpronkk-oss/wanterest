import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { WaitlistService } from "../../src/server/modules/waitlist/waitlist.service";
import type { WaitlistReferralRepository } from "../../src/server/modules/waitlist/referral.repository";
import type { WaitlistApplication, WaitlistRepository } from "../../src/server/modules/waitlist/waitlist.repository";

function application(overrides: Partial<WaitlistApplication> = {}): WaitlistApplication {
  return {
    id: "00000000-0000-0000-0000-000000000001", publicId: "00000000-0000-0000-0000-000000000002", earlyAccessNumber: null,
    email: "person@example.com", normalizedEmail: "person@example.com", firstName: "Person", companyName: "Company", companyWebsite: null, roleTitle: null, useCase: "Understand demand", status: "pending", emailVerificationStatus: "pending", verifiedAt: null, withdrawnAt: null, source: "waitlist", utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null, referrerCategory: "direct", marketingConsent: false, transactionalEmailAllowed: true, convertedUserId: null, convertedWorkspaceId: null, createdAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z", ...overrides,
  };
}

function waitlistRepository(result: WaitlistApplication): WaitlistRepository & { submitted: Array<Record<string, unknown>> } {
  const submitted: Array<Record<string, unknown>> = [];
  return {
    submitted,
    async submit(input) { submitted.push(input); return application({ email: input.email, normalizedEmail: input.normalizedEmail }); },
    async verify() { return result; },
    async getByStatusToken() { return result; },
    async withdraw() { return result; },
    async listForReview() { return { rows: [], total: 0 }; },
    async transitionForReview() { return result; },
  };
}

function referralRepository(overrides: Partial<WaitlistReferralRepository> = {}): WaitlistReferralRepository {
  return {
    getStatus: vi.fn(async () => ({ referralCode: "A".repeat(40), verifiedCount: 2, priorityStatus: "normal" as const, priorityGrantedAt: null })),
    invalidate: vi.fn(async () => undefined),
    revokePriority: vi.fn(async () => undefined),
    ...overrides,
  };
}

const emailProvider = { send: vi.fn(async () => ({ ok: true as const, providerMessageId: "email-1" })) };

describe("referral and priority waitlist integration", () => {
  it("passes the referral code through submission and processes only after verification", async () => {
    const referral = referralRepository();
    const verified = application({ emailVerificationStatus: "verified", status: "verified", earlyAccessNumber: 2, verifiedAt: "2026-09-27T00:00:00.000Z" });
    const repo = waitlistRepository(verified);
    const service = new WaitlistService({ repository: repo, referralRepository: referral, emailProvider });

    await service.submit({ firstName: "Person", email: "person@example.com", companyName: "Company", useCase: "Understand demand", marketingConsent: false, referralCode: "A".repeat(40) });
    expect(repo.submitted[0]).toMatchObject({ referralCode: "A".repeat(40) });
    await expect(service.verify("a".repeat(40))).resolves.toEqual(verified);
  });

  it("exposes referral progress only through the private verified status path", async () => {
    const verified = application({ emailVerificationStatus: "verified", status: "verified", earlyAccessNumber: 2, verifiedAt: "2026-09-27T00:00:00.000Z" });
    const referral = referralRepository();
    const service = new WaitlistService({ repository: waitlistRepository(verified), referralRepository: referral, emailProvider });

    await expect(service.statusWithReferral("a".repeat(40), "https://wanterest.com")).resolves.toMatchObject({
      application: verified,
      referral: {
        shareUrl: "https://wanterest.com/r/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        verifiedCount: 2,
        threshold: 3,
        remainingCount: 1,
        priorityStatus: "normal",
        priorityUnlocked: false,
      },
    });
    expect(referral.getStatus).toHaveBeenCalledWith(verified.id);
  });

  it("keeps the existing private waitlist status available if referral read state is unavailable", async () => {
    const verified = application({ emailVerificationStatus: "verified", status: "verified", earlyAccessNumber: 2, verifiedAt: "2026-09-27T00:00:00.000Z" });
    const referral = referralRepository({ getStatus: vi.fn(async () => { throw new Error("temporary database failure"); }) });
    const service = new WaitlistService({ repository: waitlistRepository(verified), referralRepository: referral, emailProvider });

    await expect(service.statusWithReferral("a".repeat(40))).resolves.toEqual({ application: verified, referral: null });
  });

});
