import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ConversationRow, SourceItemRow } from "../../src/server/db/database.helpers";
import { provenanceForReplay, selectScanCandidates, type ScanDiscoveryProvenance } from "../../src/server/modules/onboarding/initial-scan.service";
import { queryPlanningVersion } from "../../src/server/modules/operations/query-planning.schemas";
import { X_COMPETITOR_PAIN_DISPLACEMENT_ANCHORS, X_COMPETITOR_PAIN_RETRIEVAL_TEMPLATE_VERSION, compileXQuery } from "../../src/server/providers/source/x/x.query";
import { estimateXReadCost, X_PROVIDER_MIN_RESULTS } from "../../src/server/providers/source/x/x.cost";
import { SIGNAL_QUALIFICATION_THRESHOLD_VERSION, SIGNAL_QUALIFICATION_VERSION } from "../../src/server/modules/intelligence/signal-qualification.config";
import { SEMANTIC_REASONING_ROUTER_VERSION } from "../../src/server/modules/intelligence/semantic-reasoning-router";

const compilerProvenance = {
  templateVersion: X_COMPETITOR_PAIN_RETRIEVAL_TEMPLATE_VERSION,
  competitor: "Jira",
  displacementAnchors: [...X_COMPETITOR_PAIN_DISPLACEMENT_ANCHORS],
};

function xCompetitorProvenance(conversationId: string, overrides: Partial<ScanDiscoveryProvenance> = {}): ScanDiscoveryProvenance {
  return {
    conversationId,
    queryPlanId: `qp-x-competitor-${conversationId}`,
    source: "x",
    queryFamily: "comparison",
    demandSurface: "competitor_pain",
    concepts: ["jira"],
    competitorSpecific: true,
    xCompetitorPainRetrievalV1: compilerProvenance,
    ...overrides,
  };
}

function candidate(id: string, body: string, provenance: ScanDiscoveryProvenance, sourceKey = "x") {
  const source = { id: `${id}-source`, external_id: `${sourceKey}:${id}`, source_key: sourceKey, title: "Post", body, metadata: {} } as unknown as SourceItemRow;
  const conversation = { id, primary_source_item_id: source.id, published_at: "2026-01-01" } as ConversationRow;
  return { conversation, source, provenance };
}

function select(items: Array<ReturnType<typeof candidate>>, max = 15) {
  return selectScanCandidates({
    conversations: items.map((item) => item.conversation),
    sourceById: new Map(items.map((item) => [item.source.id, item.source])),
    max,
    provenance: items.map((item) => item.provenance),
  });
}

describe("X competitor_pain retained-evidence alignment", () => {
  it.each([
    "We're switching from Jira",
    "Our team is moving away from Jira",
    "Looking for an alternative to Jira",
    "We need to replace Jira",
    "We're replacing Jira because workflow setup is too complex",
    "Leaving Jira for something simpler",
    "Need to replace the Jira workflow",
  ])("keeps a candidate with displacement and competitor evidence: %s", (body) => {
    const id = `aligned-${body.slice(0, 12).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    const item = candidate(id, body, xCompetitorProvenance(id));
    const result = select([item]);
    expect(result.conversations.map((row) => row.id)).toEqual([id]);
    expect(result.xCompetitorEvidenceAlignment).toMatchObject({ inspectedCount: 1, alignedCount: 1, mismatchCount: 0, provenanceMissingCount: 0, bindingMatched: true });
    expect(result.xCompetitorEvidenceAlignment.boundMatches[0]).toMatchObject({ competitor: "jira" });
  });

  it.each([
    ["without competitor", "We're switching from Linear"],
    ["without displacement", "Jira is used by our team"],
    ["without either", "This is a generic project update"],
  ])("suppresses a candidate %s", (_label, body) => {
    const id = `mismatch-${_label.replace(/\s+/g, "-")}`;
    const item = candidate(id, body, xCompetitorProvenance(id));
    const result = select([item]);
    expect(result.conversations).toHaveLength(0);
    expect(result.xCompetitorEvidenceAlignment).toMatchObject({ inspectedCount: 1, alignedCount: 0, mismatchCount: 1, provenanceMissingCount: 0, bindingMatched: false, boundMatches: [] });
    expect(result.xCompetitorEvidenceAlignment.mismatches[0]).toMatchObject({ reason: "x_competitor_evidence_mismatch", subreason: "competitor_displacement_not_bound", competitor: "Jira" });
    expect(result.diagnostics.suppressedByReason.x_competitor_evidence_mismatch).toBe(1);
  });

  it("matches case-insensitively and across normalized whitespace", () => {
    const item = candidate("normalized", "Our team is MOVING\n\n AWAY FROM   jira", xCompetitorProvenance("normalized"));
    const result = select([item]);
    expect(result.conversations).toHaveLength(1);
    expect(result.xCompetitorEvidenceAlignment).toMatchObject({ inspectedCount: 1, alignedCount: 1, mismatchCount: 0 });
  });

  it("tolerates punctuation around a bound displacement phrase", () => {
    const item = candidate("punctuation", "We're switching-from: JIRA", xCompetitorProvenance("punctuation"));
    expect(select([item]).conversations).toHaveLength(1);
  });

  it.each([
    "I don't think AI is going to replace software engineers. We move information between Jira, Slack and GitHub.",
    "We need to replace our internal process. Jira is one of several tools we use.",
    "Jira is widely used. We're switching from another product.",
    "replace software engineers — Jira is mentioned later",
    "Leaving this here: Jira vs Linear",
    "We're replacing software engineers. Jira is mentioned in another sentence.",
  ])("rejects unrelated competitor co-presence: %s", (body) => {
    const id = `unbound-${body.slice(0, 12).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    const result = select([candidate(id, body, xCompetitorProvenance(id))]);
    expect(result.conversations).toHaveLength(0);
    expect(result.xCompetitorEvidenceAlignment).toMatchObject({ bindingMatched: false, boundMatches: [], mismatchCount: 1 });
    expect(result.xCompetitorEvidenceAlignment.mismatches[0].subreason).toBe("competitor_displacement_not_bound");
  });

  it("does not hardcode Jira or require Linear", () => {
    const id = "arbitrary-competitor";
    const result = select([candidate(id, "We're switching from Asana", xCompetitorProvenance(id, { xCompetitorPainRetrievalV1: { ...compilerProvenance, competitor: "Asana" } }))]);
    expect(result.conversations).toHaveLength(1);
    expect(result.xCompetitorEvidenceAlignment.boundMatches[0]).toMatchObject({ competitor: "asana" });
  });

  it("does not require a Linear literal", () => {
    const item = candidate("no-linear", "Looking for an alternative to Jira", xCompetitorProvenance("no-linear"));
    expect(select([item]).conversations).toHaveLength(1);
  });

  it("leaves X pain_first, other X surfaces, and non-X sources unchanged", () => {
    const pain = candidate("pain", "Our team needs a simpler workflow", {
      ...xCompetitorProvenance("pain"),
      queryPlanId: "qp-x-pain",
      queryFamily: "pain",
      demandSurface: "pain_first",
      competitorSpecific: false,
      xCompetitorPainRetrievalV1: undefined,
    });
    const feature = candidate("feature", "A generic feature discussion", {
      ...xCompetitorProvenance("feature"),
      queryPlanId: "qp-x-feature",
      queryFamily: "feature_requirement",
      demandSurface: "feature_demand",
      competitorSpecific: false,
      xCompetitorPainRetrievalV1: undefined,
    });
    const nonX = candidate("non-x", "A generic project update", xCompetitorProvenance("non-x", { source: "stack-exchange" }), "stack-exchange");
    const result = select([pain, feature, nonX]);
    expect(result.conversations.map((row) => row.id).sort()).toEqual(["feature", "non-x", "pain"]);
    expect(result.xCompetitorEvidenceAlignment).toEqual({ inspectedCount: 0, alignedCount: 0, mismatchCount: 0, provenanceMissingCount: 0, bindingMatched: false, boundMatches: [], mismatches: [] });
  });

  it("suppresses the mismatch before candidate selection and frees evaluation capacity", () => {
    const mismatch = candidate("mismatch-cap", "Grok is fast", xCompetitorProvenance("mismatch-cap"));
    const aligned = candidate("aligned-cap", "We need to replace Jira", xCompetitorProvenance("aligned-cap"));
    const result = select([mismatch, aligned], 1);
    expect(result.conversations.map((row) => row.id)).toEqual(["aligned-cap"]);
    expect(result.diagnostics.availableCount).toBe(1);
    expect(result.diagnostics.selectedCount).toBe(1);
    expect(result.diagnostics.suppressedByReason.x_competitor_evidence_mismatch).toBe(1);
  });

  it("reconciles inspected, aligned, mismatch, and missing-provenance diagnostics", () => {
    const aligned = candidate("diag-aligned", "Leaving Jira for something simpler", xCompetitorProvenance("diag-aligned"));
    const mismatch = candidate("diag-mismatch", "Political news update", xCompetitorProvenance("diag-mismatch"));
    const missing = candidate("diag-missing", "A provider-returned post", xCompetitorProvenance("diag-missing", { xCompetitorPainRetrievalV1: undefined }));
    const result = select([aligned, mismatch, missing]);
    const diagnostics = result.xCompetitorEvidenceAlignment;
    expect(diagnostics.inspectedCount).toBe(diagnostics.alignedCount + diagnostics.mismatchCount + diagnostics.provenanceMissingCount);
    expect(diagnostics).toMatchObject({ inspectedCount: 3, alignedCount: 1, mismatchCount: 1, provenanceMissingCount: 1, provenanceMissingReason: "missing_compiler_provenance", bindingMatched: true });
    expect(result.conversations.map((row) => row.id)).toEqual(["diag-aligned", "diag-missing"]);
  });

  it("fails open when compiler provenance is absent", () => {
    const item = candidate("missing-provenance", "Grok is unrelated", xCompetitorProvenance("missing-provenance", { xCompetitorPainRetrievalV1: undefined }));
    const result = select([item]);
    expect(result.conversations).toHaveLength(1);
    expect(result.xCompetitorEvidenceAlignment).toMatchObject({ inspectedCount: 1, alignedCount: 0, mismatchCount: 0, provenanceMissingCount: 1, provenanceMissingReason: "missing_compiler_provenance", bindingMatched: false, boundMatches: [], mismatches: [] });
  });

  it("preserves compiler provenance at the replay seam", () => {
    const request = { limit: 5, query: "Jira", expandThreads: false, requestMetadata: {
      queryPlanId: "qp-x-competitor",
      queryFamily: "comparison",
      demandSurface: "competitor_pain",
      xCompetitorPainCompetitor: "Jira",
      xCompetitorPainDisplacementAnchors: [...X_COMPETITOR_PAIN_DISPLACEMENT_ANCHORS],
    } };
    expect(provenanceForReplay(request, "x", [{ conversationId: "replay" }])[0]).toMatchObject({ xCompetitorPainRetrievalV1: compilerProvenance });
  });

  it("keeps the provider query, caps, and frozen versions unchanged", () => {
    const compiled = compileXQuery({ semanticQuery: "Jira vs Linear", family: "comparison", demandSurface: "competitor_pain", context: { product_name: "Linear", competitors: ["Jira"] } });
    expect(compiled.query).toBe('("switching from" OR "moving away from" OR "replace" OR "replacing" OR "alternative to" OR "leaving") Jira');
    expect(X_PROVIDER_MIN_RESULTS).toBe(10);
    expect(estimateXReadCost(10, 0.005)).toBe(0.05);
    expect(queryPlanningVersion).toBe("query_planning_v7");
    expect(SIGNAL_QUALIFICATION_VERSION).toBe("signal_qualification_v1_7");
    expect(SIGNAL_QUALIFICATION_THRESHOLD_VERSION).toBe("signal_qualification_thresholds_v1");
    expect(SEMANTIC_REASONING_ROUTER_VERSION).toBe("semantic_reasoning_router_v2");
  });
});
