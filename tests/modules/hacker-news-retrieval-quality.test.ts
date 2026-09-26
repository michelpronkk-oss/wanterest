import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ConversationRow, SourceItemRow } from "../../src/server/db/database.helpers";
import { SIGNAL_QUALIFICATION_THRESHOLD_VERSION, SIGNAL_QUALIFICATION_VERSION } from "../../src/server/modules/intelligence/signal-qualification.config";
import { selectScanCandidates } from "../../src/server/modules/onboarding/initial-scan.service";
import { toSourceDiscoveryRequest } from "../../src/server/modules/operations/query-planning.execution";
import { queryPlanningVersion, type QueryPlanQuery, type QueryPlanSource } from "../../src/server/modules/operations/query-planning.schemas";
import { hackerNewsPainLaunchMismatchReason, titleMatchesExplicitShowHnLaunch } from "../../src/server/modules/operations/hacker-news-retrieval-quality";

const conversation = (id: string): ConversationRow => ({ id, primary_source_item_id: `${id}-source`, published_at: "2026-09-24T00:00:00.000Z" } as ConversationRow);

const source = (id: string, title: string, sourceKey = "hacker-news", providerType = "story"): SourceItemRow => ({
  id: `${id}-source`,
  source_key: sourceKey,
  title,
  body: "A retained story body with project management software context and enough evidence for candidate selection.",
  metadata: { query: "project management software", providerType },
} as unknown as SourceItemRow);

const provenance = (id: string, surface = "pain_first", sourceKey = "hacker-news") => ({
  conversationId: id,
  queryPlanId: `qp-${id}-${surface}`,
  source: sourceKey,
  queryFamily: "pain",
  demandSurface: surface,
  semanticQuery: "project management software Inefficient software development workflows",
  concepts: ["category", "inefficient_software_development_workflows"],
  competitorSpecific: false,
});

function selectOne(id: string, title: string, surface = "pain_first", sourceKey = "hacker-news", providerType = "story") {
  const row = conversation(id);
  return selectScanCandidates({ conversations: [row], sourceById: new Map([[`${id}-source`, source(id, title, sourceKey, providerType)]]), max: 15, provenance: [provenance(id, surface, sourceKey)] });
}

describe("Hacker News pain_first launch filter", () => {
  it("suppresses explicit Show HN launches", () => {
    const result = selectOne("hn-show", "Show HN: Blackbear.app – Thoughtful, Private Collaboration");
    expect(result.conversations).toHaveLength(0);
    expect(result.hackerNewsPainLaunchFilter).toMatchObject({ inspectedCount: 1, suppressedCount: 1, passedCount: 0, suppressionReason: hackerNewsPainLaunchMismatchReason, suppressed: [{ conversationId: "hn-show", titleMatchedShowHn: true }] });
    expect(result.diagnostics.suppressedByReason[hackerNewsPainLaunchMismatchReason]).toBe(1);
  });

  it("matches Show HN case-insensitively", () => {
    expect(titleMatchesExplicitShowHnLaunch("show hn: Whiteboard")).toBe(true);
    expect(selectOne("hn-case", "show hn: Whiteboard").conversations).toHaveLength(0);
  });

  it("matches whitespace-normalized Show HN titles", () => {
    expect(titleMatchesExplicitShowHnLaunch("  Show\tHN :   Whiteboard  ")).toBe(true);
    expect(selectOne("hn-whitespace", "  Show\tHN :   Whiteboard  ").conversations).toHaveLength(0);
  });

  it("keeps Ask HN eligible", () => {
    const result = selectOne("hn-ask", "Ask HN: What are you using instead of Jira?");
    expect(result.conversations).toHaveLength(1);
    expect(result.hackerNewsPainLaunchFilter).toMatchObject({ inspectedCount: 1, suppressedCount: 0, passedCount: 1 });
  });

  it("keeps Tell HN eligible", () => {
    expect(selectOne("hn-tell", "Tell HN: We built a simpler workflow").conversations).toHaveLength(1);
  });

  it("keeps generic HN stories eligible", () => {
    expect(selectOne("hn-generic", "Our team is struggling with project management software").conversations).toHaveLength(1);
  });

  it("keeps HN comments eligible", () => {
    const result = selectOne("hn-comment", "Show HN: Root title", "pain_first", "hacker-news", "comment");
    expect(result.conversations).toHaveLength(1);
    expect(result.hackerNewsPainLaunchFilter).toMatchObject({ inspectedCount: 1, suppressedCount: 0, passedCount: 1 });
  });

  it("does not affect non-HN sources", () => {
    const result = selectOne("non-hn", "Show HN: A project tool", "pain_first", "stack-exchange");
    expect(result.conversations).toHaveLength(1);
    expect(result.hackerNewsPainLaunchFilter).toMatchObject({ inspectedCount: 0, suppressedCount: 0, passedCount: 0 });
  });

  it("does not affect other Hacker News surfaces", () => {
    const result = selectOne("hn-feature", "Show HN: A project tool", "feature_demand");
    expect(result.conversations).toHaveLength(1);
    expect(result.hackerNewsPainLaunchFilter).toMatchObject({ inspectedCount: 0, suppressedCount: 0, passedCount: 0 });
  });

  it("suppressed launches consume no evaluation slot", () => {
    const rejected = conversation("hn-cap-launch");
    const eligible = conversation("hn-cap-eligible");
    const sourceById = new Map([
      [rejected.primary_source_item_id, source(rejected.id, "Show HN: Blackbear")],
      [eligible.primary_source_item_id, source(eligible.id, "Looking for a better issue tracker")],
    ]);
    const result = selectScanCandidates({ conversations: [rejected, eligible], sourceById, max: 1, provenance: [provenance(rejected.id), provenance(eligible.id)] });
    expect(result.conversations.map((row) => row.id)).toEqual([eligible.id]);
    expect(result.diagnostics.availableCount).toBe(1);
    expect(result.diagnostics.selectedCount).toBe(1);
  });

  it("reconciles inspected, suppressed, and passed diagnostics", () => {
    const rows = [
      ["hn-reconcile-show", "Show HN: Launch"],
      ["hn-reconcile-ask", "Ask HN: What are you using instead of Jira?"],
      ["hn-reconcile-generic", "Our team needs a better issue tracker"],
    ].map(([id, title]) => ({ conversation: conversation(id), source: source(id, title), provenance: provenance(id) }));
    const result = selectScanCandidates({ conversations: rows.map((row) => row.conversation), sourceById: new Map(rows.map((row) => [row.source.id, row.source])), max: 15, provenance: rows.map((row) => row.provenance) });
    const diagnostics = result.hackerNewsPainLaunchFilter;
    expect(diagnostics).toBeDefined();
    if (!diagnostics) throw new Error("Hacker News launch diagnostics were not returned.");
    expect(diagnostics.inspectedCount).toBe(diagnostics.suppressedCount + diagnostics.passedCount);
    expect(diagnostics).toMatchObject({ inspectedCount: 3, suppressedCount: 1, passedCount: 2 });
  });

  it("preserves the HN query, anchors, and request limits", () => {
    const query = {
      query_id: "qp-hn-pain",
      query_family: "pain",
      demand_surface: "pain_first",
      competitor_specific: false,
      intent_type: "problem_solution_search",
      query_text: "project management software Inefficient software development workflows",
      normalized_query: "project management software inefficient software development workflows",
      source_key: "hacker-news",
      priority: "high",
      confidence: 0.9,
      candidate_budget: 8,
      reason_codes: ["HIGH_CONFIDENCE_PAIN"],
      reason_summary: "pain",
      concept_keys: ["category", "inefficient_software_development_workflows"],
      competitor_refs: [],
      alternative_refs: [],
      geo_context: null,
      language_context: null,
      cost_hint: "free",
      metadata: {
        provider_context: { product_name: "Linear", category: "project management software", competitors: ["Jira"], alternatives: ["Jira"] },
        discovery_intent: { surface: "pain_first", concept_keys: ["category", "inefficient_software_development_workflows"], query_family: "pain", competitor_specific: false },
      },
    } as unknown as QueryPlanQuery;
    const sourcePlan = { source_key: "hacker-news", priority: "high", candidate_budget: 8, query_budget: 1, queries: [query], excluded_query_families: [], reason_codes: [], confidence: 0.9 } as unknown as QueryPlanSource;
    const request = toSourceDiscoveryRequest({ sourcePlan, query, maxPages: 3 });
    expect(queryPlanningVersion).toBe("query_planning_v7");
    expect(request).toMatchObject({ limit: 8, query: query.query_text, expandThreads: false, requestMetadata: { maxPages: 3, executionMode: "filtered_newstories_feed", searchUnsupported: true, lexicalAnchors: ["Jira", "Linear", "project management software", "Jira"] } });
  });

  it("Layer 12A.3A: flag off (default/omitted) reproduces the exact legacy request; flag on sends HN Search v2", () => {
    const query = {
      query_id: "qp-hn-pain",
      query_family: "pain",
      demand_surface: "pain_first",
      competitor_specific: false,
      intent_type: "problem_solution_search",
      query_text: "project management software Inefficient software development workflows",
      normalized_query: "project management software inefficient software development workflows",
      source_key: "hacker-news",
      priority: "high",
      confidence: 0.9,
      candidate_budget: 8,
      reason_codes: ["HIGH_CONFIDENCE_PAIN"],
      reason_summary: "pain",
      concept_keys: ["category", "inefficient_software_development_workflows"],
      competitor_refs: [],
      alternative_refs: [],
      geo_context: null,
      language_context: null,
      cost_hint: "free",
      metadata: { provider_context: {}, discovery_intent: {} },
    } as unknown as QueryPlanQuery;
    const sourcePlan = { source_key: "hacker-news", priority: "high", candidate_budget: 8, query_budget: 1, queries: [query], excluded_query_families: [], reason_codes: [], confidence: 0.9 } as unknown as QueryPlanSource;

    const off = toSourceDiscoveryRequest({ sourcePlan, query, maxPages: 3 });
    const offExplicit = toSourceDiscoveryRequest({ sourcePlan, query, maxPages: 3, hnAlgoliaSearchEnabled: false });
    expect(off).toEqual(offExplicit);
    expect(off.requestMetadata).toMatchObject({ executionMode: "filtered_newstories_feed", searchUnsupported: true });
    expect(off.requestMetadata.providerQuery).toBeUndefined();

    const on = toSourceDiscoveryRequest({ sourcePlan, query, maxPages: 3, hnAlgoliaSearchEnabled: true });
    expect(on).toMatchObject({
      limit: 8,
      query: query.query_text,
      requestMetadata: { executionMode: "algolia_search_v2", providerQuery: query.query_text, retrievalImplementationVersion: "hacker_news_search_v2_1" },
    });
    expect(on.requestMetadata.searchUnsupported).toBeUndefined();
    expect(on.requestMetadata.lexicalAnchors).toBeUndefined();
  });

  it("keeps qualification versions unchanged", () => {
    expect(SIGNAL_QUALIFICATION_VERSION).toBe("signal_qualification_v1_7");
    expect(SIGNAL_QUALIFICATION_THRESHOLD_VERSION).toBe("signal_qualification_thresholds_v1");
  });
});
