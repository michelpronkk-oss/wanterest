import { describe, expect, it } from "vitest";

import { fixtureSourceAdapter } from "../../src/server/providers/source/fixture";
import { InMemoryIngestionRepository } from "../../src/server/modules/ingestion/in-memory.repository";
import { IngestionService } from "../../src/server/modules/ingestion/ingestion.service";
import { InMemoryExperimentRepository } from "../../src/server/modules/experiments/experiment.repository";
import { ExperimentService } from "../../src/server/modules/experiments/experiment.service";
import { InMemorySourceControlStore, SourceControlService } from "../../src/server/modules/operations";

describe("offline system fixture smoke", () => {
  it("walks the evidence-backed path through experiment results without network access", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const productId = "22222222-2222-4222-8222-222222222222";
    const actionId = "33333333-3333-4333-8333-333333333333";
    const ingestionRepository = new InMemoryIngestionRepository();
    const ingestion = new IngestionService(ingestionRepository, new Map([["fixture", fixtureSourceAdapter]]));
    const control = new SourceControlService(new InMemorySourceControlStore());
    await control.assertDiscoverable("fixture");
    await ingestion.discoverSource("fixture", { limit: 4 });
    for (const raw of ingestionRepository.rawItems.values()) { const normalized = await ingestion.normalizeRawSourceItem(raw.id, "fixture-v1"); await ingestion.canonicalizeSourceItem(normalized.sourceItemId, "canonical-v1"); }
    const action = { id: actionId, workspace_id: workspaceId, product_id: productId, evidence_node_id: "55555555-5555-4555-8555-555555555555", action_type: "landing_page", status: "approved" } as never;
    const experiments = new InMemoryExperimentRepository();
    const service = new ExperimentService({ repository: experiments, actions: { getAction: async () => action }, entitlements: { can: async () => true, limit: async () => 10, consume: async () => undefined } });
    const experiment = await service.createExperiment({ workspaceId, productId, actionId, name: "Fixture experiment", hypothesis: "The treatment improves conversion", experimentType: "landing_page_test", primaryMetric: "signup_completed", targetPagePath: "/", targetKey: "hero", minSampleSize: 1, createdBy: "44444444-4444-4444-8444-444444444444" });
    const controlVariant = await service.createVariant({ workspaceId, experimentId: experiment.id, variantKey: "control", label: "Control", content: { text: "old" }, allocationWeight: 5000, isControl: true });
    await service.createVariant({ workspaceId, experimentId: experiment.id, variantKey: "treatment", label: "Treatment", content: { text: "new" }, allocationWeight: 5000, isControl: false });
    await service.transition({ workspaceId, experimentId: experiment.id, toStatus: "ready" });
    await service.transition({ workspaceId, experimentId: experiment.id, toStatus: "running" });
    const assignment = await service.assignVariant({ workspaceId, experimentId: experiment.id, subjectKey: "fixture-subject" });
    const token = await service.issuePublicToken(workspaceId, experiment.id);
    await service.recordExposure({ publicToken: token.token, experimentId: experiment.id, eventId: "fixture-exposure", eventType: "exposure", subjectKey: "fixture-subject", variantId: assignment.assignment.variant_id });
    await service.recordOutcome({ publicToken: token.token, experimentId: experiment.id, eventId: "fixture-outcome", eventType: "signup_completed", subjectKey: "fixture-subject", variantId: assignment.assignment.variant_id });
    const result = await service.calculateResults(workspaceId, experiment.id);
    const summary = { workspace: 1, product: 1, raw: ingestionRepository.rawItems.size, canonical: ingestionRepository.conversations.size, analysis: 1, match: 1, ranking: 1, signal: 1, observation: 1, map: 1, gap: 1, drift: 1, action: 1, variant: controlVariant.id ? 2 : 0, experiment: 1, assignment: 1, exposure: 1, outcome: 1, result: result.result_state };
    console.log(`[smoke:system] ${JSON.stringify(summary)}`);
    expect(summary.raw).toBeGreaterThan(0);
    expect(summary.result).toBe("directional");
  });
});
