import { describe, expect, it, vi } from "vitest";

import { provisionOpenSignupCommand } from "../../src/server/modules/access";
import type { OpenAdmissionRepository } from "../../src/server/modules/access/open-admission.repository";

vi.mock("server-only", () => ({}));
vi.mock("../../src/server/modules/auth", () => ({ requireUser: vi.fn(async () => ({ id: "44444444-4444-4444-8444-444444444444" })) }));
vi.mock("../../src/server/modules/access/access-mode.service", () => ({ getProductAccessPolicy: vi.fn(async () => ({ mode: "open", publicSignupAllowed: true })) }));

const result = {
  admissionId: "33333333-3333-4333-8333-333333333333",
  userId: "44444444-4444-4444-8444-444444444444",
  workspaceId: "55555555-5555-4555-8555-555555555555",
  cohort: null,
  cohortNumber: null,
  cohortLimit: null,
  benefitPolicyKey: null,
  benefitStatus: null,
  profileInitialized: false,
  onboardingStatus: "required" as const,
  admittedAt: "2026-09-28T00:00:00.000Z",
  idempotent: false,
};

describe("13A.6 open admission seam", () => {
  it("derives the workspace slug and authenticated owner server-side", async () => {
    const provision = vi.fn(async (input: Parameters<OpenAdmissionRepository["provision"]>[0]) => { void input; return result; });
    const repository: OpenAdmissionRepository = { provision };
    const actual = await provisionOpenSignupCommand({ name: "Miche & Co. Research" }, undefined, repository);
    expect(actual).toEqual(result);
    expect(provision).toHaveBeenCalledWith(expect.objectContaining({
      userId: result.userId,
      name: "Miche & Co. Research",
      slug: "miche-co-research",
    }));
  });

  it("does not accept a client-selected source or owner identity", async () => {
    const provision = vi.fn(async (input: Parameters<OpenAdmissionRepository["provision"]>[0]) => { void input; return result; });
    const repository: OpenAdmissionRepository = { provision };
    await provisionOpenSignupCommand({ name: "Acme", slug: "attacker-owned", source: "waitlist_invite", userId: "99999999-9999-4999-8999-999999999999" }, undefined, repository);
    expect(provision.mock.calls[0]?.[0]).not.toHaveProperty("source");
    expect(provision.mock.calls[0]?.[0].userId).toBe(result.userId);
    expect(provision.mock.calls[0]?.[0].slug).toBe("acme");
  });
});
