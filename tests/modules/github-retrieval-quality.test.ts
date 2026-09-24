import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { classifyGithubRetrievalQuality } from "../../src/server/modules/operations/github-retrieval-quality";
import type { ConversationRow, SourceItemRow } from "../../src/server/db/database.helpers";
import { selectScanCandidates } from "../../src/server/modules/onboarding/initial-scan.service";
import { queryPlanningVersion } from "../../src/server/modules/operations/query-planning.schemas";
import { SIGNAL_QUALIFICATION_THRESHOLD_VERSION, SIGNAL_QUALIFICATION_VERSION } from "../../src/server/modules/intelligence/signal-qualification.config";
import { SEMANTIC_REASONING_ROUTER_VERSION } from "../../src/server/modules/intelligence/semantic-reasoning-router";

const quality = (title: string, body: string, metadata: Record<string, unknown> = {}) => classifyGithubRetrievalQuality({ title, body, metadata });

describe("GitHub retrieval precision gate", () => {
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
        { conversationId: eligible.id, queryPlanId: "qp-pain", source: "github", queryFamily: "pain", demandSurface: "pain_first", concepts: [], competitorSpecific: false },
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
