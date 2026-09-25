import { describe, expect, it } from "vitest";

import { DemandMapService, SupabaseDemandClusteringRepository } from "../../src/server/modules/demand-intelligence";

type Row = Record<string, unknown>;

/** Minimal PostgREST-shaped fake that records every table query and its filters. */
class FakeClient {
  readonly queries: Array<{ table: string; filters: string[] }> = [];
  constructor(private readonly tables: Record<string, Row[]>) {}
  from(table: string) {
    const query = { table, filters: [] as string[] };
    this.queries.push(query);
    return new FakeQuery(this.tables[table] ?? [], query.filters);
  }
}

class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private predicates: Array<(row: Row) => boolean> = [];
  private sortField: string | null = null;
  private ascending = true;
  private max = Number.POSITIVE_INFINITY;
  constructor(private readonly rows: Row[], private readonly filters: string[]) {}
  select() { return this; }
  eq(field: string, value: unknown) { this.filters.push(field); this.predicates.push((row) => row[field] === value); return this; }
  in(field: string, values: unknown[]) { this.filters.push(field); this.predicates.push((row) => values.includes(row[field])); return this; }
  order(field: string, options: { ascending: boolean }) { this.sortField = field; this.ascending = options.ascending; return this; }
  limit(count: number) { this.max = count; return this; }
  then<A, B>(resolve?: ((value: { data: Row[]; error: null }) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    let data = this.rows.filter((row) => this.predicates.every((predicate) => predicate(row)));
    if (this.sortField) data = [...data].sort((left, right) => String(left[this.sortField!]).localeCompare(String(right[this.sortField!])) * (this.ascending ? 1 : -1));
    return Promise.resolve({ data: data.slice(0, this.max), error: null as null }).then(resolve, reject);
  }
}

const workspaceId = "a1111111-1111-4111-8111-111111111111";
const productId = "a3333333-3333-4333-8333-333333333333";
const otherProductId = "a4444444-4444-4444-8444-444444444444";

function tables(clusterCount: number): Record<string, Row[]> {
  const result: Record<string, Row[]> = { demand_clusters: [], demand_cluster_memberships: [], demand_cluster_states: [], evidence_provenance: [], product_matches: [], signals: [], demand_observations: [] };
  const add = (product: string, index: number) => {
    const id = `${product}-c${index}`;
    result.demand_clusters.push({ id, workspace_id: workspaceId, product_id: product, evidence_node_id: `${id}-node`, clustering_version: "demand_clustering_v1", cluster_key: `concept:concept_${index}|intent:pain|target:market`, anchor_concept_key: `concept_${index}`, intent_family: "pain", target_scope: "market", label: `Concept ${index}` });
    result.demand_cluster_memberships.push({ id: `${id}-m`, workspace_id: workspaceId, product_id: product, cluster_id: id, match_evaluation_id: `${id}-e`, product_match_id: `${id}-pm`, conversation_id: `${id}-conv`, evidence_node_id: `${id}-m-node`, clustering_version: "demand_clustering_v1", source_key: "github", evidence_at: "2026-09-20T00:00:00.000Z", created_at: "2026-09-20T00:00:00.000Z" });
    for (const sequence of [1, 2]) result.demand_cluster_states.push({ id: `${id}-s${sequence}`, workspace_id: workspaceId, product_id: product, cluster_id: id, evidence_node_id: `${id}-s${sequence}-node`, strength_version: "demand_cluster_strength_v1", sequence, strength_level: "single", strength_score: 0.5, computed_at: `2026-09-2${sequence}T00:00:00.000Z`, created_at: `2026-09-2${sequence}T00:00:00.000Z` });
    result.evidence_provenance.push({ derived_evidence_node_id: `${id}-s2-node`, source_evidence_node_id: `${id}-m-node`, relation_type: "strengthened_by", measurement: { reason: null } });
    result.product_matches.push({ id: `${id}-pm`, workspace_id: workspaceId, product_id: product, current_match_evaluation_id: `${id}-e` });
    result.signals.push({ id: `${id}-sig`, workspace_id: workspaceId, product_id: product, product_match_id: `${id}-pm`, lifecycle_status: "active" });
    result.demand_observations.push({ workspace_id: workspaceId, product_id: product, match_evaluation_id: `${id}-e`, observation_type: "buyer_language", facet_value: `phrase ${index}`, normalized_value: `phrase ${index}` });
  };
  for (let index = 0; index < clusterCount; index += 1) add(productId, index);
  add(otherProductId, 99);
  return result;
}

describe("Layer 9A Supabase read path", () => {
  it("issues the same fixed number of queries per table regardless of cluster count (no N+1)", async () => {
    const perTable: Array<Record<string, number>> = [];
    for (const clusterCount of [1, 8]) {
      const client = new FakeClient(tables(clusterCount));
      const map = await new DemandMapService(new SupabaseDemandClusteringRepository(client)).getDemandMap({ workspaceId, productId, legacy: null, now: new Date("2026-09-25T12:00:00.000Z") });
      expect(map.current).toHaveLength(clusterCount);
      expect(map.current.every((concept) => concept.clusters[0].persistedState?.sequence === 2 && concept.clusters[0].persistedState.historyLength === 2)).toBe(true);
      const counts: Record<string, number> = {};
      for (const query of client.queries) counts[query.table] = (counts[query.table] ?? 0) + 1;
      perTable.push(counts);
    }
    expect(perTable[0]).toEqual({ demand_clusters: 1, demand_cluster_memberships: 1, demand_cluster_states: 1, evidence_provenance: 1, product_matches: 1, signals: 1, demand_observations: 1 });
    expect(perTable[1]).toEqual(perTable[0]);
  });

  it("scopes every product-owned read by workspace and product, and never returns another product's concept", async () => {
    const client = new FakeClient(tables(2));
    const map = await new DemandMapService(new SupabaseDemandClusteringRepository(client)).getDemandMap({ workspaceId, productId, legacy: null, now: new Date("2026-09-25T12:00:00.000Z") });
    expect(map.current.map((concept) => concept.conceptKey)).toEqual(["concept_0", "concept_1"]);
    for (const query of client.queries.filter((item) => item.table !== "evidence_provenance")) {
      expect(query.filters).toEqual(expect.arrayContaining(["workspace_id", "product_id"]));
    }
  });
});
