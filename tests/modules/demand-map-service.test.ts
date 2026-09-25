import { describe, expect, it } from "vitest";

import { DemandClusteringService, DemandMapService, InMemoryDemandClusteringRepository, type DemandMapReadModel } from "../../src/server/modules/demand-intelligence";
import { engineVersionId, now, productA, productA2, productB, seedEvidence, workspaceA, workspaceB } from "./demand-clustering.fixtures";

function setup() {
  const repository = new InMemoryDemandClusteringRepository();
  const clustering = new DemandClusteringService(repository);
  const service = new DemandMapService(repository);
  const cluster = (productId = productA, workspaceId = workspaceA, at = now) => clustering.clusterProduct({ workspaceId, productId, engineVersionId, now: at });
  const read = (input: { productId?: string; workspaceId?: string; at?: Date; legacy?: DemandMapReadModel | null } = {}) =>
    service.getDemandMap({ workspaceId: input.workspaceId ?? workspaceA, productId: input.productId ?? productA, legacy: input.legacy ?? null, now: input.at ?? now });
  return { repository, clustering, cluster, read };
}

/** Legacy 30d snapshot shaped like production's: it still counts superseded/invalidated evidence. */
const legacySnapshot = {
  snapshot: { id: "legacy-snapshot", window_type: "30d", period_start: "2026-08-26T00:00:00.000Z", period_end: "2026-09-25T00:00:00.000Z", sample_size: 7, qualified_signal_count: 8, source_mix: { github: 0.86, x: 0.14 }, intent_mix: { switching_intent: 0.43 } },
  themes: [{ id: "t1", theme_key: "switching_intent", share_of_demand: 1, mention_count: 7 }],
  phrases: [{ id: "p1", phrase_type: "buyer_language", phrase: "replace jira", share_of_demand: 0.3, mention_count: 2 }],
  alternatives: [{ id: "a1", alternative: "Jira", mention_count: 5 }],
  intents: [],
  provenance: { evidenceNodeId: "legacy-node", sourceIds: [] },
} as unknown as DemandMapReadModel;

describe("Layer 9A demand map service", () => {
  it("Linear-shaped production case: 11 memberships all excluded => 0 current concepts, 1 previously observed", async () => {
    const { repository, cluster, read } = setup();
    // 8 matches re-evaluated as weak, plus one match evaluated twice (both superseded) = 10 superseded.
    for (let index = 0; index < 8; index += 1) seedEvidence(repository, { key: `superseded-${index}`, concepts: ["jira"], intent: index % 2 ? "alternative_search" : "switching_intent", target: "unknown", current: false, signalStatus: index < 6 ? "archived" : "dismissed" });
    seedEvidence(repository, { key: "twice-a", conversationKey: "shared", matchKey: "shared-match", concepts: ["jira"], intent: "alternative_search", target: "unknown", current: false, signalStatus: "archived" });
    seedEvidence(repository, { key: "twice-b", conversationKey: "shared", matchKey: "shared-match", concepts: ["jira"], intent: "alternative_search", target: "unknown", current: false, signalStatus: "archived", createdAt: "2026-09-21T00:00:00.000Z" });
    // The only still-current evaluation, whose signal was invalidated.
    seedEvidence(repository, { key: "invalidated", source: "x", concepts: ["jira"], intent: "switching_intent", target: "unknown", signalStatus: "invalidated" });
    expect(await cluster()).toMatchObject({ evaluationsConsidered: 11, clustersCreated: 1, membershipsCreated: 11, statesAppended: 1 });

    const result = await read({ legacy: legacySnapshot });
    expect(result.current).toEqual([]);
    expect(result.totals).toEqual({ currentConceptCount: 0, activeEvidenceCount: 0, activeSourceCount: 0, sourceMix: {}, lastActiveEvidenceAt: null });
    expect(result.previouslyObserved).toHaveLength(1);
    expect(result.previouslyObserved[0]).toMatchObject({ conceptKey: "jira", label: "Jira", status: "historical", activeEvidenceCount: 0, level: null, exclusions: { evaluation_superseded: 10, signal_invalidated: 1 }, updatePending: false });
    expect(result.previouslyObserved[0].clusters[0].clusterKey).toBe("concept:jira|intent:switch|target:market");
    expect(result.previouslyObserved[0].clusters[0].members).toHaveLength(11);
    // Legacy is carried only as labelled history; its 8 "qualified signals" never reach the headline.
    expect(result.historical).toEqual({ label: "not_lifecycle_filtered", legacy: legacySnapshot });
  });

  it("removes a member invalidated after the cluster state was computed, and flags the concept update-pending", async () => {
    const { repository, cluster, read } = setup();
    const invalidated = seedEvidence(repository, { key: "gh", concepts: ["sprint_planning"], source: "github" });
    seedEvidence(repository, { key: "bs", concepts: ["sprint_planning"], source: "bluesky" });
    await cluster();
    expect((await read()).current[0]).toMatchObject({ activeEvidenceCount: 2, activeSourceCount: 2, level: "corroborated", updatePending: false });
    const statesBefore = repository.states.size;

    invalidated.signal = { ...invalidated.signal!, lifecycle_status: "invalidated" };
    const result = await read();
    expect(result.current[0]).toMatchObject({ activeEvidenceCount: 1, activeSourceCount: 1, level: "single", sourceMix: { bluesky: 1 }, exclusions: { signal_invalidated: 1 }, updatePending: true });
    expect(result.diagnostics.updatePending).toBe(true);
    // Read-only: the map never appends states or rewrites history.
    expect(repository.states.size).toBe(statesBefore);
  });

  it("excludes superseded, retracted and stale members at read time", async () => {
    const { repository, cluster, read } = setup();
    const superseded = seedEvidence(repository, { key: "one", concepts: ["sprint_planning"] });
    const retracted = seedEvidence(repository, { key: "two", concepts: ["sprint_planning"] });
    seedEvidence(repository, { key: "three", concepts: ["sprint_planning"], publishedAt: "2026-07-10T00:00:00.000Z" });
    await cluster();
    expect((await read()).current[0].activeEvidenceCount).toBe(3);

    superseded.currentEvaluationId = "re-evaluated-as-weak";
    retracted.signal = { ...retracted.signal!, lifecycle_status: "retracted" };
    const later = await read({ at: new Date("2026-10-15T00:00:00.000Z") });
    expect(later.current).toEqual([]);
    expect(later.previouslyObserved[0].exclusions).toEqual({ evaluation_superseded: 1, signal_retracted: 1, stale: 1 });
  });

  it("takes buyer language only from live contributing evaluations (max 3, most frequent first)", async () => {
    const { repository, cluster, read } = setup();
    const live = seedEvidence(repository, { key: "live", concepts: ["sprint_planning"] });
    const live2 = seedEvidence(repository, { key: "live2", concepts: ["sprint_planning"] });
    const dead = seedEvidence(repository, { key: "dead", concepts: ["sprint_planning"], signalStatus: "invalidated" });
    await cluster();
    const add = (evaluationId: string, phrase: string) => repository.buyerLanguage.push({ workspaceId: workspaceA, productId: productA, matchEvaluationId: evaluationId, phrase, normalizedValue: phrase.toLowerCase() });
    add(live.evaluation.id, "sprint planning is painful");
    add(live2.evaluation.id, "sprint planning is painful");
    add(live.evaluation.id, "estimates are always wrong");
    add(live2.evaluation.id, "backlog grooming takes hours");
    add(live.evaluation.id, "zz least frequent");
    add(dead.evaluation.id, "revoked phrase must not appear");
    const [concept] = (await read()).current;
    expect(concept.buyerLanguage).toEqual(["sprint planning is painful", "backlog grooming takes hours", "estimates are always wrong"]);
    expect(repository.calls.listBuyerLanguage).toBe(1);
  });

  it("never leaks another product's or workspace's clusters", async () => {
    const { repository, cluster, read } = setup();
    seedEvidence(repository, { key: "a", productId: productA, concepts: ["sprint_planning"] });
    seedEvidence(repository, { key: "a2", productId: productA2, concepts: ["roadmap_visibility"] });
    seedEvidence(repository, { key: "b", workspaceId: workspaceB, productId: productB, concepts: ["billing"] });
    await cluster(productA);
    await cluster(productA2);
    await cluster(productB, workspaceB);
    expect((await read()).current.map((concept) => concept.conceptKey)).toEqual(["sprint_planning"]);
    expect((await read({ productId: productA2 })).current.map((concept) => concept.conceptKey)).toEqual(["roadmap_visibility"]);
    expect(await read({ workspaceId: workspaceB, productId: productA })).toMatchObject({ current: [], previouslyObserved: [] });

    // Defensive: even if a repository returned foreign rows, the service drops them.
    const leaky = Object.create(repository) as InMemoryDemandClusteringRepository;
    leaky.listClusters = async () => [...repository.clusters.values()];
    leaky.listMemberships = async () => [...repository.memberships.values()];
    const result = await new DemandMapService(leaky).getDemandMap({ workspaceId: workspaceA, productId: productA, legacy: null, now });
    expect([...result.current, ...result.previouslyObserved].map((concept) => concept.conceptKey)).toEqual(["sprint_planning"]);
  });

  it("returns a truthful empty model when nothing has been clustered, without extra reads", async () => {
    const { repository, read } = setup();
    const result = await read({ legacy: legacySnapshot });
    expect(result).toMatchObject({ current: [], previouslyObserved: [], totals: { currentConceptCount: 0, activeEvidenceCount: 0 } });
    expect(result.historical.legacy).toBe(legacySnapshot);
    expect(repository.calls.listLatestStates ?? 0).toBe(0);
  });

  it("reads cluster state in batches: one latest-state read regardless of cluster count, no per-cluster queries", async () => {
    for (const clusterCount of [1, 6]) {
      const { repository, cluster, read, clustering } = setup();
      for (let index = 0; index < clusterCount; index += 1) seedEvidence(repository, { key: `k${index}`, concepts: [`concept_${index}`] });
      await cluster();
      for (const key of Object.keys(repository.calls)) delete repository.calls[key];
      await read();
      expect(repository.calls).toEqual({ listLatestStates: 1, listStateContributionsForStates: 1, loadMatchLifecycle: 1, listBuyerLanguage: 1 });

      // The Stage 2G read model uses the same batched path (N+1 fixed).
      for (const key of Object.keys(repository.calls)) delete repository.calls[key];
      const clusters = await clustering.getDemandClusters(workspaceA, productA);
      expect(clusters).toHaveLength(clusterCount);
      expect(repository.calls).toEqual({ listLatestStates: 1, listStateContributionsForStates: 1 });
    }
  });
});
