import { describe, expect, it } from "vitest";

import { freshnessHeadline, lastCheckedCopy, refreshStatusCopy } from "../../src/components/dashboard/read-first-intelligence-status";

type Freshness = Parameters<typeof freshnessHeadline>[0];

function freshness(overrides: Partial<Freshness> = {}): Freshness {
  return {
    state: "stale",
    freshestEvidenceAt: "2026-09-20T00:00:00.000Z",
    lastSuccessfulRefreshAt: null,
    refreshDue: false,
    policyVersion: "read_first_freshness_v2",
    evidence: { lastRetrievedAt: null, newestPublishedAt: "2026-09-20T00:00:00.000Z" },
    interpretation: { state: "fresh", lastCheckedAt: "2026-09-25T11:00:00.000Z", lastCheckSource: "incremental" },
    signalsUpdatedAt: null,
    demandViewUpdatedAt: null,
    ...overrides,
  };
}

describe("read-first freshness copy (Stage 2E)", () => {
  it("never calls a freshly re-checked quiet market stale", () => {
    expect(freshnessHeadline(freshness())).toBe("Up to date - no new qualifying demand since the last signal");
    expect(refreshStatusCopy("complete", false)).toBe("No refresh needed");
    expect(lastCheckedCopy(freshness())).toMatch(/^Market checked automatically /);
  });

  it("reports stale only when both evidence and interpretation are old", () => {
    expect(freshnessHeadline(freshness({ interpretation: { state: "stale", lastCheckedAt: "2026-09-20T00:00:00.000Z", lastCheckSource: "scan" } }))).toBe("Intelligence is stale");
  });

  it("distinguishes an empty-but-checked market from a product never checked", () => {
    expect(freshnessHeadline(freshness({ state: "empty" }))).toBe("Market checked - no qualifying demand yet");
    expect(freshnessHeadline(freshness({ state: "empty", interpretation: { state: "never", lastCheckedAt: null, lastCheckSource: null } }))).toBe("Building your first market view");
  });
});
