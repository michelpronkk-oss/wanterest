import { describe, expect, it } from "vitest";

import type { DemandProfileRow, ProductRow } from "../../src/server/db/database.helpers";
import { deterministicUuid, sha256Text } from "../../src/server/modules/ingestion/hash";
import { InMemoryIntelligenceRepository } from "../../src/server/modules/intelligence";
import { DemandIntelligenceService, FixtureDemandThemeEngine, InMemoryDemandRepository, normalizeFacet } from "../../src/server/modules/demand-intelligence";
import { driftAnchor, isComparableSnapshotPair, planDriftComparison, selectComparableDrifts } from "../../src/server/modules/demand-intelligence/drift-comparability";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const profileId = "33333333-3333-4333-8333-333333333333";
const product = { id: productId, workspace_id: workspaceId, name: "Workflow Helper", slug: "workflow-helper", website_url: null, status: "active", current_snapshot_id: null, current_demand_profile_id: profileId, created_at: "2026-06-01T00:00:00.000Z", updated_at: "2026-06-01T00:00:00.000Z" } as ProductRow;
const profile = { id: profileId, workspace_id: workspaceId, product_id: productId, evidence_node_id: deterministicUuid("profile-evidence"), profile_version: 1, audience: [], jobs: [], problems: ["manual work"], desired_outcomes: [], capabilities: [], alternatives: [], include_terms: ["manual"], exclude_terms: [], languages: ["en"], geographies: [], confidence: 0.85, engine_version_id: deterministicUuid("profile-engine"), model: "fixture", prompt_version: "fixture-v1", created_at: "2026-06-01T00:00:00.000Z" } as DemandProfileRow;

function seed(repository: InMemoryDemandRepository, id: string, value: string, date: string) {
  return repository.createObservation({
    id: deterministicUuid(id), workspace_id: workspaceId, product_id: productId, conversation_id: deterministicUuid(`c:${id}`),
    product_match_id: deterministicUuid(`m:${id}`), match_evaluation_id: deterministicUuid(`e:${id}`), conversation_analysis_id: deterministicUuid(`a:${id}`), signal_id: deterministicUuid(`s:${id}`), source_key: "fixture",
    evidence_node_id: deterministicUuid(`n:${id}`), observation_type: "pain", facet_key: "pain_theme", facet_value: value, normalized_value: normalizeFacet(value), intent_type: "high_intent", weight: 0.9, opportunity_score: 0.8, confidence: 0.9,
    observed_at: date, published_at: date, analysis_engine_version_id: deterministicUuid("ae"), match_engine_version_id: deterministicUuid("me"), observation_engine_version_id: deterministicUuid("oe"), input_fingerprint: sha256Text(id),
  });
}

describe("drift comparability v1", () => {
  it("anchors drift to UTC midnight and plans adjacent equal windows", () => {
    const now = new Date("2026-09-25T06:30:00.000Z");
    expect(driftAnchor(now)).toBe("2026-09-25T00:00:00.000Z");
    expect(planDriftComparison({ window: "7d", now, monitoringStartedAt: "2026-09-01T00:00:00.000Z" })).toEqual({
      comparable: true, currentPeriodEnd: "2026-09-25T00:00:00.000Z", previousPeriodEnd: "2026-09-18T00:00:00.000Z", previousPeriodStart: "2026-09-11T00:00:00.000Z",
    });
  });

  it("refuses drift until Wanterest has observed the whole previous window (no young-index trends)", () => {
    const now = new Date("2026-09-25T06:30:00.000Z");
    expect(planDriftComparison({ window: "7d", now, monitoringStartedAt: "2026-09-19T00:00:00.000Z" })).toEqual({ comparable: false, reason: "insufficient_history" });
    expect(planDriftComparison({ window: "30d", now, monitoringStartedAt: null })).toEqual({ comparable: false, reason: "insufficient_history" });
    expect(planDriftComparison({ window: "1y", now, monitoringStartedAt: "2020-01-01T00:00:00.000Z" })).toEqual({ comparable: false, reason: "unknown_window" });
  });

  it("computes and surfaces drift only between adjacent windows; overlapping legacy pairs are never surfaced", async () => {
    const repository = new InMemoryDemandRepository();
    const service = new DemandIntelligenceService(repository, new InMemoryIntelligenceRepository());
    for (let index = 0; index < 5; index++) await seed(repository, `prev:${index}`, index < 2 ? "manual workflow" : "crm fragmentation", "2026-09-14T00:00:00.000Z");
    for (let index = 0; index < 8; index++) await seed(repository, `cur:${index}`, "manual workflow", "2026-09-22T00:00:00.000Z");
    const base = { product, profile, window: "7d" as const, mapEngineVersionId: deterministicUuid("map"), themeEngineVersionId: deterministicUuid("theme"), themeEngine: new FixtureDemandThemeEngine() };
    await service.materializeThemes(product, profile, deterministicUuid("theme"), new FixtureDemandThemeEngine());

    // Legacy overlapping pair (two "now" snapshots hours apart).
    const nowA = await service.aggregateDemand({ ...base, periodEnd: "2026-09-25T03:00:00.000Z" });
    const nowB = await service.aggregateDemand({ ...base, periodEnd: "2026-09-25T06:00:00.000Z" });
    expect(isComparableSnapshotPair(nowB, nowA)).toBe(false);
    await expect(service.calculateDemandDrift(nowB, nowA, deterministicUuid("drift"))).resolves.toBeDefined();
    await expect(service.getDemandDrift(workspaceId, productId, "7d")).rejects.toThrow(/comparable/);

    // Adjacent, day-anchored pair.
    const plan = planDriftComparison({ window: "7d", now: new Date("2026-09-25T06:30:00.000Z"), monitoringStartedAt: "2026-09-01T00:00:00.000Z" });
    if (!plan.comparable) throw new Error("expected comparable plan");
    const current = await service.aggregateDemand({ ...base, periodEnd: plan.currentPeriodEnd });
    const previous = await service.aggregateDemand({ ...base, periodEnd: plan.previousPeriodEnd });
    expect(isComparableSnapshotPair(current, previous)).toBe(true);
    await service.calculateDemandDrift(current, previous, deterministicUuid("drift"));

    const read = await service.getDemandDrift(workspaceId, productId, "7d");
    expect(read.currentSnapshotId).toBe(current.id);
    expect(read.previousSnapshotId).toBe(previous.id);
    const selected = selectComparableDrifts(await repository.listSnapshots(workspaceId, productId), await repository.listDrifts(workspaceId, productId));
    expect(selected?.drifts.every((drift) => drift.current_snapshot_id === current.id && drift.previous_snapshot_id === previous.id)).toBe(true);
    expect(selected?.drifts.find((drift) => drift.concept_key === "manual_workflow_pain")?.drift_direction).toBe("rising");
  });
});
