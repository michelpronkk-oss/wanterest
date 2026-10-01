import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  claim: vi.fn(), settle: vi.fn(), wake: vi.fn(), fingerprint: vi.fn(),
  select: vi.fn(), canonical: vi.fn(), rebuild: vi.fn(),
  getMatch: vi.fn(), getSignal: vi.fn(), sourceStatus: "active", productProfile: "profile", rootLinkPresent: true, evidenceValid: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/providers/supabase/service", () => ({ createSupabaseServiceClient: () => ({
  from(table: string) {
    const query = {
      select() { return query; }, eq() { return query; }, in() { return query; },
      maybeSingle: async () => ({ data: table === "products" ? { id: "product", workspace_id: "workspace", name: "Product", status: "active", current_demand_profile_id: state.productProfile }
        : table === "conversations" ? { id: "root", primary_source_item_id: "source", content_hash: "conversation-hash", evidence_node_id: "conversation-evidence" }
          : table === "source_items" ? { id: "source", status: state.sourceStatus, content_hash: "source-hash", evidence_node_id: "source-evidence" }
            : table === "demand_profiles" ? { id: "profile", product_id: "product" }
              : table === "conversation_source_items" && state.rootLinkPresent ? { conversation_id: "root" } : null, error: null }),
      then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: table === "engine_versions"
        ? [{ id: "classifier", engine_type: "classifier", version: "fixture-classifier-v1" }, { id: "matcher", engine_type: "matcher", version: "fixture-matcher-v1" }]
        : [{ id: "conversation-evidence", node_type: "conversation", entity_id: "root", content_hash: state.evidenceValid ? "conversation-hash" : "invalid-hash" },
          { id: "source-evidence", node_type: "source_item", entity_id: "source", content_hash: "source-hash" }], error: null }).then(resolve); },
    };
    return query;
  },
}) }));
vi.mock("@/server/modules/operations/evaluation-backlog.repository", () => ({
  BACKLOG_BATCH_SIZE: 5, BACKLOG_SELECTION_VERSION: "candidate_selection_v3",
  backlogFingerprint: state.fingerprint, claimBacklog: state.claim, nextBacklogWake: state.wake, settleBacklog: state.settle,
}));
vi.mock("@/server/modules/onboarding/initial-scan.service", () => ({
  selectScanCandidates: state.select, processScanCandidates: state.canonical,
}));
vi.mock("@/server/modules/intelligence/intelligence.repository", () => ({
  SupabaseIntelligenceRepository: class { getMatch = state.getMatch; getSignalByMatch = state.getSignal; },
}));
vi.mock("@/server/modules/intelligence/engines", () => ({
  FixtureConversationAnalysisEngine: class { version = "fixture-classifier-v1"; },
  FixtureProductMatchingEngine: class { version = "fixture-matcher-v1"; },
}));
vi.mock("@/server/modules/demand-intelligence/demand.orchestration", () => ({ rebuildDemandIntelligenceForScan: state.rebuild }));
vi.mock("@/server/modules/products/product-lifecycle", () => ({ isActiveProduct: () => true }));
vi.mock("@/server/modules/intelligence/evidence-grounding", () => ({ evidenceFidelityGroundingEnabled: () => false }));

import { processEvaluationBacklogBatch } from "../../src/server/modules/operations/evaluation-backlog.processor";

const row = { id: "backlog", workspace_id: "workspace", product_id: "product", conversation_id: "root", source_item_id: "source",
  demand_profile_id: "profile", conversation_content_hash: "conversation-hash", source_content_hash: "source-hash",
  selection_version: "candidate_selection_v3", selection_fingerprint: "fingerprint", selection_rank: 16,
  selection_provenance: [], classifier_engine_version_id: "classifier", matcher_engine_version_id: "matcher",
  grounding_enabled: false, attempt_count: 1 };

describe("evaluation backlog processor", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs();
    state.sourceStatus = "active"; state.productProfile = "profile"; state.rootLinkPresent = true; state.evidenceValid = true;
    state.claim.mockResolvedValue([row]); state.settle.mockResolvedValue(undefined); state.wake.mockResolvedValue(null);
    state.fingerprint.mockReturnValue("fingerprint"); state.select.mockReturnValue({ conversations: [{ id: "root" }] });
    state.getMatch.mockResolvedValue(null); state.getSignal.mockResolvedValue(null);
    state.canonical.mockResolvedValue({ evaluationIds: ["evaluation"], signalIds: ["signal"],
      outcomes: [{ qualificationStatus: "qualified" }], diagnostics: [] });
    state.rebuild.mockResolvedValue({ warnings: [] });
  });

  it("runs the canonical selected-candidate path once and rebuilds qualified derived intelligence", async () => {
    const armRecovery = vi.fn().mockResolvedValue(undefined);
    const result = await processEvaluationBacklogBatch(undefined, armRecovery);
    expect(result).toMatchObject({ claimed: 1, succeeded: 1, skipped: 0, retryable: 0 });
    expect(armRecovery).toHaveBeenCalledOnce();
    expect(state.select).toHaveBeenCalledWith(expect.objectContaining({ max: 1, conversations: [expect.objectContaining({ id: "root" })] }));
    expect(state.canonical).toHaveBeenCalledOnce();
    expect(state.canonical).toHaveBeenCalledWith(expect.objectContaining({ maxLlmEvaluations: 1, conversationIds: ["root"], normalizedSourceItemIds: ["source"] }));
    expect(state.rebuild).toHaveBeenCalledWith(expect.objectContaining({ evaluationIds: ["evaluation"], signalIds: ["signal"] }));
    expect(state.settle).toHaveBeenCalledWith(expect.anything(), row, expect.any(String), expect.objectContaining({ status: "succeeded", evaluationId: "evaluation", signalId: "signal" }));
  });

  it("does not create a signal or derived rebuild for weak or rejected outcomes", async () => {
    for (const qualificationStatus of ["weak_candidate", "rejected"]) {
      state.canonical.mockResolvedValueOnce({ evaluationIds: ["evaluation"], signalIds: [null], outcomes: [{ qualificationStatus }], diagnostics: [] });
      await processEvaluationBacklogBatch();
    }
    expect(state.rebuild).not.toHaveBeenCalled();
    expect(state.settle).toHaveBeenCalledTimes(2);
  });

  it("skips invalidated provenance and changed profiles before canonical evaluation", async () => {
    state.sourceStatus = "removed";
    await processEvaluationBacklogBatch();
    expect(state.canonical).not.toHaveBeenCalled();
    expect(state.settle).toHaveBeenCalledWith(expect.anything(), row, expect.any(String), expect.objectContaining({ status: "skipped", code: "SOURCE_OR_ROOT_CHANGED" }));
    state.sourceStatus = "active"; state.productProfile = "other-profile";
    await processEvaluationBacklogBatch();
    expect(state.canonical).not.toHaveBeenCalled();
  });

  it("skips a broken primary root link or mismatched evidence node", async () => {
    state.rootLinkPresent = false;
    await processEvaluationBacklogBatch();
    expect(state.canonical).not.toHaveBeenCalled();
    expect(state.settle).toHaveBeenCalledWith(expect.anything(), row, expect.any(String), expect.objectContaining({ status: "skipped", code: "PROVENANCE_INVALID" }));
    state.rootLinkPresent = true; state.evidenceValid = false;
    await processEvaluationBacklogBatch();
    expect(state.canonical).not.toHaveBeenCalled();
  });

  it("re-runs the original evidence filters and terminally skips a newly rejected receipt", async () => {
    state.select.mockReturnValueOnce({ conversations: [], capSuppressed: [] });
    await processEvaluationBacklogBatch();
    expect(state.canonical).not.toHaveBeenCalled();
    expect(state.settle).toHaveBeenCalledWith(expect.anything(), row, expect.any(String), expect.objectContaining({ status: "skipped", code: "EVIDENCE_FILTER_CHANGED" }));
  });

  it("marks an existing signal obsolete and never re-materializes it", async () => {
    state.getMatch.mockResolvedValueOnce({ id: "match" });
    state.getSignal.mockResolvedValueOnce({ id: "existing-signal", product_match_evaluation_id: "existing-evaluation" });
    await processEvaluationBacklogBatch();
    expect(state.canonical).not.toHaveBeenCalled();
    expect(state.settle).toHaveBeenCalledWith(expect.anything(), row, expect.any(String), expect.objectContaining({ status: "skipped", code: "SIGNAL_ALREADY_EXISTS" }));
  });

  it("resumes only the derived rebuild when a prior attempt already materialized a signal", async () => {
    state.claim.mockResolvedValueOnce([{ ...row, attempt_count: 2 }]);
    state.getMatch.mockResolvedValueOnce({ id: "match" });
    state.getSignal.mockResolvedValueOnce({ id: "existing-signal", product_match_evaluation_id: "existing-evaluation" });
    await processEvaluationBacklogBatch();
    expect(state.canonical).not.toHaveBeenCalled();
    expect(state.rebuild).toHaveBeenCalledWith(expect.objectContaining({ evaluationIds: ["existing-evaluation"], signalIds: ["existing-signal"] }));
    expect(state.settle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ attempt_count: 2 }), expect.any(String), expect.objectContaining({ status: "succeeded" }));
  });

  it("resumes canonical materialization if an evaluation exists but its signal is missing", async () => {
    await processEvaluationBacklogBatch();
    expect(state.canonical).toHaveBeenCalledOnce();
    expect(state.settle).toHaveBeenCalledWith(expect.anything(), row, expect.any(String), expect.objectContaining({ status: "succeeded", signalId: "signal" }));
  });

  it("retries a failed canonical step with the same row and never duplicates its own signal path", async () => {
    state.canonical.mockRejectedValueOnce(new Error("sanitized fixture failure"));
    await processEvaluationBacklogBatch();
    expect(state.settle).toHaveBeenCalledWith(expect.anything(), row, expect.any(String), { status: "retryable", code: "EVALUATION_FAILED" });
    state.claim.mockResolvedValueOnce([{ ...row, attempt_count: 2 }]);
    await processEvaluationBacklogBatch();
    expect(state.canonical).toHaveBeenCalledTimes(2);
    expect(state.rebuild).toHaveBeenCalledOnce();
  });

  it("does not arm another recovery wake when the queue has no claimable rows", async () => {
    state.claim.mockResolvedValueOnce([]);
    const armRecovery = vi.fn();
    expect(await processEvaluationBacklogBatch(undefined, armRecovery)).toMatchObject({ claimed: 0 });
    expect(armRecovery).not.toHaveBeenCalled();
  });

  it("respects the operator kill switch without claiming work", async () => {
    vi.stubEnv("EVALUATION_BACKLOG_PROCESSING_ENABLED", "false");
    const armRecovery = vi.fn();
    expect(await processEvaluationBacklogBatch(undefined, armRecovery)).toMatchObject({ claimed: 0, nextWakeAt: null });
    expect(state.claim).not.toHaveBeenCalled();
    expect(armRecovery).not.toHaveBeenCalled();
  });
});
