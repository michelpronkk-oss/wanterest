import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));

import { AppError } from "../../src/server/lib/errors";
import { WaitlistService } from "../../src/server/modules/waitlist/waitlist.service";
import type { WaitlistApplication, WaitlistRepository } from "../../src/server/modules/waitlist/waitlist.repository";

function application(overrides: Partial<WaitlistApplication> = {}): WaitlistApplication {
  return {
    id: "00000000-0000-0000-0000-000000000001", publicId: "00000000-0000-0000-0000-000000000002", earlyAccessNumber: null,
    email: "Michel@Company.com", normalizedEmail: "michel@company.com", firstName: "Michel", companyName: "Company", companyWebsite: null, roleTitle: null, useCase: "Understand demand", status: "pending", emailVerificationStatus: "pending", verifiedAt: null, withdrawnAt: null, source: "waitlist", utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null, referrerCategory: "direct", marketingConsent: false, transactionalEmailAllowed: true, convertedUserId: null, convertedWorkspaceId: null, createdAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z", ...overrides,
  };
}

function repository(): WaitlistRepository & { submitted: Array<Record<string, unknown>> } {
  const rows = new Map<string, WaitlistApplication>();
  const submitted: Array<Record<string, unknown>> = [];
  return {
    submitted,
    async submit(input) {
      submitted.push(input);
      const existing = rows.get(input.normalizedEmail);
      if (existing) return existing;
      const row = application({ email: input.email, normalizedEmail: input.normalizedEmail });
      rows.set(input.normalizedEmail, row);
      return row;
    },
    async verify() { return application({ status: "verified", emailVerificationStatus: "verified", earlyAccessNumber: 1, verifiedAt: "2026-09-27T00:00:00.000Z" }); },
    async getByStatusToken() { return application(); },
    async withdraw() { return application({ status: "withdrawn", withdrawnAt: "2026-09-27T00:00:00.000Z" }); },
    async listForReview() { return { rows: [], total: 0 }; },
    async transitionForReview() { return application({ status: "under_review" }); },
  };
}

const emailProvider = () => ({ send: vi.fn(async () => ({ ok: true as const, providerMessageId: "email-1" })) });

describe("waitlist service", () => {
  it("normalizes email, bounds input, and sends verification without finalizing a number", async () => {
    const repo = repository();
    const mail = emailProvider();
    const service = new WaitlistService({ repository: repo, emailProvider: mail, randomToken: (() => { let i = 0; return () => `token-${++i}-abcdefghijklmnopqrstuvwxyz0123456789`; })() });
    const result = await service.submit({ firstName: " Michel ", email: "Michel@Company.com", companyName: "Company", companyWebsite: "https://company.com", roleTitle: "Founder", useCase: "Understand demand", marketingConsent: false, honeypot: "", source: "waitlist" }, "https://www.wanterest.com");
    expect(result).toEqual({ accepted: true, message: "received", verificationDelivery: "sent" });
    expect(repo.submitted[0]).toMatchObject({ normalizedEmail: "michel@company.com", firstName: "Michel", companyWebsite: "https://company.com" });
    expect(mail.send).toHaveBeenCalledOnce();
    expect((await mail.send.mock.results[0]?.value)?.ok).toBe(true);
  });

  it("does not persist honeypot submissions", async () => {
    const repo = repository();
    const service = new WaitlistService({ repository: repo, emailProvider: emailProvider() });
    await expect(service.submit({ firstName: "Bot", email: "bot@example.com", companyName: "Bot", useCase: "spam", marketingConsent: false, honeypot: "filled" })).resolves.toMatchObject({ accepted: false, verificationDelivery: "not_required" });
    expect(repo.submitted).toHaveLength(0);
  });

  it("rejects malformed website URLs and unknown fields at the server boundary", async () => {
    const service = new WaitlistService({ repository: repository(), emailProvider: emailProvider() });
    await expect(service.submit({ firstName: "A", email: "a@example.com", companyName: "A", companyWebsite: "javascript:alert(1)", useCase: "Need insight", marketingConsent: false })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.submit({ firstName: "A", email: "a@example.com", companyName: "A", useCase: "Need insight", marketingConsent: false, unexpected: "x" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("never treats the sequential number as a status credential", async () => {
    const repo = repository();
    const service = new WaitlistService({ repository: repo, emailProvider: emailProvider() });
    await expect(service.status("0000000000000000000000000000000000000000000000000000000000000001")).resolves.toMatchObject({ id: application().id });
    await expect(service.status("1")).rejects.toBeInstanceOf(AppError);
  });

  it("keeps status credentials server-only after verification", async () => {
    const statusPage = readFileSync("src/app/waitlist/status/page.tsx", "utf8");
    const verifyRoute = readFileSync("src/app/waitlist/verify/route.ts", "utf8");
    const withdrawRoute = readFileSync("src/app/api/waitlist/withdraw/route.ts", "utf8");
    const withdrawButton = readFileSync("src/components/waitlist/waitlist-withdraw-button.tsx", "utf8");
    expect(statusPage).toContain("WAITLIST_STATUS_COOKIE");
    expect(statusPage).not.toContain("searchParams");
    expect(verifyRoute).toContain('response.headers.set("referrer-policy", "no-referrer")');
    expect(withdrawRoute).toContain("WAITLIST_STATUS_COOKIE");
    expect(withdrawButton).not.toContain("token");
  });
});
