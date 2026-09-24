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

  const featureProvenance = (conversationId: string, queryPlanId = `feature-${conversationId}`, overrides: Partial<ScanDiscoveryProvenance> = {}): ScanDiscoveryProvenance => ({
    conversationId,
    queryPlanId,
    source: "github",
    queryFamily: "feature_requirement",
    demandSurface: "feature_demand",
    semanticQuery: "need project management software with Project management features",
    concepts: ["project_management_features"],
    competitorSpecific: false,
    ...overrides,
  });

  const jobProvenance = (conversationId: string, queryPlanId = `job-${conversationId}`, overrides: Partial<ScanDiscoveryProvenance> = {}): ScanDiscoveryProvenance => ({
    conversationId,
    queryPlanId,
    source: "github",
    queryFamily: "jtbd",
    demandSurface: "job_demand",
    semanticQuery: "need project management software to plan and ship software efficiently",
    concepts: ["category", "manage_software_projects"],
    competitorSpecific: false,
    ...overrides,
  });

  const candidate = (id: string, title: string, body: string, provenance: ScanDiscoveryProvenance = painProvenance(id)) => ({
    conversation: { id, primary_source_item_id: `${id}-source`, published_at: "2026-01-01" } as ConversationRow,
    source: { id: `${id}-source`, external_id: `github:issue:${id}`, source_key: "github", title, body, metadata: { itemType: "issue" } } as unknown as SourceItemRow,
    provenance,
  });

  const jobCandidate = (id: string, title: string, body: string, overrides: Partial<ScanDiscoveryProvenance> = {}) => candidate(id, title, body, jobProvenance(id, `job-${id}`, overrides));

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

  it("applies the feature evidence gate only to GitHub feature_demand", () => {
    const item = candidate("feature", "Feature request", "Looking for project management software with dependency support.", featureProvenance("feature"));
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(1);
    expect(result.githubPainEvidenceAlignment).toEqual({ inspectedCount: 0, alignedCount: 0, mismatchCount: 0, mismatches: [] });
    expect(result.githubFeatureEvidenceAlignment).toEqual({ inspectedCount: 1, alignedCount: 1, mismatchCount: 0, mismatches: [] });
  });

  it("applies only the GitHub job-demand evidence gate to job_demand", () => {
    const id = "job";
    const item = candidate(id, "Team tooling request", "Our team needs a better project management tool.", jobProvenance(id));
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(1);
    expect(result.githubPainEvidenceAlignment).toEqual({ inspectedCount: 0, alignedCount: 0, mismatchCount: 0, mismatches: [] });
    expect(result.githubFeatureEvidenceAlignment).toEqual({ inspectedCount: 0, alignedCount: 0, mismatchCount: 0, mismatches: [] });
    expect(result.githubJobEvidenceAlignment).toMatchObject({ inspectedCount: 1, alignedCount: 1, mismatchCount: 0 });
  });

  it.each([
    "Our team needs a better project management tool for engineering.",
    "We need software to manage issues across multiple repositories.",
    "Looking for a tool that helps our team plan and ship software.",
    "Our workflow is getting hard to manage and we need a better system.",
    "We're looking for issue tracking software for a small engineering team.",
  ])("keeps positive GitHub job demand: %s", (body) => {
    const item = jobCandidate(`job-positive-${body.slice(0, 10).replace(/[^a-z]+/gi, "-").toLowerCase()}`, "Team workflow request", body);
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(1);
    expect(result.githubJobEvidenceAlignment).toMatchObject({ inspectedCount: 1, alignedCount: 1, mismatchCount: 0 });
  });

  it.each([
    ["employment", "IBM - Site Reliability Engineering Manager", "Careers job description. Apply for this engineering manager role. Project management is a job skill.", "employment_mismatch"],
    ["maintainer roadmap", "JupyterLab vision for the next few years", "The JupyterLab community should create a vision and roadmap plan for contributors and project governance.", "maintainer_mismatch"],
    ["sparse generic", "MonopolyStrategy", "initiation plan", "sparse_or_generic_mismatch"],
    ["implementation task", "Add project management support", "Implement issue tracking support for the repository.", "buyer_context_missing"],
  ] as const)("suppresses %s job sense", (_label, title, body, subreason) => {
    const item = jobCandidate(`job-negative-${_label.replace(/\s+/g, "-")}`, title, body);
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(0);
    expect(result.diagnostics.suppressedByReason.github_job_evidence_mismatch).toBe(1);
    expect(result.githubJobEvidenceAlignment).toMatchObject({ inspectedCount: 1, alignedCount: 0, mismatchCount: 1, subreasonCounts: { [subreason]: 1 } });
    expect(result.githubJobEvidenceAlignment?.mismatches[0]).toMatchObject({ conversationId: item.conversation.id, subreason, buyerContextMatched: false });
  });

  it("classifies missing buyer and category context independently", () => {
    const buyerOnly = jobCandidate("job-buyer-only", "User discussion", "We need a simpler way to coordinate our team.");
    const categoryOnly = jobCandidate("job-category-only", "Repository implementation", "This project management system supports issue tracking.");
    const result = selectScanCandidates({
      conversations: [buyerOnly.conversation, categoryOnly.conversation],
      sourceById: new Map([[buyerOnly.source.id, buyerOnly.source], [categoryOnly.source.id, categoryOnly.source]]),
      max: 15,
      provenance: [buyerOnly.provenance, categoryOnly.provenance],
    });
    expect(result.conversations).toHaveLength(0);
    expect(result.githubJobEvidenceAlignment).toMatchObject({
      inspectedCount: 2,
      alignedCount: 0,
      mismatchCount: 2,
      subreasonCounts: { buyer_context_missing: 1, category_context_missing: 1 },
    });
  });

  it("does not require Linear or Jira literals", () => {
    const item = jobCandidate("job-no-product-literals", "Team software request", "Looking for a tool that helps our team plan and ship software.");
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(1);
  });

  it("does not suppress a job mismatch when the same conversation has another valid discovery path", () => {
    const item = jobCandidate("job-alternate-path", "Engineering Manager role", "We need project management experience for this engineering manager job. Careers and apply details are included.");
    const pain = painProvenance(item.conversation.id, "pain-alternate-path");
    const result = selectScanCandidates({
      conversations: [item.conversation],
      sourceById: new Map([[item.source.id, item.source]]),
      max: 15,
      provenance: [item.provenance, pain],
    });
    expect(result.conversations).toHaveLength(1);
    expect(result.githubJobEvidenceAlignment).toMatchObject({ inspectedCount: 1, alignedCount: 0, mismatchCount: 1 });
    expect(result.diagnostics.suppressedByReason.github_job_evidence_mismatch).toBe(0);
  });

  it("fails open when job alignment provenance is missing", () => {
    const item = jobCandidate("job-missing-provenance", "Unclear request", "A short repository note.", { semanticQuery: undefined, concepts: ["category"] });
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(1);
    expect(result.githubJobEvidenceAlignment).toMatchObject({ inspectedCount: 1, alignedCount: 1, mismatchCount: 0, missingAlignmentProvenanceCount: 1, missingAlignmentProvenanceReason: "missing_alignment_provenance" });
  });

  it("suppresses job mismatches before evaluation capacity is consumed and reconciles diagnostics", () => {
    const mismatch = jobCandidate("job-cap-mismatch", "Project implementation", "Add project management support to this repository.");
    const aligned = jobCandidate("job-cap-aligned", "Team request", "Our team needs a better project management tool.");
    const result = selectScanCandidates({
      conversations: [mismatch.conversation, aligned.conversation],
      sourceById: new Map([[mismatch.source.id, mismatch.source], [aligned.source.id, aligned.source]]),
      max: 1,
      provenance: [mismatch.provenance, aligned.provenance],
    });
    expect(result.conversations.map((row) => row.id)).toEqual([aligned.conversation.id]);
    expect(result.diagnostics.availableCount).toBe(1);
    expect(result.diagnostics.selectedCount).toBe(1);
    const diagnostics = result.githubJobEvidenceAlignment;
    expect(diagnostics).toBeDefined();
    if (!diagnostics) throw new Error("GitHub job evidence diagnostics were not returned.");
    expect(diagnostics.inspectedCount).toBe(diagnostics.alignedCount + diagnostics.mismatchCount);
    expect(diagnostics.subreasonCounts.buyer_context_missing).toBe(1);
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
    expect(result.githubFeatureEvidenceAlignment).toEqual({ inspectedCount: 0, alignedCount: 0, mismatchCount: 0, mismatches: [] });
  });

  it("rejects copied SEO/search-result content even when generic query tokens coexist", () => {
    const item = candidate("feature-dump", "Project", "AI Mode All Images Videos Shopping Short videos Forums News Maps Web Books Search tools Feedback. What Is Project Management? What is project management software? Why do we need it? Features and tools.", featureProvenance("feature-dump"));
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(0);
    expect(result.githubFeatureEvidenceAlignment).toMatchObject({ inspectedCount: 1, alignedCount: 0, mismatchCount: 1 });
    expect(result.githubFeatureEvidenceAlignment.mismatches[0]).toMatchObject({ conversationId: "feature-dump", queryPlanId: "feature-feature-dump", reason: "feature_evidence_mismatch" });
  });

  it.each([
    ["duplicate copied search-result content", "Project management software features. Project management software features. Project management software features."],
    ["internal Agile project-planning text", "It'll need to be a modified Agile process. Project management is a good topic for our internal planning."],
  ])("rejects baseline %s without a real feature request", (_label, body) => {
    const id = `feature-baseline-${_label.replace(/[^a-z]+/gi, "-").toLowerCase()}`;
    const item = candidate(id, "Project planning", body, featureProvenance(id));
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(0);
    expect(result.githubFeatureEvidenceAlignment).toMatchObject({ inspectedCount: 1, alignedCount: 0, mismatchCount: 1 });
  });

  it.each([
    ["generic need alone", "Need project management software."],
    ["category alone", "Project management software is used by teams."],
    ["feature marker alone", "Feature request: support custom workflows."],
  ])("requires both feature and category evidence: %s", (_label, body) => {
    const item = candidate(`feature-${_label.replace(/\s+/g, "-")}`, "Project discussion", body, featureProvenance(`feature-${_label.replace(/\s+/g, "-")}`));
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(0);
    expect(result.githubFeatureEvidenceAlignment?.mismatchCount).toBe(1);
  });

  it.each([
    "Looking for project management software with better dependency support",
    "Need a project management tool with native roadmap features",
    "Looking for issue tracking software that supports custom workflows",
    "We need software that can manage projects across engineering teams",
    "Feature request: support cross-project dependencies in our project management workflow",
    "Would like project management software support for dependencies, direction unknown",
  ])("retains valid feature/category evidence without requiring product direction: %s", (body) => {
    const id = `positive-${body.slice(0, 12).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    const item = candidate(id, "Feature request", body, featureProvenance(id, `feature-${id}`, { semanticQuery: "need project management software with Project management features", concepts: ["project_management_features"] }));
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations.map((row) => row.id)).toEqual([id]);
    expect(result.githubFeatureEvidenceAlignment).toMatchObject({ inspectedCount: 1, alignedCount: 1, mismatchCount: 0 });
  });

  it("does not require a Linear literal", () => {
    const item = candidate("no-linear-feature", "Feature request", "Looking for project management software with native dependency support.", featureProvenance("no-linear-feature"));
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(1);
  });

  it("does not let body evidence outside the bounded opening window rescue a candidate", () => {
    const id = "deep-feature";
    const body = `${"Unrelated copied content. ".repeat(30)} Looking for project management software with dependency support.`;
    const item = candidate(id, "Project", body, featureProvenance(id));
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(0);
    expect(result.githubFeatureEvidenceAlignment?.mismatchCount).toBe(1);
  });

  it("keeps pain_first behavior unchanged", () => {
    const item = candidate("pain-still", "Looking for a better tool", "We need a simpler project management workflow.", painProvenance("pain-still"));
    const result = selectScanCandidates({ conversations: [item.conversation], sourceById: new Map([[item.source.id, item.source]]), max: 15, provenance: [item.provenance] });
    expect(result.conversations).toHaveLength(1);
    expect(result.githubPainEvidenceAlignment?.alignedCount).toBe(1);
    expect(result.githubFeatureEvidenceAlignment).toEqual({ inspectedCount: 0, alignedCount: 0, mismatchCount: 0, mismatches: [] });
  });

  it("does not consume evaluation capacity when feature evidence mismatches", () => {
    const mismatch = candidate("feature-mismatch-cap", "Project", "Need project management software.", featureProvenance("feature-mismatch-cap"));
    const aligned = candidate("feature-aligned-cap", "Feature request", "Looking for project management software with dependency support.", featureProvenance("feature-aligned-cap"));
    const result = selectScanCandidates({ conversations: [mismatch.conversation, aligned.conversation], sourceById: new Map([[mismatch.source.id, mismatch.source], [aligned.source.id, aligned.source]]), max: 1, provenance: [mismatch.provenance, aligned.provenance] });
    expect(result.conversations.map((row) => row.id)).toEqual(["feature-aligned-cap"]);
    expect(result.diagnostics.availableCount).toBe(1);
    expect(result.diagnostics.selectedCount).toBe(1);
    expect(result.diagnostics.suppressedByReason.feature_evidence_mismatch).toBe(1);
    const featureDiagnostics = result.githubFeatureEvidenceAlignment;
    expect(featureDiagnostics).toBeDefined();
    if (!featureDiagnostics) throw new Error("Feature evidence diagnostics were not returned.");
    expect(featureDiagnostics.inspectedCount).toBe(featureDiagnostics.alignedCount + featureDiagnostics.mismatchCount);
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
