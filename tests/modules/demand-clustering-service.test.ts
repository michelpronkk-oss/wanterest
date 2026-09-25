import { describe, expect, it } from "vitest";

import { DemandClusteringService, InMemoryDemandClusteringRepository } from "../../src/server/modules/demand-intelligence";
import { deterministicUuid } from "../../src/server/modules/ingestion/hash";
import { engineVersionId, now, productA, productA2, productB, seedEvidence, workspaceA, workspaceB } from "./demand-clustering.fixtures";

function setup() {
  const repository = new InMemoryDemandClusteringRepository();
  const service = new DemandClusteringService(repository);
  const run = (productId = productA, workspaceId = workspaceA, at = now) => service.clusterProduct({ workspaceId, productId, engineVersionId, now: at });
  return { repository, service, run };
}

describe("Stage 2G demand clustering service", () => {
  it("puts the same concept for the same product into one cluster, with provenance to every evidence layer", async () => {
    const { repository, service, run } = setup();
    const first = seedEvidence(repository, { key: "one", concepts: ["sprint_planning"] });
    const second = seedEvidence(repository, { key: "two", concepts: ["sprint_planning"], intent: "unmet_need" });
    const result = await run();
    expect(result).toMatchObject({ evaluationsConsidered: 2, clustersCreated: 1, membershipsCreated: 2, statesAppended: 1 });
    const [cluster] = await service.getDemandClusters(workspaceA, productA);
    expect(cluster.clusterKey).toBe("concept:sprint_planning|intent:pain|target:market");
    expect(cluster.strength).toMatchObject({ level: "repeated", distinctEvidenceCount: 2, sequence: 1 });
    expect(cluster.members.every((item) => item.contributes)).toBe(true);
    expect(cluster.explanation).toContain('"sprint_planning"');
    for (const item of [first, second]) {
      const membership = [...repository.memberships.values()].find((row) => row.match_evaluation_id === item.evaluation.id);
      const edges = repository.provenance.filter((edge) => edge.derivedEvidenceNodeId === membership?.evidence_node_id).map((edge) => [edge.relationType, edge.sourceEvidenceNodeId]);
      expect(edges).toEqual(expect.arrayContaining([
        ["clusters_match_evaluation", item.evaluation.evidence_node_id],
        ["clusters_conversation", item.conversation?.evidence_node_id],
        ["clusters_source_item", item.sourceItem?.evidence_node_id],
        ["clusters_signal", item.signal?.evidence_node_id],
        ["assigned_to_cluster", cluster.evidenceNodeId],
      ]));
    }
  });

  it("is idempotent on retry/replay: no new clusters, memberships, states or provenance", async () => {
    const { repository, run } = setup();
    seedEvidence(repository, { key: "one", concepts: ["sprint_planning"] });
    seedEvidence(repository, { key: "two", concepts: ["sprint_planning"] });
    await run();
    const counts = () => [repository.clusters.size, repository.memberships.size, repository.states.size, repository.provenance.length];
    const before = counts();
    const replay = await run();
    expect(replay).toMatchObject({ clustersCreated: 0, membershipsCreated: 0, statesAppended: 0 });
    expect(counts()).toEqual(before);
  });

  it("strengthens when a second distinct piece of evidence arrives, preserving the previous state", async () => {
    const { repository, service, run } = setup();
    seedEvidence(repository, { key: "one", concepts: ["sprint_planning"] });
    await run();
    const before = (await service.getDemandClusters(workspaceA, productA))[0].strength;
    seedEvidence(repository, { key: "two", concepts: ["sprint_planning"], createdAt: "2026-09-21T00:00:00.000Z" });
    const second = await run();
    expect(second).toMatchObject({ membershipsCreated: 1, statesAppended: 1 });
    const after = (await service.getDemandClusters(workspaceA, productA))[0].strength;
    expect(before).toMatchObject({ level: "single", distinctEvidenceCount: 1, sequence: 1 });
    expect(after).toMatchObject({ level: "repeated", distinctEvidenceCount: 2, sequence: 2, historyLength: 2 });
    expect(after!.score).toBeGreaterThan(before!.score);
    const states = [...repository.states.values()].sort((left, right) => left.sequence - right.sequence);
    expect(states[1].previous_state_id).toBe(states[0].id);
    expect(repository.provenance.some((edge) => edge.derivedEvidenceNodeId === states[1].evidence_node_id && edge.sourceEvidenceNodeId === states[0].evidence_node_id && edge.relationType === "supersedes_state")).toBe(true);
  });

  it("does not strengthen when the same evidence is processed twice (same conversation or identical content)", async () => {
    const { repository, service, run } = setup();
    seedEvidence(repository, { key: "one", concepts: ["sprint_planning"] });
    await run();
    const baseline = (await service.getDemandClusters(workspaceA, productA))[0].strength!;
    // A second product match cannot exist for the same conversation, so the realistic
    // duplicate is a repost: a different conversation with identical source content.
    seedEvidence(repository, { key: "repost", concepts: ["sprint_planning"], contentKey: "one", createdAt: "2026-09-21T00:00:00.000Z" });
    await run();
    const [cluster] = await service.getDemandClusters(workspaceA, productA);
    expect(cluster.strength).toMatchObject({ distinctEvidenceCount: 1, score: baseline.score, exclusions: { duplicate_content: 1 } });
    expect(cluster.members.find((item) => !item.contributes)?.exclusionReason).toBe("duplicate_content");
  });

  it("merges multi-source evidence for the same concept into one corroborated cluster with both provenance paths", async () => {
    const { repository, service, run } = setup();
    const github = seedEvidence(repository, { key: "gh", concepts: ["sprint_planning"], source: "github" });
    const stack = seedEvidence(repository, { key: "se", concepts: ["sprint_planning"], source: "stack-exchange", intent: "problem_solution_search" });
    await run();
    const clusters = await service.getDemandClusters(workspaceA, productA);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].strength).toMatchObject({ level: "corroborated", distinctSourceCount: 2, sourceMix: { github: 1, "stack-exchange": 1 } });
    const sourceEdges = repository.provenance.filter((edge) => edge.relationType === "clusters_source_item").map((edge) => edge.sourceEvidenceNodeId);
    expect(sourceEdges).toEqual(expect.arrayContaining([github.sourceItem!.evidence_node_id, stack.sourceItem!.evidence_node_id]));
  });

  it("never merges unrelated requests", async () => {
    const { repository, service, run } = setup();
    seedEvidence(repository, { key: "pain", concepts: ["sprint_planning"], intent: "explicit_pain" });
    seedEvidence(repository, { key: "switch", concepts: ["sprint_planning"], intent: "switching_intent", sourceProducts: ["Jira"] });
    seedEvidence(repository, { key: "other", concepts: ["roadmap_visibility"], intent: "explicit_pain" });
    seedEvidence(repository, { key: "feature", concepts: ["sprint_planning"], intent: "explicit_pain", target: "scanned_product" });
    await run();
    const clusters = await service.getDemandClusters(workspaceA, productA);
    expect(clusters).toHaveLength(4);
    expect(clusters.every((cluster) => cluster.strength?.distinctEvidenceCount === 1)).toBe(true);
  });

  it("never lets different products share a product-private cluster, even in the same workspace", async () => {
    const { repository, service, run } = setup();
    seedEvidence(repository, { key: "a", productId: productA, concepts: ["sprint_planning"] });
    seedEvidence(repository, { key: "a2", productId: productA2, concepts: ["sprint_planning"] });
    seedEvidence(repository, { key: "b", workspaceId: workspaceB, productId: productB, concepts: ["sprint_planning"] });
    await run(productA);
    await run(productA2);
    await run(productB, workspaceB);
    const a = await service.getDemandClusters(workspaceA, productA);
    const a2 = await service.getDemandClusters(workspaceA, productA2);
    const b = await service.getDemandClusters(workspaceB, productB);
    expect([a.length, a2.length, b.length]).toEqual([1, 1, 1]);
    expect(new Set([a[0].clusterId, a2[0].clusterId, b[0].clusterId]).size).toBe(3);
    expect(a[0].strength?.distinctEvidenceCount).toBe(1);
    // Cross-product reads return nothing.
    expect(await service.getDemandClusters(workspaceB, productA)).toEqual([]);
    // The composite FK rejects a membership pointing at another product's cluster.
    await expect(repository.createMembership({ ...[...repository.memberships.values()][0], id: deterministicUuid("forged"), product_id: productA2, match_evaluation_id: deterministicUuid("forged-evaluation") })).rejects.toThrow(/foreign key/);
  });

  it("stops counting invalidated, superseded (re-evaluated) and stale evidence, appending history instead of rewriting it", async () => {
    const { repository, service, run } = setup();
    const invalidated = seedEvidence(repository, { key: "one", concepts: ["sprint_planning"] });
    const superseded = seedEvidence(repository, { key: "two", concepts: ["sprint_planning"] });
    seedEvidence(repository, { key: "three", concepts: ["sprint_planning"], publishedAt: "2026-07-01T00:00:00.000Z" });
    await run();
    expect((await service.getDemandClusters(workspaceA, productA))[0].strength?.distinctEvidenceCount).toBe(3);
    const firstState = { ...[...repository.states.values()][0] };

    invalidated.signal = { ...invalidated.signal!, lifecycle_status: "invalidated" };
    superseded.currentEvaluationId = deterministicUuid("re-evaluated-as-weak");
    await run();
    let [cluster] = await service.getDemandClusters(workspaceA, productA);
    expect(cluster.strength).toMatchObject({ distinctEvidenceCount: 1, sequence: 2, exclusions: { evaluation_superseded: 1, signal_invalidated: 1 } });
    expect(cluster.members.filter((item) => !item.contributes).map((item) => item.exclusionReason).sort()).toEqual(["evaluation_superseded", "signal_invalidated"]);

    // Ninety days later the remaining evidence is stale: strength reaches zero, cluster remains.
    await run(productA, workspaceA, new Date("2026-10-15T00:00:00.000Z"));
    [cluster] = await service.getDemandClusters(workspaceA, productA);
    expect(cluster.strength).toMatchObject({ level: "inactive", score: 0, sequence: 3, historyLength: 3 });
    expect(repository.memberships.size).toBe(3);
    expect(repository.states.get(firstState.id)).toEqual(firstState);
  });

  it("ignores unqualified evaluations and records why evidence was not clustered", async () => {
    const { repository, run } = setup();
    seedEvidence(repository, { key: "weak", concepts: ["sprint_planning"], decision: "weak", status: "weak_candidate" });
    seedEvidence(repository, { key: "gate", concepts: ["sprint_planning"], status: "weak_candidate" });
    seedEvidence(repository, { key: "no-concept", concepts: [] });
    const result = await run();
    expect(result).toMatchObject({ evaluationsConsidered: 2, clustersCreated: 0, membershipsCreated: 0, unclustered: { not_qualified: 1, no_profile_concept: 1 } });
    expect(repository.clusters.size).toBe(0);
  });

  it("derives identical cluster and membership IDs from identical inputs (deterministic identity)", async () => {
    const left = setup();
    const right = setup();
    for (const env of [left, right]) {
      seedEvidence(env.repository, { key: "one", concepts: ["sprint_planning"] });
      seedEvidence(env.repository, { key: "two", concepts: ["roadmap_visibility"], intent: "feature_requirement" });
      await env.run();
    }
    expect([...left.repository.clusters.keys()].sort()).toEqual([...right.repository.clusters.keys()].sort());
    expect([...left.repository.memberships.keys()].sort()).toEqual([...right.repository.memberships.keys()].sort());
    expect([...left.repository.states.values()].map((row) => row.input_fingerprint).sort()).toEqual([...right.repository.states.values()].map((row) => row.input_fingerprint).sort());
  });

  it("treats a lost state race as success only when the winner recorded the same outcome", async () => {
    const { repository, run } = setup();
    seedEvidence(repository, { key: "one", concepts: ["sprint_planning"] });
    await run();
    const original = repository.createState.bind(repository);
    let raced = false;
    repository.createState = async (input) => {
      if (!raced) { raced = true; await original(input); return null; }
      return original(input);
    };
    seedEvidence(repository, { key: "two", concepts: ["sprint_planning"], createdAt: "2026-09-21T00:00:00.000Z" });
    const result = await run();
    expect(result.statesAppended).toBe(0);
    expect(repository.states.size).toBe(2);
  });
});
