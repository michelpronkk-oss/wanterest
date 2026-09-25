import { describe, expect, it } from "vitest";

import type { DemandSnapshotRow } from "../../src/server/db/database.helpers";
import type { SignalReadModel } from "../../src/server/modules/intelligence";
import { PRODUCT_DEMAND_SCAN_JOB_TYPE } from "../../src/server/modules/operations/product-demand-scan.identity";
import { DEFAULT_READ_FIRST_FRESHNESS_CONFIG, getReadFirstFreshnessConfig } from "../../src/server/modules/operations/read-first-intelligence.config";
import { ReadFirstIntelligenceService, type ReadFirstDependencies, type ReadFirstIntelligenceRepository, type ReadFirstPersistedState, type ReadFirstProductKey } from "../../src/server/modules/operations/read-first-intelligence.service";

const workspaceA = "11111111-1111-4111-8111-111111111111";
const workspaceB = "22222222-2222-4222-8222-222222222222";
const productA = "33333333-3333-4333-8333-333333333333";
const productB = "44444444-4444-4444-8444-444444444444";
const jobRunId = "55555555-5555-4555-8555-555555555555";
const now = new Date("2026-09-25T12:00:00.000Z");

function signal(id: string, createdAt: string, productId = productA): SignalReadModel {
  return {
    signalId: id,
    workspaceId: workspaceA,
    productId,
    productMatchId: `${id}-match`,
    conversationId: `${id}-conversation`,
    source: "github",
    canonicalUrl: "https://example.com/thread",
    publishedAt: createdAt,
    createdAt,
    intentType: "switching_intent",
    opportunityScore: 0.8,
    matchPercent: 80,
    excerpt: "I need a better workflow.",
    whyItMatters: "The buyer describes a product need.",
    tags: [],
    buyerLanguage: [],
    painThemes: [],
    lifecycleStatus: "active",
    feedbackState: { saved: false, dismissed: false, relevant: null, opened: false, contacted: false, converted: false },
    evidence: { signalEvidenceNodeId: `${id}-signal-evidence`, evaluationId: `${id}-evaluation`, rankingId: `${id}-ranking`, conversationEvidenceNodeId: `${id}-conversation-evidence`, sourceItemId: `${id}-source`, demandProfileEvidenceNodeId: `${id}-profile` },
    qualification: null,
  };
}

function snapshot(periodEnd: string): DemandSnapshotRow {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    workspace_id: workspaceA,
    product_id: productA,
    demand_profile_id: "77777777-7777-4777-8777-777777777777",
    evidence_node_id: "88888888-8888-4888-8888-888888888888",
    alternatives: [],
    buyer_language: [],
    conversation_count: 12,
    desired_outcomes: [],
    intent_mix: [],
    pain_distribution: [],
    qualified_signal_count: 12,
    source_mix: [],
    theme_distribution: [],
    warnings: [],
    window_type: "30d",
    period_start: "2026-08-26T12:00:00.000Z",
    period_end: periodEnd,
    sample_size: 12,
    confidence: 0.82,
    measurement_quality: "good",
    created_at: periodEnd,
    input_fingerprint: "snapshot-fingerprint",
    map_engine_version_id: "99999999-9999-4999-8999-999999999999",
  };
}

function emptyState(overrides: Partial<ReadFirstPersistedState> = {}): ReadFirstPersistedState {
  return { signals: [], snapshot: null, gaps: [], drifts: [], activeRefresh: null, lastSuccessfulRefreshAt: null, ...overrides };
}

class FakeRepository implements ReadFirstIntelligenceRepository {
  readonly keys: ReadFirstProductKey[] = [];
  readonly providerCalls = 0;
  constructor(private readonly states: Map<string, ReadFirstPersistedState>) {}
  async loadPersistedState(key: ReadFirstProductKey): Promise<ReadFirstPersistedState> {
    this.keys.push(key);
    return this.states.get(`${key.workspaceId}:${key.productId}`) ?? emptyState();
  }
}

function service(repository: ReadFirstIntelligenceRepository, options: Omit<ReadFirstDependencies, "repository"> = {}) {
  return new ReadFirstIntelligenceService({ repository, now: () => now, ...options });
}

function handle() {
  return { jobRunId, idempotencyKey: "manual-scan:test", status: "started" as const, scanMode: "manual" as const, triggerRunId: null };
}

describe("read-first product intelligence", () => {
  it("returns existing product intelligence without provider calls", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ signals: [signal("s1", "2026-09-25T10:00:00.000Z")], lastSuccessfulRefreshAt: "2026-09-25T10:30:00.000Z" })]]));
    const result = await service(repository).read({ workspaceId: workspaceA, productId: productA });
    expect(result.intelligence.signals).toHaveLength(1);
    expect(repository.providerCalls).toBe(0);
    expect(result.refresh.status).toBe("complete");
  });

  it("does not wait for Trigger completion", async () => {
    let providerCompleted = false;
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState()]]));
    const result = await service(repository, { enqueueRefresh: async () => { providerCompleted = false; return handle(); } }).read({ workspaceId: workspaceA, productId: productA });
    expect(providerCompleted).toBe(false);
    expect(result.refresh).toEqual({ status: "queued", jobRunId });
  });

  it("enqueues a due refresh asynchronously", async () => {
    let calls = 0;
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ signals: [signal("s1", "2026-09-20T10:00:00.000Z")] })]]));
    const result = await service(repository, { enqueueRefresh: async () => { calls += 1; return handle(); } }).read({ workspaceId: workspaceA, productId: productA });
    expect(calls).toBe(1);
    expect(result.freshness.refreshDue).toBe(true);
    expect(result.refresh.jobRunId).toBe(jobRunId);
  });

  it("reuses an active refresh and prevents a duplicate", async () => {
    let calls = 0;
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ activeRefresh: { jobRunId, status: "running" } })]]));
    const result = await service(repository, { enqueueRefresh: async () => { calls += 1; return handle(); } }).read({ workspaceId: workspaceA, productId: productA });
    expect(calls).toBe(0);
    expect(result.refresh).toEqual({ status: "running", jobRunId });
  });

  it("classifies current evidence as fresh", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ signals: [signal("s1", "2026-09-25T10:00:00.000Z")] })]]));
    const result = await service(repository).read({ workspaceId: workspaceA, productId: productA });
    expect(result.freshness.state).toBe("fresh");
    expect(result.freshness.refreshDue).toBe(false);
  });

  it("classifies usable but aging evidence as recent", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ signals: [signal("s1", "2026-09-24T00:00:00.000Z")] })]]));
    const result = await service(repository).read({ workspaceId: workspaceA, productId: productA });
    expect(result.freshness.state).toBe("recent");
    expect(result.freshness.refreshDue).toBe(true);
  });

  it("classifies old evidence as stale", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ signals: [signal("s1", "2026-09-20T00:00:00.000Z")] })]]));
    const result = await service(repository).read({ workspaceId: workspaceA, productId: productA });
    expect(result.freshness.state).toBe("stale");
    expect(result.freshness.refreshDue).toBe(true);
  });

  it("returns an empty product immediately and does not fabricate signals", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState()]]));
    const result = await service(repository, { enqueueRefresh: async () => handle() }).read({ workspaceId: workspaceA, productId: productA });
    expect(result.intelligence.signals).toEqual([]);
    expect(result.freshness.state).toBe("empty");
    expect(result.refresh.status).toBe("queued");
  });

  it("never invokes a provider adapter from the read-first service", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ signals: [signal("s1", "2026-09-25T10:00:00.000Z")] })]]));
    await service(repository).read({ workspaceId: workspaceA, productId: productA });
    expect(repository.providerCalls).toBe(0);
  });

  it("does not run qualification in the read-first request", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ signals: [signal("s1", "2026-09-25T10:00:00.000Z")] })]]));
    const result = await service(repository).read({ workspaceId: workspaceA, productId: productA });
    expect(result.intelligence.signals[0]?.qualification).toBeNull();
  });

  it("does not run candidate selection in the read-first request", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ signals: [signal("s1", "2026-09-25T10:00:00.000Z")] })]]));
    const result = await service(repository).read({ workspaceId: workspaceA, productId: productA });
    expect(result.intelligence.signals.map((item) => item.signalId)).toEqual(["s1"]);
  });

  it("keeps the read-first path independent of source budgets", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ signals: [signal("s1", "2026-09-25T10:00:00.000Z")] })]]));
    const result = await service(repository).read({ workspaceId: workspaceA, productId: productA });
    expect(result.intelligence.signals).toHaveLength(1);
  });

  it("does not alter the X experiment configuration path", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState()]]));
    const result = await service(repository).read({ workspaceId: workspaceA, productId: productA });
    expect(result.version).toBe("read_first_intelligence_v1");
  });

  it("preserves workspace and product scoping", async () => {
    const repository = new FakeRepository(new Map([
      [`${workspaceA}:${productA}`, emptyState({ signals: [signal("a", "2026-09-25T10:00:00.000Z", productA)] })],
      [`${workspaceB}:${productB}`, emptyState({ signals: [signal("b", "2026-09-25T10:00:00.000Z", productB)] })],
    ]));
    const result = await service(repository).read({ workspaceId: workspaceB, productId: productB });
    expect(result.workspaceId).toBe(workspaceB);
    expect(result.productId).toBe(productB);
    expect(result.intelligence.signals[0]?.signalId).toBe("b");
  });

  it("returns only the bounded current signal read model", async () => {
    const current = [signal("current", "2026-09-25T10:00:00.000Z")];
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ signals: current })]]));
    const result = await service(repository).read({ workspaceId: workspaceA, productId: productA });
    expect(result.intelligence.signals).toEqual(current);
  });

  it("returns the refresh job handle and status", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState()]]));
    const result = await service(repository, { enqueueRefresh: async () => handle() }).read({ workspaceId: workspaceA, productId: productA });
    expect(result.refresh.jobRunId).toBe(jobRunId);
    expect(result.refresh.status).toBe("queued");
  });

  it("emits bounded read, freshness, enqueue, and total timings", async () => {
    const timings: unknown[] = [];
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ signals: [signal("s1", "2026-09-25T10:00:00.000Z")] })]]));
    const result = await service(repository, { onTiming: (timing) => timings.push(timing) }).read({ workspaceId: workspaceA, productId: productA });
    expect(timings).toHaveLength(1);
    expect(result.timings).toMatchObject({ intelligenceReadMs: expect.any(Number), freshnessEvaluationMs: expect.any(Number), refreshEnqueueMs: 0, totalReadFirstRequestMs: expect.any(Number) });
  });

  it("leaves the existing discovery pipeline job identity unchanged", () => {
    expect(PRODUCT_DEMAND_SCAN_JOB_TYPE).toBe("discover-source");
  });

  it("works without a browser or session dependency", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ signals: [signal("s1", "2026-09-25T10:00:00.000Z")] })]]));
    await expect(service(repository).read({ workspaceId: workspaceA, productId: productA })).resolves.toBeTruthy();
  });

  it("does not leak another workspace's persisted intelligence", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ signals: [signal("private-a", "2026-09-25T10:00:00.000Z")] })]]));
    const result = await service(repository).read({ workspaceId: workspaceB, productId: productA });
    expect(result.intelligence.signals).toEqual([]);
  });

  it("keeps the freshness defaults centralized and ordered", () => {
    expect(getReadFirstFreshnessConfig({})).toEqual(DEFAULT_READ_FIRST_FRESHNESS_CONFIG);
    expect(getReadFirstFreshnessConfig({ READ_FIRST_FRESH_HOURS: "12", READ_FIRST_RECENT_HOURS: "48" })).toEqual({ freshMs: 12 * 60 * 60 * 1_000, recentMs: 48 * 60 * 60 * 1_000 });
  });

  it("uses demand snapshots as persisted current intelligence", async () => {
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ snapshot: snapshot("2026-09-25T09:00:00.000Z") })]]));
    const result = await service(repository).read({ workspaceId: workspaceA, productId: productA });
    expect(result.intelligence.demandSnapshot?.windowType).toBe("30d");
    expect(result.intelligence.demandSummary.snapshotId).toBe("66666666-6666-4666-8666-666666666666");
  });

  it("does not enqueue when an active queued refresh already exists", async () => {
    let calls = 0;
    const repository = new FakeRepository(new Map([[`${workspaceA}:${productA}`, emptyState({ activeRefresh: { jobRunId, status: "pending" } })]]));
    const result = await service(repository, { enqueueRefresh: async () => { calls += 1; return handle(); } }).read({ workspaceId: workspaceA, productId: productA });
    expect(calls).toBe(0);
    expect(result.refresh.status).toBe("queued");
  });
});
