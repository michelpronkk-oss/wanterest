import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/providers/supabase/service", () => ({ createSupabaseServiceClient: () => { throw new Error("no client in unit tests"); } }));

const { buildQueryPlan, buildQueryPlanSeedCandidates } = await import("../../src/server/modules/operations");
const policy = await import("../../src/server/modules/operations/supply-partition-seeding.policy");
const { seedSupplyPartitionsForScan, retireExhaustedSeedPartitions } = await import("../../src/server/modules/operations/supply-partition-seeding.service");
const { interestAsArtifact } = await import("../../src/server/modules/operations/supply-partition-interest.repository");
const { selectInterestedProducts, parseDiscoveryProvenanceTemplate } = await import("../../src/server/modules/operations/incremental-product-matching.policy");
const { deriveMarketPartitionIdentity } = await import("../../src/server/modules/ingestion/market-partition-identity");
const { buildMarketPartitionRefreshRequest } = await import("../../src/server/modules/ingestion/market-partition-refresh.policy");
const { toSourceDiscoveryRequest } = await import("../../src/server/modules/operations/query-planning.execution");
const { prepareStackExchangeFeatureRequest } = await import("../../src/server/providers/source/stack-exchange");
const { plannerGoldenInputs, digest } = await import("./planner-golden.helpers");
import type { InterestUpsertInput, InterestUpsertStatus } from "../../src/server/modules/operations/supply-partition-interest.repository";

const golden = JSON.parse(readFileSync("tests/fixtures/query-planning-v7-golden.json", "utf8")) as { count: number; all: string; plans: Record<string, string> };
const NOW = new Date("2026-09-26T02:00:00.000Z");
const REFRESHABLE = ["github", "stack-exchange"] as const;

async function inputsWithSeeds() {
  const inputs = await plannerGoldenInputs();
  return inputs.map((entry) => ({ ...entry, candidates: buildQueryPlanSeedCandidates(entry.input, REFRESHABLE) })).filter((entry) => entry.candidates.length > 0);
}

function recordingRepository(statusFor: (input: InterestUpsertInput) => InterestUpsertStatus = () => "created") {
  const calls: InterestUpsertInput[] = [];
  return { calls, repository: { upsertInterest: vi.fn(async (input: InterestUpsertInput) => { calls.push(input); return statusFor(input); }) } };
}

afterEach(() => { vi.restoreAllMocks(); delete process.env.SUPPLY_PARTITION_SEEDING_ENABLED; });

describe("Layer 12A.2 planner output is frozen (query_planning_v7)", () => {
  it("buildQueryPlan output is byte-identical to the pre-12A.2 golden digests for 120 planner inputs", async () => {
    const inputs = await plannerGoldenInputs();
    expect(inputs).toHaveLength(golden.count);
    const plans = Object.fromEntries(inputs.map(({ name, input }) => [name, digest(buildQueryPlan(input))]));
    expect(plans).toEqual(golden.plans);
    expect(digest(plans)).toBe(golden.all);
  });

  it("flag on/off and seed-candidate generation never change or mutate the plan", async () => {
    const inputs = await plannerGoldenInputs();
    for (const { name, input } of inputs.slice(0, 40)) {
      const before = JSON.stringify(input);
      process.env.SUPPLY_PARTITION_SEEDING_ENABLED = "true";
      const on = digest(buildQueryPlan(input));
      buildQueryPlanSeedCandidates(input, REFRESHABLE);
      delete process.env.SUPPLY_PARTITION_SEEDING_ENABLED;
      const off = digest(buildQueryPlan(input));
      expect(on).toBe(golden.plans[name]);
      expect(off).toBe(golden.plans[name]);
      expect(JSON.stringify(input)).toBe(before);
    }
  });

  it("seed candidates are exactly the planner's own candidates: every executed plan query for a refreshable source is among them", async () => {
    const entries = await inputsWithSeeds();
    expect(entries.length).toBeGreaterThan(10);
    for (const { input, candidates } of entries) {
      const plan = buildQueryPlan(input);
      const byId = new Map(candidates.map((candidate) => [candidate.query_id, candidate]));
      for (const query of plan.source_plans.filter((source) => REFRESHABLE.includes(source.source_key as never)).flatMap((source) => source.queries)) {
        const candidate = byId.get(query.query_id);
        expect(candidate).toBeDefined();
        // Same mapping as the plan (budget aside): identical text, family, surface and provider context.
        expect({ ...candidate, candidate_budget: 0 }).toEqual({ ...query, candidate_budget: 0 });
      }
      expect(candidates.every((candidate) => REFRESHABLE.includes(candidate.source_key as never))).toBe(true);
    }
  });
});

describe("Layer 12A.2 seed selection", () => {
  it("only background-refreshable sources are seeded; everything else is skipped with a reason", async () => {
    const inputs = await plannerGoldenInputs();
    const all = inputs.flatMap(({ input }) => buildQueryPlanSeedCandidates(input, ["github", "stack-exchange", "x", "youtube", "hacker-news", "reddit", "bluesky", "product-hunt"]));
    const selection = policy.selectPartitionSeeds({ candidates: all, executedQueryPlanIds: new Set(), executedPartitionKeys: new Set(), now: NOW, maxPerSource: 1000 });
    expect(new Set(selection.seeds.map((seed) => seed.sourceKey))).toEqual(new Set(["github", "stack-exchange"]));
    const nonRefreshable = all.filter((candidate) => !REFRESHABLE.includes(candidate.source_key as never));
    expect(nonRefreshable.length).toBeGreaterThan(0);
    expect(selection.skipped.filter((skip) => skip.reason === "source_not_refreshable")).toHaveLength(nonRefreshable.length);
  });

  it("max seeds per product per source is enforced (default 6) and selection is deterministic", async () => {
    const candidates = (await inputsWithSeeds()).flatMap((entry) => entry.candidates);
    const selection = policy.selectPartitionSeeds({ candidates, executedQueryPlanIds: new Set(), executedPartitionKeys: new Set(), now: NOW });
    for (const source of REFRESHABLE) expect(selection.seeds.filter((seed) => seed.sourceKey === source).length).toBeLessThanOrEqual(policy.SEED_MAX_PER_PRODUCT_PER_SOURCE);
    expect(policy.SEED_MAX_PER_PRODUCT_PER_SOURCE).toBe(6);
    expect(selection.skipped.some((skip) => skip.reason === "per_source_cap")).toBe(true);
    expect(policy.selectPartitionSeeds({ candidates, executedQueryPlanIds: new Set(), executedPartitionKeys: new Set(), now: NOW })).toEqual(selection);
  });

  it("duplicate planner candidates collapse onto one partition; executed queries and executed partitions are never seeded", async () => {
    const [{ candidates }] = await inputsWithSeeds();
    const duplicated = [...candidates, ...candidates.map((candidate) => ({ ...candidate, query_id: `${candidate.query_id}-dup`, candidate_budget: 3 }))];
    const selection = policy.selectPartitionSeeds({ candidates: duplicated, executedQueryPlanIds: new Set(), executedPartitionKeys: new Set(), now: NOW, maxPerSource: 1000 });
    expect(new Set(selection.seeds.map((seed) => seed.partitionKey)).size).toBe(selection.seeds.length);
    expect(selection.skipped.filter((skip) => skip.reason === "duplicate_partition").length).toBeGreaterThanOrEqual(candidates.length);

    const first = selection.seeds[0];
    const excluded = policy.selectPartitionSeeds({ candidates, executedQueryPlanIds: new Set([first.queryPlanId]), executedPartitionKeys: new Set(), now: NOW, maxPerSource: 1000 });
    expect(excluded.seeds.map((seed) => seed.queryPlanId)).not.toContain(first.queryPlanId);
    expect(excluded.skipped).toContainEqual({ queryPlanId: first.queryPlanId, sourceKey: first.sourceKey, reason: "executed_by_scan" });
    const byPartition = policy.selectPartitionSeeds({ candidates, executedQueryPlanIds: new Set(), executedPartitionKeys: new Set([first.partitionKey]), now: NOW, maxPerSource: 1000 });
    expect(byPartition.seeds.map((seed) => seed.partitionKey)).not.toContain(first.partitionKey);
  });

  it("identity is market_partition_identity_v1 of the exact request execution would send, refresh round-trips, metadata never enters identity", async () => {
    const candidates = (await inputsWithSeeds()).flatMap((entry) => entry.candidates);
    const selection = policy.selectPartitionSeeds({ candidates, executedQueryPlanIds: new Set(), executedPartitionKeys: new Set(), now: NOW, maxPerSource: 1000 });
    expect(selection.seeds.some((seed) => seed.sourceKey === "stack-exchange")).toBe(true);
    for (const seed of selection.seeds) {
      const query = candidates.find((candidate) => candidate.query_id === seed.queryPlanId)!;
      const planned = toSourceDiscoveryRequest({ sourcePlan: { source_key: query.source_key } as never, query, maxPages: 3 });
      // Ingestion derives identity after Stack Exchange preparation; a scan executing this query would get this key.
      const executed = deriveMarketPartitionIdentity({ sourceKey: seed.sourceKey, request: seed.sourceKey === "stack-exchange" ? prepareStackExchangeFeatureRequest(planned, new Date("2027-01-01T00:00:00Z")) : planned });
      expect(executed.eligible && executed.partitionKey).toBe(seed.partitionKey);
      const rebuilt = buildMarketPartitionRefreshRequest({ sourceKey: seed.sourceKey, retrievalSpec: seed.retrievalSpec });
      expect(rebuilt.ok && deriveMarketPartitionIdentity({ sourceKey: seed.sourceKey, request: rebuilt.request })).toMatchObject({ eligible: true, partitionKey: seed.partitionKey });
      expect(JSON.stringify(seed.retrievalSpec)).not.toMatch(/queryFamily|demandSurface|concept|seed|workspace|product_id/);
      expect(seed.metadata).toMatchObject({ seedOrigin: "query_planning_v7", queryFamily: query.query_family, demandSurface: query.demand_surface });
    }
  });

  it("the same retrieval spec from different products resolves to the same global partition", async () => {
    const inputs = await plannerGoldenInputs();
    const [a] = inputs.filter((entry) => buildQueryPlanSeedCandidates(entry.input, REFRESHABLE).length);
    const other = { ...a.input, sourceRoutingPlan: { ...a.input.sourceRoutingPlan, product_id: "another-product" } };
    const seedsA = policy.selectPartitionSeeds({ candidates: buildQueryPlanSeedCandidates(a.input, REFRESHABLE), executedQueryPlanIds: new Set(), executedPartitionKeys: new Set(), now: NOW }).seeds;
    const seedsB = policy.selectPartitionSeeds({ candidates: buildQueryPlanSeedCandidates(other, REFRESHABLE), executedQueryPlanIds: new Set(), executedPartitionKeys: new Set(), now: NOW }).seeds;
    expect(seedsA.length).toBeGreaterThan(0);
    expect(seedsB.map((seed) => [seed.partitionId, seed.partitionKey])).toEqual(seedsA.map((seed) => [seed.partitionId, seed.partitionKey]));
  });
});

describe("Layer 12A.2 provenance", () => {
  it("every seed carries canonical provenance for its own query/source, so incremental matching can never report provenance_missing for it", async () => {
    const candidates = (await inputsWithSeeds()).flatMap((entry) => entry.candidates);
    const { seeds } = policy.selectPartitionSeeds({ candidates, executedQueryPlanIds: new Set(), executedPartitionKeys: new Set(), now: NOW, maxPerSource: 1000 });
    expect(seeds.length).toBeGreaterThan(5);
    const artifacts = seeds.map((seed, index) => interestAsArtifact({
      id: `i-${index}`, workspaceId: "w", productId: `p-${index}`, partitionKey: seed.partitionKey, sourceKey: seed.sourceKey, origin: "planner_seed",
      originJobRunId: "scan-job", queryPlanId: seed.queryPlanId, provenance: JSON.parse(JSON.stringify(seed.provenance)), renewedAt: NOW.toISOString(), expiresAt: NOW.toISOString(),
    }));
    for (const artifact of artifacts) expect(parseDiscoveryProvenanceTemplate(artifact)).toEqual(JSON.parse(JSON.stringify(artifact.discoveryProvenance)));
    const selected = selectInterestedProducts(artifacts, 10_000);
    expect(selected.skipped.filter((skip) => skip.reason === "provenance_missing")).toEqual([]);
    expect(selected.selected.every((product) => product.interestOrigin === "planner_seed")).toBe(true);
  });

  it("provenance validation is not weakened: a seed whose provenance names another query or source is rejected", () => {
    const base = { discoveryProvenance: { queryPlanId: "qp-a", source: "github", queryFamily: "pain", demandSurface: "pain_first", concepts: [], competitorSpecific: false }, queryPlanId: "qp-a", sourceKey: "github" };
    expect(parseDiscoveryProvenanceTemplate(base)).not.toBeNull();
    expect(parseDiscoveryProvenanceTemplate({ ...base, queryPlanId: "qp-b" })).toBeNull();
    expect(parseDiscoveryProvenanceTemplate({ ...base, sourceKey: "stack-exchange" })).toBeNull();
    expect(parseDiscoveryProvenanceTemplate({ ...base, discoveryProvenance: null })).toBeNull();
  });

  it("scan interests keep only executed refreshable queries whose recorded provenance parses (never repaired)", () => {
    const provenance = { queryPlanId: "qp-gh", source: "github", queryFamily: "pain", demandSurface: "pain_first", concepts: [], competitorSpecific: false };
    const rows = [
      { source: "github", queryPlanId: "qp-gh", executionStatus: "completed_with_results", marketPartitionKey: "k1", discoveryProvenance: provenance },
      { source: "github", queryPlanId: "qp-missing", executionStatus: "completed_with_results", marketPartitionKey: "k2", discoveryProvenance: null },
      { source: "github", queryPlanId: "qp-gh", executionStatus: "provider_error", marketPartitionKey: "k3", discoveryProvenance: provenance },
      { source: "x", queryPlanId: "qp-x", executionStatus: "completed_with_results", marketPartitionKey: "k4", discoveryProvenance: { ...provenance, queryPlanId: "qp-x", source: "x" } },
    ];
    expect(policy.selectExecutedQueryInterests(rows).map((row) => row.partitionKey)).toEqual(["k1"]);
  });
});

describe("Layer 12A.2 seeding service (persistence only)", () => {
  it("makes no provider (fetch) or model call; scan interests are written before seeds; outcomes are counted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const [{ input, candidates }] = await inputsWithSeeds();
    const plan = buildQueryPlan(input);
    const executedQuery = plan.source_plans.flatMap((source) => source.queries).find((query) => REFRESHABLE.includes(query.source_key as never));
    const provenance = executedQuery ? { queryPlanId: executedQuery.query_id, source: executedQuery.source_key, queryFamily: executedQuery.query_family, demandSurface: executedQuery.demand_surface, concepts: [], competitorSpecific: false } : null;
    const executed = executedQuery ? [{ source: executedQuery.source_key, queryPlanId: executedQuery.query_id, executionStatus: "completed_with_results", marketPartitionKey: "market_partition_identity_v1:executed", discoveryProvenance: provenance }] : [];
    const { calls, repository } = recordingRepository((call) => (call.origin === "planner_seed" && call.queryPlanId === candidates.at(-1)?.query_id ? "source_cap_reached" : "created"));
    const outcome = await seedSupplyPartitionsForScan({ client: null, workspaceId: "w", productId: "p", scanJobRunId: "job", planningInput: input, executed, now: NOW, repository });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outcome.plannerCandidates).toBe(candidates.length);
    expect(calls.filter((call) => call.origin === "planner_seed")).toHaveLength(outcome.seedsSelected);
    if (executedQuery) {
      expect(calls[0]).toMatchObject({ origin: "scan", queryPlanId: executedQuery.query_id, retrievalSpec: null, seedVersion: null });
      expect(calls.filter((call) => call.origin === "planner_seed").map((call) => call.queryPlanId)).not.toContain(executedQuery.query_id);
    }
    for (const call of calls.filter((entry) => entry.origin === "planner_seed")) {
      expect(call).toMatchObject({ seedVersion: "supply_partition_seeding_v1", identityVersion: "market_partition_identity_v1", ttlSeconds: 14 * 86400, maxSeedsPerProductSource: 6, maxSeededPartitionsPerSource: 60, now: NOW.toISOString() });
      expect(call.provenance).toMatchObject({ queryPlanId: call.queryPlanId, source: call.sourceKey });
    }
  });

  it("a failing interest write is contained and counted; it never throws into the scan", async () => {
    const [{ input }] = await inputsWithSeeds();
    const repository = { upsertInterest: vi.fn(async () => { throw new Error("db down"); }) };
    const outcome = await seedSupplyPartitionsForScan({ client: null, workspaceId: "w", productId: "p", scanJobRunId: "job", planningInput: input, executed: [], now: NOW, repository });
    expect(outcome.seeds.error).toBe(outcome.seedsSelected);
  });

  it("retirement delegates to the fail-closed database pass with the documented bounds", async () => {
    const repository = { retireExhaustedSeedPartitions: vi.fn(async () => 2) };
    await expect(retireExhaustedSeedPartitions({ client: null, now: NOW, repository })).resolves.toEqual({ retired: 2 });
    expect(repository.retireExhaustedSeedPartitions).toHaveBeenCalledWith({ now: NOW.toISOString(), minRefreshes: 6, windowDays: 30, limit: 20 });
  });

  it("the seeding modules import no provider adapter network code, LLM or retrieval module", () => {
    for (const file of ["supply-partition-seeding.policy.ts", "supply-partition-seeding.service.ts", "supply-partition-interest.repository.ts"]) {
      const source = readFileSync(`src/server/modules/operations/${file}`, "utf8");
      const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
      expect(imports.filter((path) => /providers\/(llm|embedding)|openai|anthropic|semantic-reasoning|signal-qualification|candidate-selection/.test(path))).toEqual([]);
      expect(source).not.toMatch(/ingestPublicPartition|discoverSource|\bfetch\(/);
    }
  });
});

describe("Layer 12A.2 feature flag", () => {
  it("is off unless exactly \"true\"", () => {
    expect(policy.supplyPartitionSeedingEnabled({})).toBe(false);
    expect(policy.supplyPartitionSeedingEnabled({ SUPPLY_PARTITION_SEEDING_ENABLED: "false" })).toBe(false);
    expect(policy.supplyPartitionSeedingEnabled({ SUPPLY_PARTITION_SEEDING_ENABLED: "TRUE" })).toBe(false);
    expect(policy.supplyPartitionSeedingEnabled({ SUPPLY_PARTITION_SEEDING_ENABLED: "true" })).toBe(true);
  });

  it("every production call site is gated by the flag", () => {
    const scan = readFileSync("src/server/modules/onboarding/initial-scan.service.ts", "utf8");
    expect(scan).toMatch(/if \(queryPlan && queryPlanningInput && supplyPartitionSeedingEnabled\(\)\) \{\s+try \{\s+const seeding = await seedSupplyPartitionsForScan/);
    // Seeding runs after the scan's own query yield rows are persisted, and is wrapped so it can never fail the scan.
    expect(scan.indexOf("seedSupplyPartitionsForScan({")).toBeGreaterThan(scan.indexOf("await queryYieldRepository.insertImmutable("));
    expect(scan).toContain("queryPlan = buildQueryPlan(queryPlanningInput);");
    const incremental = readFileSync("src/server/modules/operations/incremental-product-matching.service.ts", "utf8");
    expect(incremental).toContain("partitionInterests: supplyPartitionSeedingEnabled() ? new SupplyPartitionInterestRepository(client) : null,");
    const refresh = readFileSync("src/server/modules/ingestion/market-partition-refresh.service.ts", "utf8");
    expect(refresh).toContain("const explicitInterests = supplyPartitionSeedingEnabled() ? new SupplyPartitionInterestRepository(client) : null;");
    const scheduler = readFileSync("src/trigger/market-partition-refresh.ts", "utf8");
    expect(scheduler).toMatch(/if \(supplyPartitionSeedingEnabled\(\)\) \{\s+try \{ seedRetirement = await retireExhaustedSeedPartitions/);
  });
});

describe("Layer 12A.3A: Hacker News seeding is flag-gated end to end", () => {
  afterEach(() => { delete process.env.HN_ALGOLIA_SEARCH_ENABLED; });

  async function hackerNewsCandidate() {
    const [{ candidates }] = await inputsWithSeeds();
    const template = candidates.find((candidate) => candidate.source_key === "github") ?? candidates[0]!;
    return { ...template, source_key: "hacker-news", query_id: `${template.query_id}-hn` };
  }

  it("is never seeded while the flag is off, even when the planner produced a candidate for it", async () => {
    delete process.env.HN_ALGOLIA_SEARCH_ENABLED;
    const candidate = await hackerNewsCandidate();
    const selection = policy.selectPartitionSeeds({ candidates: [candidate], executedQueryPlanIds: new Set(), executedPartitionKeys: new Set(), now: NOW });
    expect(selection.seeds).toHaveLength(0);
    expect(selection.skipped).toEqual([{ queryPlanId: candidate.query_id, sourceKey: "hacker-news", reason: "source_not_refreshable" }]);
  });

  it("is seeded with a round-tripped identity and valid provenance once the flag is on", async () => {
    process.env.HN_ALGOLIA_SEARCH_ENABLED = "true";
    const candidate = await hackerNewsCandidate();
    const selection = policy.selectPartitionSeeds({ candidates: [candidate], executedQueryPlanIds: new Set(), executedPartitionKeys: new Set(), now: NOW });
    expect(selection.seeds).toHaveLength(1);
    const [seed] = selection.seeds;
    expect(seed!.sourceKey).toBe("hacker-news");
    expect(seed!.identityVersion).toBe("market_partition_identity_v1");
    expect(seed!.retrievalSpec.expression.length).toBeGreaterThan(0);
    // Round-trips: rebuilding the refresh request from the stored spec derives the exact same key.
    const rebuilt = buildMarketPartitionRefreshRequest({ sourceKey: "hacker-news", retrievalSpec: seed!.retrievalSpec });
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok) {
      const rebuiltIdentity = deriveMarketPartitionIdentity({ sourceKey: "hacker-news", request: rebuilt.request });
      expect(rebuiltIdentity.eligible && rebuiltIdentity.partitionKey).toBe(seed!.partitionKey);
    }
    // Provenance is valid and cannot be provenance_missing.
    expect(parseDiscoveryProvenanceTemplate({ discoveryProvenance: seed!.provenance, queryPlanId: seed!.queryPlanId, sourceKey: "hacker-news" })).not.toBeNull();
    expect(seed!.provenance.source).toBe("hacker-news");
  });
});

describe("Layer 12A.2 frozen systems", () => {
  it("qualification, reasoning, selection caps and refresh allowlist are unchanged", async () => {
    const { SIGNAL_QUALIFICATION_VERSION } = await import("../../src/server/modules/intelligence/signal-qualification.config");
    const { SEMANTIC_REASONING_ROUTER_VERSION } = await import("../../src/server/modules/intelligence/semantic-reasoning-router");
    const { INCREMENTAL_MATCH_MAX_EVALUATIONS_PER_PRODUCT, INCREMENTAL_MATCH_INTEREST_WINDOW_MS, INCREMENTAL_MATCH_MAX_PRODUCTS_PER_REFRESH } = await import("../../src/server/modules/operations/incremental-product-matching.policy");
    const { MARKET_PARTITION_REFRESH_SOURCE_KEYS, MARKET_PARTITION_REFRESH_DAILY_CAP, MARKET_PARTITION_REFRESH_LIMIT } = await import("../../src/server/modules/ingestion/market-partition-refresh.policy");
    const { MARKET_PARTITION_IDENTITY_VERSION } = await import("../../src/server/modules/ingestion/market-partition-identity");
    const { queryPlanningVersion } = await import("../../src/server/modules/operations/query-planning.schemas");
    expect(SIGNAL_QUALIFICATION_VERSION).toBe("signal_qualification_v1_7");
    expect(SEMANTIC_REASONING_ROUTER_VERSION).toBe("semantic_reasoning_router_v2");
    expect(INCREMENTAL_MATCH_MAX_EVALUATIONS_PER_PRODUCT).toBe(15);
    expect(INCREMENTAL_MATCH_MAX_PRODUCTS_PER_REFRESH).toBe(20);
    expect(INCREMENTAL_MATCH_INTEREST_WINDOW_MS).toBe(policy.MARKET_PARTITION_INTEREST_TTL_MS);
    // Layer 12A.3A adds hacker-news to the type-level allowlist (flag-gated separately - see
    // market-partition-refresh-policy.test.ts); every other frozen value here is unchanged.
    expect([...MARKET_PARTITION_REFRESH_SOURCE_KEYS]).toEqual(["github", "stack-exchange", "hacker-news"]);
    expect(MARKET_PARTITION_REFRESH_DAILY_CAP).toEqual({ github: 120, "stack-exchange": 60, "hacker-news": 60 });
    expect(MARKET_PARTITION_REFRESH_LIMIT).toBe(10);
    expect(MARKET_PARTITION_IDENTITY_VERSION).toBe("market_partition_identity_v1");
    expect(queryPlanningVersion).toBe("query_planning_v7");
    const selectionSource = readFileSync("src/server/modules/intelligence/signal-qualification.config.ts", "utf8");
    expect(selectionSource).toBe(execGit("src/server/modules/intelligence/signal-qualification.config.ts"));
  });
});

function execGit(path: string): string {
  // The frozen config must be byte-identical to the 12A.1 production base.
  return execFileSync("git", ["show", `241ae569775bd52fefcaa83d5289d30dd1c5d657:${path}`], { encoding: "utf8" });
}

