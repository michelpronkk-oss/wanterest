import { vi } from "vitest";

vi.mock("server-only", () => ({}));

import { describe, expect, it } from "vitest";

import { CohortPublicService } from "@/server/modules/cohort-public/cohort-public.service";
import { derivePublicMonogram, normalizePublicSlug, type PublicCohortRow } from "@/server/modules/cohort-public/cohort-public.schemas";
import type { CohortPublicRepository } from "@/server/modules/cohort-public/cohort-public.repository";

const row: PublicCohortRow = {
  publicSlug: "auterim",
  displayName: "Auterim",
  logoUrl: null,
  avatarUrl: null,
  monogram: "AU",
  headline: "A public member",
  websiteUrl: "https://auterim.example",
  cohort: "founding_25",
  number: 7,
  limit: 25,
  assignedAt: "2026-09-28T00:00:00.000Z",
};

function repository(overrides: Partial<CohortPublicRepository> = {}): CohortPublicRepository {
  return {
    getPublicWall: async () => [],
    getPublicProfile: async () => null,
    getPrivateProfile: async () => null,
    upsertProfile: async () => ({ ...row, profileId: "00000000-0000-4000-8000-000000000001", workspaceId: "00000000-0000-4000-8000-000000000002", wallVisible: false, passVisible: false }),
    initializeProfile: async () => ({ ...row, profileId: "00000000-0000-4000-8000-000000000001", workspaceId: "00000000-0000-4000-8000-000000000002", wallVisible: false, passVisible: false }),
    ...overrides,
  };
}

describe("13A.4 public cohort profile contract", () => {
  it("normalizes only safe ASCII slugs and rejects reserved routes", () => {
    expect(normalizePublicSlug("  Auterim Labs  ")).toBe("auterim-labs");
    expect(normalizePublicSlug("Ünicode / Name")).toBe("nicode-name");
    const service = new CohortPublicService(repository({ getPublicProfile: async () => row }));
    return expect(service.getPublicPass("api")).resolves.toBeNull();
  });

  it("derives a stable display-safe monogram without creating assets", () => {
    expect(derivePublicMonogram("Acme Labs")).toBe("AL");
    expect(derivePublicMonogram("Auterim")).toBe("AU");
    expect(derivePublicMonogram("   ")).toBe("WN");
  });

  it("returns only the authoritative public projection and canonical URL", async () => {
    const service = new CohortPublicService(repository({ getPublicProfile: async () => row }));
    await expect(service.getPublicPass("auterim")).resolves.toMatchObject({
      publicSlug: "auterim",
      cohort: "founding_25",
      number: 7,
      canonicalUrl: expect.stringContaining("/members/auterim"),
    });
  });

  it("keeps the empty wall a valid result", async () => {
    const service = new CohortPublicService(repository());
    await expect(service.getWalls()).resolves.toEqual({ founding: [], early: [] });
  });

});
