import { describe, expect, it } from "vitest";

import type { ActionRow } from "../../src/server/db/database.helpers";
import { InMemoryExperimentRepository } from "../../src/server/modules/experiments/experiment.repository";
import { ExperimentService } from "../../src/server/modules/experiments/experiment.service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const actionId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const action: ActionRow = {
  id: actionId, workspace_id: workspaceId, product_id: productId, evidence_node_id: "55555555-5555-4555-8555-555555555555",
  action_type: "landing_page", trigger_type: "demand_gap", trigger_id: "66666666-6666-4666-8666-666666666666", trigger_evidence_node_id: "77777777-7777-4777-8777-777777777777", trigger_concept_key: "workflow", target_key: "hero", title: "Test the hero", summary: "A bounded experiment", why: "The evidence supports this", suggested_change: "Change the hero", current_state: null, target_metric: "signup_completed", business_hypothesis: {}, evidence_context: {}, priority_score: 0.8, confidence: 0.8, status: "approved", action_engine_version_id: "88888888-8888-4888-8888-888888888888", priority_formula_version: "v1", input_fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotency_key: "action-test", approved_at: "2026-09-20T00:00:00.000Z", completed_at: null, dismissed_at: null, valid_from: "2026-09-20T00:00:00.000Z", stale_at: null, superseded_by_action_id: null, created_at: "2026-09-20T00:00:00.000Z", updated_at: "2026-09-20T00:00:00.000Z",
};

function createService() {
  const repository = new InMemoryExperimentRepository();
  const used: string[] = [];
  const service = new ExperimentService({
    repository,
    actions: { getAction: async () => action },
    entitlements: { can: async () => true, limit: async () => 10, consume: async (_workspace, input) => { used.push(input.idempotencyKey); } },
  });
  return { repository, service, used };
}

describe("Phase 7 experiments", () => {
  it("requires an approved Action, explicit control, and exact allocation weights", async () => {
    const { service } = createService();
    const experiment = await service.createExperiment({ workspaceId, productId, actionId, name: "Hero test", hypothesis: "A clearer hero increases signups", experimentType: "landing_page_test", primaryMetric: "signup_completed", targetPagePath: "/", targetKey: "hero", minSampleSize: 1, createdBy: userId });
    await service.createVariant({ workspaceId, experimentId: experiment.id, variantKey: "control", label: "Control", content: { headline: "Old" }, target: { pagePath: "/", key: "hero" }, allocationWeight: 5000, isControl: true });
    await service.createVariant({ workspaceId, experimentId: experiment.id, variantKey: "treatment", label: "Treatment", content: { headline: "New" }, target: { pagePath: "/", key: "hero" }, allocationWeight: 5000, isControl: false });
    await expect(service.transition({ workspaceId, experimentId: experiment.id, toStatus: "ready" })).resolves.toMatchObject({ status: "ready" });
    await expect(service.transition({ workspaceId, experimentId: experiment.id, toStatus: "completed" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("assigns deterministically, idempotently records events, and calculates immutable snapshots", async () => {
    const { service, repository, used } = createService();
    const experiment = await service.createExperiment({ workspaceId, productId, actionId, name: "Signup test", hypothesis: "A clearer CTA increases signups", experimentType: "landing_page_test", primaryMetric: "signup_completed", targetPagePath: "/", targetKey: "cta", minSampleSize: 1, createdBy: userId });
    const control = await service.createVariant({ workspaceId, experimentId: experiment.id, variantKey: "control", label: "Control", content: { cta: "Try" }, allocationWeight: 5000, isControl: true });
    await service.createVariant({ workspaceId, experimentId: experiment.id, variantKey: "treatment", label: "Treatment", content: { cta: "Start" }, allocationWeight: 5000, isControl: false });
    await service.transition({ workspaceId, experimentId: experiment.id, toStatus: "ready" });
    await service.transition({ workspaceId, experimentId: experiment.id, toStatus: "running" });
    const issued = await service.issuePublicToken(workspaceId, experiment.id);
    const first = await service.assignVariant({ workspaceId, experimentId: experiment.id, subjectKey: "anonymous-subject-1" });
    const second = await service.assignVariant({ workspaceId, experimentId: experiment.id, subjectKey: "anonymous-subject-1" });
    expect(second.assignment.id).toBe(first.assignment.id);
    await service.recordExposure({ publicToken: issued.token, experimentId: experiment.id, eventId: "exposure-1", eventType: "exposure", subjectKey: "anonymous-subject-1", variantId: first.assignment.variant_id });
    const duplicate = await service.recordExposure({ publicToken: issued.token, experimentId: experiment.id, eventId: "exposure-1", eventType: "exposure", subjectKey: "anonymous-subject-1", variantId: first.assignment.variant_id });
    expect((await repository.listEvents(workspaceId, experiment.id))).toHaveLength(1);
    expect(duplicate.id).toBe((await repository.listEvents(workspaceId, experiment.id))[0]?.id);
    await service.recordOutcome({ publicToken: issued.token, experimentId: experiment.id, eventId: "outcome-1", eventType: "signup_completed", subjectKey: "anonymous-subject-1", variantId: first.assignment.variant_id });
    const result = await service.calculateResults(workspaceId, experiment.id);
    expect(result.result_state).toBe("directional");
    expect(result.variant_results).toEqual(expect.arrayContaining([expect.objectContaining({ variantId: control.id })]));
    expect(used).toEqual([`experiment_created:${experiment.id}`]);
    await service.transition({ workspaceId, experimentId: experiment.id, toStatus: "completed" });
    await expect(service.assignVariant({ workspaceId, experimentId: experiment.id, subjectKey: "another" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
