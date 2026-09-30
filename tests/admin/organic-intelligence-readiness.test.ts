import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../apps/admin/src/server/supabase", () => ({ createAdminServiceClient: vi.fn() }));

import { createAdminServiceClient } from "../../apps/admin/src/server/supabase";
import { getOrganicReadinessSourceStatus } from "../../apps/admin/src/server/organic-intelligence-readiness";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function summary(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    refreshedAt: "2026-09-30T10:00:00.000Z",
    sourcePolicyStates: { unknown: 6 },
    sourceFamilies: { community_discussion: 2, social_platform: 2, developer_community: 1, video_comments: 1 },
    topicStates: {},
    publicEvidenceRecordCount: 0,
    verifiedEpisodeCount: 0,
    authorUnavailableCount: 0,
    episodeFamilies: {},
    episodeFirstPublishedAt: null,
    episodeLatestObservedAt: null,
    candidateCount: 0,
    candidateReviewStates: {},
    candidateEligibilityStates: {},
    candidateFamilies: {},
    maturityStates: {},
    blockerDistribution: {},
    staleCount: 0,
    mergedDuplicateCount: 0,
    averageSourceConcentration: null,
    maximumViralEventConcentration: null,
    lastEvaluatedAt: null,
    reviewEventCount: 0,
    candidates: [],
    ...overrides,
  };
}

describe("private Organic Intelligence readiness surface", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires existing Admin permission, renders dynamically, and does not add publication controls", () => {
    const page = read("apps/admin/src/app/publication-readiness/page.tsx");
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain('requireAdminPermission("operations.summary.read")');
    expect(page).toContain('<ConsoleShell context={context} active="/publication-readiness">');
    expect(page).not.toContain('"use client"');
    expect(page).not.toMatch(/publish now|auto.?publish|publish candidate/i);
    expect(read("src/app/admin-internal/publication-readiness/page.tsx"))
      .toContain('export { default } from "@admin/app/publication-readiness/page"');
  });

  it("returns unavailable rather than sample metrics when the migration or private service is unavailable", async () => {
    vi.mocked(createAdminServiceClient).mockReturnValue(null);
    await expect(getOrganicReadinessSourceStatus()).resolves.toMatchObject({
      state: "unavailable", candidateCount: null, summary: null, publicationEnabled: false,
    });
    const rpc = vi.fn(async () => ({ data: null, error: { code: "42883" } }));
    vi.mocked(createAdminServiceClient).mockReturnValue({ rpc } as never);
    await expect(getOrganicReadinessSourceStatus()).resolves.toMatchObject({ state: "unavailable", candidateCount: null });
  });

  it("shows exact zero values when a connected feed has no approved policies or candidates", async () => {
    vi.mocked(createAdminServiceClient).mockReturnValue({ rpc: vi.fn(async () => ({ data: summary(), error: null })) } as never);
    const result = await getOrganicReadinessSourceStatus();
    expect(result).toMatchObject({ state: "empty", candidateCount: 0, refreshedAt: "2026-09-30T10:00:00.000Z", publicationEnabled: false });
    expect(result.detail).toContain("No source policy is approved for measurement");
  });

  it("renders exact live candidate and blocker data through a strict summary schema", async () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      publicIntelligenceId: "33333333-3333-4333-8333-333333333333",
      label: "Approved global topic",
      family: "demand_opportunity",
      reviewState: "eligible",
      eligibilityState: "eligible",
      maturityState: "persistent",
      independentEpisodeCount: 8,
      uniqueAuthorCount: 6,
      sourceFamilyCount: 4,
      timeBucketCount: 4,
      duplicateRatio: 0,
      sourceConcentration: 0.25,
      viralEventConcentration: 0,
      firstObservedAt: "2026-01-01T12:00:00.000Z",
      lastObservedAt: "2026-04-02T12:00:00.000Z",
      freshnessState: "fresh",
      truthState: "confirmed",
      safetyState: "approved",
      searchConsolePriority: "search_opportunity",
      blockerCodes: [],
      evaluatedAt: "2026-04-03T00:00:00.000Z",
      provenanceEpisodeRefs: ["22222222-2222-4222-8222-222222222222"],
    };
    vi.mocked(createAdminServiceClient).mockReturnValue({ rpc: vi.fn(async () => ({ data: summary({
      sourcePolicyStates: { approved: 1, restricted: 1, unknown: 4 },
      publicEvidenceRecordCount: 8,
      verifiedEpisodeCount: 8,
      episodeFamilies: { community_discussion: 2, social_platform: 2, developer_community: 2, video_comments: 2 },
      episodeFirstPublishedAt: "2026-01-01T12:00:00.000Z",
      episodeLatestObservedAt: "2026-04-02T12:00:00.000Z",
      candidateCount: 1,
      candidateReviewStates: { eligible: 1 },
      candidateEligibilityStates: { eligible: 1 },
      maturityStates: { persistent: 1 },
      lastEvaluatedAt: "2026-04-03T00:00:00.000Z",
      candidates: [row],
    }), error: null })) } as never);
    const result = await getOrganicReadinessSourceStatus();
    expect(result).toMatchObject({ state: "available", candidateCount: 1, summary: { candidates: [row] } });
    expect(result.range).toContain("2026-01-01");
  });

  it("withholds malformed or unsafe candidate payloads instead of rendering source data", async () => {
    const unsafe = { ...summary({ candidates: [] }), rawConversationPayload: "never render this" };
    vi.mocked(createAdminServiceClient).mockReturnValue({ rpc: vi.fn(async () => ({ data: unsafe, error: null })) } as never);
    await expect(getOrganicReadinessSourceStatus()).resolves.toMatchObject({ state: "unavailable", summary: null });
  });

  it("requires a separately authorized session action and never accepts an actor identity", () => {
    const action = read("apps/admin/src/server/organic-review-actions.ts");
    expect(action).toContain('requireAdminPermission("organic_intelligence.review")');
    expect(action).toContain('session.rpc("record_organic_candidate_review"');
    expect(action).toContain('assertAdminHostnameRequest()');
    expect(action).not.toContain("actorUserId");
    expect(action).not.toContain("serviceRoleKey");
  });

  it("keeps the route private and Search Console priority-only", () => {
    const page = read("apps/admin/src/app/publication-readiness/page.tsx");
    expect(page).toContain("Search Console can reprioritize an eligible candidate; it cannot change eligibility.");
    expect(page).toContain("No public page is enabled here");
    expect(page).toContain("Internal provenance references");
    expect(read("src/app/sitemap.ts")).not.toMatch(/organic|publication-readiness/i);
  });

  it("places the surface behind operations summary visibility and keeps reviewer permission separate", () => {
    const shell = read("apps/admin/src/components/console-shell.tsx");
    const auth = read("apps/admin/src/server/auth.ts");
    expect(shell).toContain('href: "/publication-readiness"');
    expect(shell).toContain('permission: "operations.summary.read"');
    expect(auth).toContain('organic_reviewer: new Set(["operations.summary.read", "organic_intelligence.review"])');
  });
});
