import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { classifyGithubRetrievalQuality } from "../../src/server/modules/operations/github-retrieval-quality";
import type { ConversationRow, SourceItemRow } from "../../src/server/db/database.helpers";
import { provenanceForReplay, selectScanCandidates, type ScanDiscoveryProvenance } from "../../src/server/modules/onboarding/initial-scan.service";
import { queryPlanningVersion } from "../../src/server/modules/operations/query-planning.schemas";
import { SIGNAL_QUALIFICATION_THRESHOLD_VERSION, SIGNAL_QUALIFICATION_VERSION } from "../../src/server/modules/intelligence/signal-qualification.config";
import { SEMANTIC_REASONING_ROUTER_VERSION } from "../../src/server/modules/intelligence/semantic-reasoning-router";

const quality = (title: string, body: string, metadata: Record<string, unknown> = {}) => classifyGithubRetrievalQuality({ title, body, metadata });

describe("GitHub retrieval precision gate", () => {
  const painCompilation = {
    templateVersion: "github_pain_retrieval_v1_1" as const,
    demandAnchors: ["looking for", "struggling with", "need"],
    categoryAnchors: ["project management", "issue tracking"],
  };

  const painProvenance = (conversationId: string, queryPlanId = `pain-${conversationId}`): ScanDiscoveryProvenance => ({
    conversationId,
    queryPlanId,
    source: "github",
    queryFamily: "pain",
    demandSurface: "pain_first",
    concepts: [],
    competitorSpecific: false,
    githubPainRetrievalV1: painCompilation,
  });

  const candidate = (id: string, title: string, body: string, provenance: ScanDiscoveryProvenance = painProvenance(id)) => ({
    conversation: { id, primary_source_item_id: `${id}-source`, published_at: "2026-01-01" } as ConversationRow,
    source: { id: `${id}-source`, external_id: `github:issue:${id}`, source_key: "github", title, body, metadata: { itemType: "issue" } } as unknown as SourceItemRow,
    provenance,
  });

  it("carries the compiled pain anchors into current-scan GitHub provenance", () => {
    const request = { limit: 5, expandThreads: false, requestMetadata: {
      queryPlanId: "qp-pain",
      queryFamily: "pain",
      demandSurface: "pain_first",
      githubPainRetrievalV1: {
        semanticQuery: "project management software",
        providerQuery: '("looking for") ("project management")',
        templateVersion: "github_pain_retrieval_v1_1",
        booleanOperatorCount: 0,
        demandAnchors: ["looking for"],
        categoryAnchors: ["project management"],
      },
    } };
    expect(provenanceForReplay(request, "github", [{ conversationId: "existing-conversation" }])[0]).toMatchObject({
      githubPainRetrievalV1: { templateVersion: "github_pain_retrieval_v1_1", demandAnchors: ["looking for"], categoryAnchors: ["project management"] },
    });
  });

  it("keeps a GitHub pain candidate only when both compiled anchor groups are evidenced", () => {
    const aligned = candidate("aligned", "Looking for a better tool", "We need a simpler project management workflow.");
    const result = selectScanCandidates({ conversations: [aligned.conversation], sourceById: new Map([[aligned.source.id, aligned.source]]), max: 15, provenance: [aligned.provenance] });
    expect(result.conversations.map((row) => row.id)).toEqual(["aligned"]);
    expect(result.githubPainEvidenceAlignment).toEqual({ inspectedCount: 1, alignedCount: 1, mismatchCount: 0, mismatches: [] });
  });

  it.each([
    ["demand anchor only", "Looking for a better tool", "The workflow is difficult.", ["looking for"], []],
    ["category anchor only", "Project management roadmap", "This repository discusses project management.", [], ["project management"]],
    ["provider match only", "Looking for a maintainer", "This repository has no retained category evidence.", [], []],
  ])("marks %s as retrieval-ineligible", (_label, title, body, demandMatches, categoryMatches) => {
    const id = "11111111-1111-4111-8111-111111111111";
    const item = candidate(id, title, body, _label === "provider match only" ? { ...painProvenance(id), githubPainRetrievalV1: undefined } : painProvenance(id));
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(0);
    expect(result.githubPainEvidenceAlignment).toMatchObject({ inspectedCount: 1, alignedCount: 0, mismatchCount: 1 });
    expect(result.githubPainEvidenceAlignment.mismatches[0]).toMatchObject({ reason: "query_evidence_mismatch", demandAnchorMatches: demandMatches, categoryAnchorMatches: categoryMatches });
  });

  it("matches anchors case-insensitively and across normalized whitespace", () => {
    const item = candidate("whitespace", "LOOKING\nFOR a better tool", "We need\tproject management software.");
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(1);
    expect(result.githubPainEvidenceAlignment?.alignedCount).toBe(1);
  });

  it("does not require direction, competitor, or Linear evidence", () => {
    const unknownDirection = candidate("unknown-direction", "Need a project management tool", "We need simpler planning for our team.");
    const competitorMention = candidate("competitor-mention", "Looking for issue tracking", "We need issue tracking that is simpler than Jira and Linear.");
    const noLinear = candidate("no-linear", "Need project management", "We need a project management replacement for our team.");
    const all = [unknownDirection, competitorMention, noLinear];
    const result = selectScanCandidates({ conversations: all.map((item) => item.conversation), sourceById: new Map(all.map((item) => [item.source.id, item.source])), max: 15, provenance: all.map((item) => item.provenance) });
    expect(result.conversations.map((row) => row.id)).toEqual(["competitor-mention", "no-linear", "unknown-direction"]);
    expect(result.githubPainEvidenceAlignment).toMatchObject({ inspectedCount: 3, alignedCount: 3, mismatchCount: 0 });
  });

  it.each([
    ["feature_demand", "feature"],
    ["job_demand", "job"],
  ])("does not apply the gate to GitHub %s", (surface, id) => {
    const item = candidate(id, "Repository request", "This text has no pain query anchor.", { ...painProvenance(id), demandSurface: surface, githubPainRetrievalV1: undefined });
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(1);
    expect(result.githubPainEvidenceAlignment).toEqual({ inspectedCount: 0, alignedCount: 0, mismatchCount: 0, mismatches: [] });
  });

  it("does not apply the gate to non-GitHub sources", () => {
    const item = candidate("non-github", "Looking for a tool", "The retained text has only a demand anchor.", { ...painProvenance("non-github"), source: "stack-exchange" });
    item.source.source_key = "stack-exchange";
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(1);
    expect(result.githubPainEvidenceAlignment).toEqual({ inspectedCount: 0, alignedCount: 0, mismatchCount: 0, mismatches: [] });
  });

  it("runs before selection and frees evaluation capacity", () => {
    const mismatch = candidate("mismatch", "Looking for a tool", `${"Long repository text ".repeat(30)} need a maintainer.`);
    const aligned = candidate("aligned-cap", "Need a project management tool", "We need a project management tool.");
    const result = selectScanCandidates({ conversations: [mismatch.conversation, aligned.conversation], sourceById: new Map([[mismatch.source.id, mismatch.source], [aligned.source.id, aligned.source]]), max: 1, provenance: [mismatch.provenance, aligned.provenance] });
    expect(result.conversations.map((row) => row.id)).toEqual(["aligned-cap"]);
    expect(result.diagnostics.selectedCount).toBe(1);
    expect(result.githubPainEvidenceAlignment).toMatchObject({ inspectedCount: 2, alignedCount: 1, mismatchCount: 1 });
    expect(result.githubPainEvidenceAlignment.inspectedCount).toBe(result.githubPainEvidenceAlignment.alignedCount + result.githubPainEvidenceAlignment.mismatchCount);
  });

  it("suppresses a high-confidence job posting", () => {
    expect(quality("Senior Site Reliability Engineer", "Job Details. Responsibilities include on-call operations. Qualifications require five years of experience. Location: Austin. Apply now.")).toEqual({ eligible: false, reason: "job_posting" });
  });

  it("suppresses an SEO/search-result dump", () => {
    expect(quality("Project", "AI Mode All Images Videos Shopping Short videos Forums News Maps Web Books Flights Finance Search tools Feedback https://example.com/a https://example.com/b")).toEqual({ eligible: false, reason: "seo_or_search_dump" });
  });

  it("suppresses external article promotion", () => {
    expect(quality("Why Businesses Choose Workflow Solutions", "Introduction: modern businesses need scalable platforms. Our solutions help organizations improve operations. Learn more at https://example.com and https://example.com/contact.")).toEqual({ eligible: false, reason: "external_content_promotion" });
  });

  it("suppresses an obvious unrelated informational issue", () => {
    expect(quality("Company development guide", "Our organization documents its external development practices for enterprise technology teams. This guide describes the background and structure of the publishing project. https://example.com/project", { itemType: "issue" })).toEqual({ eligible: false, reason: "obvious_unrelated_content" });
  });

  it.each([
    "Looking for an alternative to Jira because it is too heavy for our team.",
    "What do you use instead of Jira for a small engineering team?",
    "We need a project management tool that keeps planning simple.",
    "Anyone switched from Jira to something lighter?",
    "Linear is missing dependency views; what alternatives support them?",
    "Our team struggles with Jira because the workflow is too complex.",
    "How should a team compare Jira versus Linear for software delivery?",
    "What project management tool should a small team consider?",
    "Our engineering team needs a feature that keeps issue tracking together.",
    "We need to decide between Jira and Linear for our team.",
  ])("preserves genuine or ambiguous demand: %s", (body) => {
    expect(quality("Project tooling discussion", body)).toEqual({ eligible: true, reason: "eligible" });
  });

  it("preserves unknown direction, competitor mentions, and implementation language alone", () => {
    expect(quality("Project discussion", "Jira and Linear are both mentioned in this project discussion.")).toEqual({ eligible: true, reason: "eligible" });
    expect(quality("TypeScript integration", "This repository contains a TypeScript integration and API client for issue tracking.")).toEqual({ eligible: true, reason: "eligible" });
  });

  it("fails open for ambiguous content", () => {
    expect(quality("Project update", "The team discussed workflow changes and shared a few notes.")).toEqual({ eligible: true, reason: "eligible" });
  });

  it("filters before candidate selection and reports bounded diagnostics", () => {
    const suppressed = { id: "suppressed", primary_source_item_id: "suppressed-source", published_at: "2026-01-01" } as ConversationRow;
    const eligible = { id: "eligible", primary_source_item_id: "eligible-source", published_at: "2026-01-01" } as ConversationRow;
    const sourceById = new Map([
      ["suppressed-source", { id: "suppressed-source", external_id: "github:issue:1", source_key: "github", title: "Senior Engineer", body: "Job Details. Responsibilities include on-call operations. Qualifications require experience. Location: Austin. Apply now.", metadata: { itemType: "issue" } } as unknown as SourceItemRow],
      ["eligible-source", { id: "eligible-source", external_id: "github:issue:2", source_key: "github", title: "Need a simpler tracker", body: "We need a project management tool that keeps planning simple.", metadata: { itemType: "issue" } } as unknown as SourceItemRow],
    ]);
    const result = selectScanCandidates({
      conversations: [suppressed, eligible],
      sourceById,
      max: 15,
      provenance: [
        { conversationId: suppressed.id, queryPlanId: "qp-job", source: "github", queryFamily: "jtbd", demandSurface: "job_demand", concepts: [], competitorSpecific: false },
        { conversationId: eligible.id, queryPlanId: "qp-pain", source: "github", queryFamily: "pain", demandSurface: "pain_first", concepts: [], competitorSpecific: false, githubPainRetrievalV1: painCompilation },
      ],
    });
    expect(result.conversations.map((row) => row.id)).toEqual(["eligible"]);
    expect(result.githubRetrievalPrecision).toMatchObject({ inspectedCount: 2, eligibleCount: 1, suppressedCount: 1, suppressedByReason: { job_posting: 1 } });
    expect(result.githubRetrievalPrecision.suppressedCandidates[0]).toMatchObject({ conversationId: "suppressed", providerItemId: "github:issue:1", queryPlanIds: ["qp-job"], reason: "job_posting" });
  });

  it("does not change behavior for non-GitHub sources", () => {
    const conversation = { id: "x", primary_source_item_id: "x-source", published_at: "2026-01-01" } as ConversationRow;
    const source = { id: "x-source", external_id: "x:1", source_key: "x", title: "Senior Engineer", body: "Job Details. Responsibilities include on-call operations. Qualifications require experience. Location: Austin. Apply now.", metadata: {} } as unknown as SourceItemRow;
    const result = selectScanCandidates({ conversations: [conversation], sourceById: new Map([[source.id, source]]), max: 15 });
    expect(result.conversations).toHaveLength(1);
    expect(result.githubRetrievalPrecision).toEqual({ inspectedCount: 0, eligibleCount: 0, suppressedCount: 0, suppressedByReason: {}, suppressedCandidates: [] });
  });

  it("keeps the frozen planner, selector, qualification, threshold, and reasoning versions", () => {
    const conversation = { id: "version-check", primary_source_item_id: "version-source", published_at: "2026-01-01" } as ConversationRow;
    const source = { id: "version-source", external_id: "github:1", source_key: "github", title: "Demand", body: "We need a project management tool.", metadata: {} } as unknown as SourceItemRow;
    const result = selectScanCandidates({ conversations: [conversation], sourceById: new Map([[source.id, source]]), max: 15 });
    expect(queryPlanningVersion).toBe("query_planning_v7");
    expect(result.diagnostics.version).toBe("candidate_selection_v3");
    expect(SIGNAL_QUALIFICATION_VERSION).toBe("signal_qualification_v1_7");
    expect(SIGNAL_QUALIFICATION_THRESHOLD_VERSION).toBe("signal_qualification_thresholds_v1");
    expect(SEMANTIC_REASONING_ROUTER_VERSION).toBe("semantic_reasoning_router_v1");
  });
});
