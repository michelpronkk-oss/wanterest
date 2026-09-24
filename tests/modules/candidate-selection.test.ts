import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ConversationRow, SourceItemRow } from "../../src/server/db/database.helpers";
import { provenanceForReplay, selectScanCandidates } from "../../src/server/modules/onboarding/initial-scan.service";

describe("candidate selection v2", () => {
  const painCompilation = {
    templateVersion: "github_pain_retrieval_v1_1" as const,
    demandAnchors: ["looking for", "struggling with", "need"],
    categoryAnchors: ["project management", "issue tracking"],
  };

  it("maps replayed existing conversations back to the executed planned query", () => {
    const request = { limit: 5, expandThreads: false, requestMetadata: { queryPlanId: "qp-1", queryFamily: "comparison", demandSurface: "competitor_pain", competitorSpecific: true, discoveryIntent: { concept_keys: ["competitor-1"] } } };
    expect(provenanceForReplay(request, "x", [{ conversationId: "existing-conversation" }])).toEqual([{
      conversationId: "existing-conversation", queryPlanId: "qp-1", source: "x", queryFamily: "comparison",
      demandSurface: "competitor_pain", concepts: ["competitor-1"], competitorSpecific: true,
    }]);
    expect(provenanceForReplay({ limit: 5, expandThreads: false, requestMetadata: {} }, "x", [{ conversationId: "existing-conversation" }])).toEqual([]);
  });
  it("is stable when Supabase returns the same rows in a different order", () => {
    const sources = ["github", "hacker-news", "x"];
    const conversations = Array.from({ length: 25 }, (_, index) => ({ id: `conversation-${index}`, primary_source_item_id: `source-${index}`, published_at: "2026-01-01T00:00:00.000Z" } as ConversationRow));
    const sourceById = new Map(conversations.map((conversation, index) => {
      const source = sources[index < 13 ? 0 : index < 19 ? 1 : 2];
      const row = { id: conversation.primary_source_item_id, source_key: source, title: `Demand ${index}`, body: `A detailed ${source} demand conversation ${index} with distinct evidence.`, metadata: { query: "market demand" } } as unknown as SourceItemRow;
      return [conversation.primary_source_item_id, row];
    }));
    const first = selectScanCandidates({ conversations, sourceById, max: 15 });
    const shuffled = selectScanCandidates({ conversations: [...conversations].reverse(), sourceById, max: 15 });

    expect(first.conversations.map((item) => item.id)).toEqual(shuffled.conversations.map((item) => item.id));
    expect(first.diagnostics).toEqual(shuffled.diagnostics);
    expect(first.diagnostics.selectedCount).toBe(15);
    expect(first.diagnostics.selectedBySource).toMatchObject({ github: expect.any(Number), "hacker-news": expect.any(Number), x: expect.any(Number) });
    expect(first.diagnostics.evaluationCapDiagnostics).toMatchObject({ availableCount: 25, evaluatedCount: 15, suppressedCount: 10, suppressedScoreRange: { min: expect.any(Number), max: expect.any(Number) } });
    expect(first.diagnostics.evaluationCapDiagnostics.suppressedCandidates).toHaveLength(10);
  });

  it("reports cap-suppressed candidates with bounded provenance metadata without evaluating them", () => {
    const conversations = ["a", "b", "c"].map((id) => ({ id, primary_source_item_id: id, published_at: "2026-01-01" } as ConversationRow));
    const sourceById = new Map(conversations.map(({ id }) => [id, { id, source_key: "github", title: id, body: `Need a project management tool. Detailed demand evidence for ${id} ${"context ".repeat(20)}`, metadata: {} } as unknown as SourceItemRow]));
    const result = selectScanCandidates({ conversations, sourceById, max: 2, provenance: conversations.map(({ id }) => ({ conversationId: id, queryPlanId: `query-${id}`, source: "github", queryFamily: "pain", demandSurface: "pain_first", concepts: [], competitorSpecific: false, githubPainRetrievalV1: painCompilation })) });
    expect(result.conversations).toHaveLength(2);
    expect(result.diagnostics.evaluationCapDiagnostics.suppressedCount).toBe(1);
    expect(result.diagnostics.evaluationCapDiagnostics.suppressedCandidates[0]).toMatchObject({ conversationId: "c", source: "github", surfaces: ["pain_first"], queryPlanIds: ["query-c"], reason: "evaluation_cap" });
  });

  it("uses current scan provenance for cached and multiply discovered conversations", () => {
    const conversations = ["a", "b", "c"].map((id) => ({ id, primary_source_item_id: id, published_at: "2026-01-01" } as ConversationRow));
    const sourceById = new Map(conversations.map(({ id }) => [id, { id, source_key: "github", title: id, body: `Need a project management tool with distinct conversation ${id} and detailed demand evidence over many words.`, metadata: {} } as unknown as SourceItemRow]));
    const entry = (conversationId: string, demandSurface: string, queryPlanId: string) => ({ conversationId, demandSurface, queryPlanId, source: "github", queryFamily: "pain", concepts: demandSurface === "feature_demand" ? ["project_management_features"] : ["category"], competitorSpecific: false, ...(demandSurface === "feature_demand" ? { semanticQuery: "need project management software with Project management features" } : {}), ...(demandSurface === "pain_first" ? { githubPainRetrievalV1: painCompilation } : {}) });
    const provenance = [entry("a", "pain_first", "q1"), entry("a", "feature_demand", "q2"), entry("b", "pain_first", "q1")];
    const first = selectScanCandidates({ conversations, sourceById, max: 2, provenance });
    const shuffled = selectScanCandidates({ conversations: [...conversations].reverse(), sourceById, max: 2, provenance: [...provenance].reverse() });
    expect(first.diagnostics).toEqual(shuffled.diagnostics);
    expect(first.diagnostics.selected.find((item) => item.conversationId === "a")?.surfaces).toEqual(["feature_demand", "pain_first"]);
    expect(first.diagnostics.availableBySurface.unknown).toBe(1);
    expect(first.diagnostics.availableCount).toBe(first.diagnostics.postDedupCandidateCount + first.diagnostics.suppressedDuplicateCount);
  });

  it("prefers a new surface at comparable quality but retains clearly better evidence", () => {
    const conversations = ["a", "b", "c"].map((id) => ({ id, primary_source_item_id: id, published_at: "2026-01-01" } as ConversationRow));
    const sourceById = new Map(conversations.map(({ id }) => [id, { id, source_key: "github", title: id, body: id === "c" ? "Short" : `Need a project management tool. Distinct ${id} ${"evidence ".repeat(45)}`, metadata: {} } as unknown as SourceItemRow]));
    const provenance = [ ["a", "pain_first"], ["b", "pain_first"], ["c", "feature_demand"] ].map(([conversationId, demandSurface]) => ({ conversationId, demandSurface, queryPlanId: conversationId, source: "github", queryFamily: "pain", concepts: [], competitorSpecific: false, ...(demandSurface === "pain_first" ? { githubPainRetrievalV1: painCompilation } : {}) }));
    const selected = selectScanCandidates({ conversations, sourceById, max: 2, provenance });
    expect(selected.conversations.map((row) => row.id)).toEqual(["a", "b"]);
  });
});
