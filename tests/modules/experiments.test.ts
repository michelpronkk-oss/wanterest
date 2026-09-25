import { describe, expect, it } from "vitest";

import { InMemoryExperimentRepository } from "../../src/server/modules/experiments/experiment.repository";
import { ExperimentService } from "../../src/server/modules/experiments/experiment.service";
import { legacyExperimentRow } from "./experiment.fixtures";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const actionId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
function createService() {
  const repository = new InMemoryExperimentRepository();
  const service = new ExperimentService({ repository });
  // Layer 11: creation is only the atomic create_experiment RPC; legacy Phase 7 rows are seeded directly.
  const create = (name: string, targetKey: string) => repository.createExperiment(legacyExperimentRow({ workspaceId, productId, actionId, name, targetKey, createdBy: userId }));
  return { repository, service, create };
}

describe("Phase 7 experiments", () => {
  it("keeps legacy rows on explicit control and exact allocation weights", async () => {
    const { service, create } = createService();
    expect("createExperiment" in service).toBe(false);
    const experiment = await create("Hero test", "hero");
    await service.createVariant({ workspaceId, experimentId: experiment.id, variantKey: "control", label: "Control", content: { headline: "Old" }, target: { pagePath: "/", key: "hero" }, allocationWeight: 5000, isControl: true });
    await service.createVariant({ workspaceId, experimentId: experiment.id, variantKey: "treatment", label: "Treatment", content: { headline: "New" }, target: { pagePath: "/", key: "hero" }, allocationWeight: 5000, isControl: false });
    await expect(service.transition({ workspaceId, experimentId: experiment.id, toStatus: "ready" })).resolves.toMatchObject({ status: "ready" });
    await expect(service.transition({ workspaceId, experimentId: experiment.id, toStatus: "completed" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("assigns deterministically, idempotently records events, and calculates immutable descriptive snapshots", async () => {
    const { service, repository, create } = createService();
    const experiment = await create("Signup test", "cta");
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
    await service.transition({ workspaceId, experimentId: experiment.id, toStatus: "completed" });
    await expect(service.assignVariant({ workspaceId, experimentId: experiment.id, subjectKey: "another" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
