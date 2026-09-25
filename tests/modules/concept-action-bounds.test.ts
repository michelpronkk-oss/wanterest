import { describe, expect, it } from "vitest";

import { CONCEPT_EPISODE_HISTORY_LIMIT, CONCEPT_LATEST_STATE_LIMIT, InMemoryConceptMarketStateRepository, SupabaseConceptMarketStateRepository } from "../../src/server/modules/demand-intelligence/concept-market-state.repository";
import { DEMAND_CLUSTERING_MAX_EVALUATIONS } from "../../src/server/modules/demand-intelligence/demand-clustering.policy";
import { OPEN_CONCEPT_ACTION_LIMIT, SupabaseActionRepository } from "../../src/server/modules/actions/action.repository";
import { Harness } from "./concept-action.harness";

type Call = { kind: "rpc" | "from"; name: string; args?: Record<string, unknown>; chain: Array<[string, unknown[]]> };

/** Records every query the repositories issue so the DB-side bounds are asserted, not assumed. */
function recordingClient(calls: Call[]) {
  const builder = (call: Call): unknown => new Proxy({}, {
    get(_target, prop: string) {
      if (prop === "then") return (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
      return (...args: unknown[]) => { call.chain.push([prop, args]); return prop === "maybeSingle" || prop === "single" ? Promise.resolve({ data: null, error: null }) : builder(call); };
    },
  });
  return {
    rpc(name: string, args: Record<string, unknown>) { const call: Call = { kind: "rpc", name, args, chain: [] }; calls.push(call); return Promise.resolve({ data: [], error: null }); },
    from(name: string) { const call: Call = { kind: "from", name, chain: [] }; calls.push(call); return builder(call); },
  };
}

describe("Layer 10 DB-side bounds", () => {
  it("latest-state batch reads go through the bounded SQL functions (no fetch-all-and-trim) with the concept cap", async () => {
    expect(CONCEPT_LATEST_STATE_LIMIT).toBe(500);
    expect(CONCEPT_LATEST_STATE_LIMIT).toBe(DEMAND_CLUSTERING_MAX_EVALUATIONS);
    const calls: Call[] = [];
    const repository = new SupabaseConceptMarketStateRepository(recordingClient(calls));
    await repository.listLatestMarketStates("w", "p", "v", "m");
    await repository.listLatestGapStates("w", "p", "v", "g");
    await repository.listLatestDriftStates("w", "p", "v", "d", "30d");
    expect(calls.map((call) => [call.kind, call.name, call.args?.p_limit])).toEqual([
      ["rpc", "concept_latest_market_states", 500],
      ["rpc", "concept_latest_gap_states", 500],
      ["rpc", "concept_latest_drift_states", 500],
    ]);
    expect(calls.some((call) => call.kind === "from")).toBe(false);
  });

  it("episode history and id lookups carry a database limit", async () => {
    const calls: Call[] = [];
    const repository = new SupabaseConceptMarketStateRepository(recordingClient(calls));
    await repository.listGapStatesAfter("w", "p", "v", "k", "g", 3, 1_000);
    await repository.listDriftStatesAfter("w", "p", "v", "k", "d", "7d", 3, 1_000);
    await repository.getMarketStatesByIds("w", "p", Array.from({ length: 150 }, (_, index) => `id-${index}`));
    for (const call of calls) expect(call.chain.find(([method]) => method === "limit")?.[1][0]).toBe(CONCEPT_EPISODE_HISTORY_LIMIT);
    expect(calls[0].chain).toContainEqual(["gt", ["sequence", 3]]);
    expect((calls[2].chain.find(([method]) => method === "in")?.[1][1] as string[]).length).toBe(CONCEPT_EPISODE_HISTORY_LIMIT);
  });

  it("open concept Actions are read with a database limit", async () => {
    const calls: Call[] = [];
    await new SupabaseActionRepository(recordingClient(calls) as never).listOpenConceptActions("w", "p");
    expect(calls[0].chain.find(([method]) => method === "limit")?.[1][0]).toBe(OPEN_CONCEPT_ACTION_LIMIT);
    expect(calls[0].chain).toContainEqual(["in", ["status", ["proposed", "approved", "in_progress"]]]);
  });

  it("the in-memory mirror enforces the same cap (501 concepts → 500 latest rows, ordered by key)", async () => {
    const h = new Harness();
    const repository = h.states as InMemoryConceptMarketStateRepository;
    for (let index = 0; index < 501; index += 1) await h.market(`concept_${String(index).padStart(3, "0")}`, { evidence: 5 });
    const rows = await repository.listLatestMarketStates(h.product.workspace_id, h.product.id, "demand_clustering_v1", "concept_market_state_v1");
    expect(rows).toHaveLength(500);
    expect(rows[0].anchor_concept_key).toBe("concept_000");
  });
});
