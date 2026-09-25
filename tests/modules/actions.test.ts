import { describe, expect, it } from "vitest";

import { InMemoryActionRepository } from "../../src/server/modules/actions/action.repository";
import { calculateActionPriority, FixtureDemandActionEngine, FixtureDemandActionVariantEngine } from "../../src/server/modules/actions/action.engines";
import { DemandActionService, transitionIsAllowed } from "../../src/server/modules/actions/action.service";
import { DigestService, InMemoryDigestSource } from "../../src/server/modules/digests";
import type { ActionGenerationInput } from "../../src/server/modules/actions/action.schemas";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const triggerId = "33333333-3333-4333-8333-333333333333";
const triggerEvidenceNodeId = "44444444-4444-4444-8444-444444444444";

function input(overrides: Partial<ActionGenerationInput> = {}): ActionGenerationInput {
  return {
    workspaceId, productId, productName: "Workflow Helper", triggerType: "demand_gap", triggerId,
    triggerEvidenceNodeId, triggerConceptKey: "manual_workflow_pain", conceptLabel: "manual workflow pain",
    targetKey: "homepage_hero", marketWeight: 0.31, gapScore: 0.78, driftStrength: 0,
    intentStrength: 0.8, opportunityScore: 0.7, evidenceStrength: 0.9, confidence: 0.9, freshness: 0.95,
    sampleSize: 31, sampleQuality: "normal", positioningWeight: 0.04, highIntentShare: 0.7,
    specificity: 0.8, buyerLanguage: ["falling through the cracks"], supportingEvidence: [], ...overrides,
  };
}

describe("Phase 5 actions", () => {
  it("creates a strong gap Action once and keeps retry usage idempotent", async () => {
    const repository = new InMemoryActionRepository();
    const service = new DemandActionService(repository);
    const first = await service.generateActions(input(), new FixtureDemandActionEngine());
    const second = await service.generateActions(input(), new FixtureDemandActionEngine());
    expect(first.actions).toHaveLength(1);
    expect(first.actions[0].action_type).toBe("messaging_change");
    expect(first.actions[0].priority_score).toBeGreaterThan(0);
    expect(second.actions[0].id).toBe(first.actions[0].id);
    expect(repository.consumedUsage.size).toBe(1);
    expect(repository.provenance.some((edge) => edge.relationType === "triggered_by")).toBe(true);
  });

  it("returns no Action for weak evidence and respects disabled entitlements", async () => {
    const weak = new DemandActionService(new InMemoryActionRepository());
    expect((await weak.generateActions(input({ gapScore: 0.2, sampleSize: 3, sampleQuality: "low_confidence" }))).actions).toHaveLength(0);
    const disabled = new DemandActionService(new InMemoryActionRepository(), { can: async () => false });
    const output = await disabled.generateActions(input());
    expect(output.actions).toHaveLength(0);
    expect(output.suppressed).toContain("actions_enabled");
  });

  it("ranks evidence deterministically and lowers stale/weak priority", () => {
    const strong = calculateActionPriority({ evidenceStrength: 1, marketWeight: 0.8, gapScore: 0.8, driftStrength: 0, intentStrength: 0.9, opportunityScore: 0.9, confidence: 0.9, freshness: 1 });
    const weak = calculateActionPriority({ evidenceStrength: 0.3, marketWeight: 0.1, gapScore: 0.1, driftStrength: 0, intentStrength: 0.2, opportunityScore: 0.2, confidence: 0.3, freshness: 0.1 });
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeGreaterThanOrEqual(0);
    expect(strong).toBeLessThanOrEqual(1);
    expect(transitionIsAllowed("proposed", "approved")).toBe(true);
    expect(transitionIsAllowed("completed", "approved")).toBe(false);
  });

  it("creates immutable structured variants, enforces lifecycle, and preserves feedback history", async () => {
    const repository = new InMemoryActionRepository();
    const service = new DemandActionService(repository);
    const [action] = (await service.generateActions(input())).actions;
    const variants = await service.generateActionVariants(workspaceId, action.id, "Workflow Helper", new FixtureDemandActionVariantEngine());
    expect(variants).toHaveLength(2);
    expect(variants[0].content).toHaveProperty("headline");
    expect(repository.provenance.some((edge) => edge.relationType === "variant_of")).toBe(true);
    await service.transitionAction({ workspaceId, actionId: action.id, toStatus: "approved", actorKind: "system" });
    await service.transitionAction({ workspaceId, actionId: action.id, toStatus: "in_progress", actorKind: "system" });
    await service.transitionAction({ workspaceId, actionId: action.id, toStatus: "completed", actorKind: "system" });
    await expect(service.transitionAction({ workspaceId, actionId: action.id, toStatus: "approved" })).rejects.toThrow("cannot transition");
    await service.addFeedback({ workspaceId, productId, actionId: action.id, actorUserId: "55555555-5555-4555-8555-555555555555", feedbackType: "useful" });
    await service.addFeedback({ workspaceId, productId, actionId: action.id, actorUserId: "55555555-5555-4555-8555-555555555555", feedbackType: "saved" });
    const read = await service.getAction(workspaceId, action.id);
    expect(read.feedback).toHaveLength(2);
    expect(read.feedbackState.useful).toBe(true);
    expect(read.feedbackState.saved).toBe(true);
    expect(read.action.status).toBe("completed");
  });

  it("materializes a deterministic traceable digest and suppresses stale/dismissed Actions", async () => {
    const repository = new InMemoryActionRepository();
    const service = new DemandActionService(repository);
    const [active] = (await service.generateActions(input())).actions;
    const [dismissed] = (await service.generateActions(input({ triggerId: "66666666-6666-4666-8666-666666666666", triggerEvidenceNodeId: "77777777-7777-4777-8777-777777777777" }))).actions;
    await service.transitionAction({ workspaceId, actionId: dismissed.id, toStatus: "dismissed" });
    await service.markStale(workspaceId, active.id);
    const source = new InMemoryDigestSource();
    source.candidates.push({ itemType: "gap", itemId: triggerId, sourceEvidenceNodeId: triggerEvidenceNodeId, score: 0.95, reason: "Largest current gap" });
    const digests = new DigestService(repository, source);
    const period = { workspaceId, productId, periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z", digestType: "weekly" as const, renderVersion: "render-v1" };
    const first = await digests.buildDigest(period);
    const retry = await digests.buildDigest(period);
    expect(first.digest.id).toBe(retry.digest.id);
    expect(first.items.map((item) => item.item_type)).toContain("gap");
    expect(first.items.map((item) => item.item_id)).not.toContain(active.id);
    expect(first.items.map((item) => item.item_id)).not.toContain(dismissed.id);
    expect(first.provenance.sourceEvidenceNodeIds).toContain(triggerEvidenceNodeId);
  });

  it("Layer 10: expired Actions are never digest content (even before stale_at is visible)", async () => {
    const repository = new InMemoryActionRepository();
    const service = new DemandActionService(repository);
    const [kept] = (await service.generateActions(input())).actions;
    const [expired] = (await service.generateActions(input({ triggerId: "88888888-8888-4888-8888-888888888888", triggerEvidenceNodeId: "99999999-9999-4999-8999-999999999999" }))).actions;
    repository.actions.set(expired.id, { ...repository.actions.get(expired.id)!, status: "expired", stale_at: null });
    const digests = new DigestService(repository, new InMemoryDigestSource());
    const built = await digests.buildDigest({ workspaceId, productId, periodStart: "2020-01-01T00:00:00.000Z", periodEnd: "2100-01-01T00:00:00.000Z", digestType: "weekly", renderVersion: "render-v1" });
    const ids = built.items.map((item) => item.item_id);
    expect(ids).toContain(kept.id);
    expect(ids).not.toContain(expired.id);
  });
});
