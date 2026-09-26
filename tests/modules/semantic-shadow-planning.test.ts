import { describe, expect, it, vi } from "vitest";

import { getSemanticReasoningShadowConfig } from "../../src/server/modules/intelligence/semantic-reasoning-shadow.config";
import { planSemanticShadowReasoning, type SemanticShadowPlanningCandidate } from "../../src/server/modules/intelligence/semantic-shadow-planning";
import type { ConversationMarketReasoning } from "../../src/server/modules/intelligence/signal-qualification.schemas";

function reasoning(overrides: Partial<ConversationMarketReasoning> = {}): ConversationMarketReasoning {
  return {
    version: "conversation_market_reasoning_v1",
    actor_type: "buyer", actor_confidence: 0.7, buyer_context: false, buyer_context_confidence: 0.2,
    current_solution: null, pain_summary: null, requested_outcome: null,
    demand_target_type: "unknown", demand_target: null, source_products: [], destination_products: [],
    mentioned_products: [], direction_relative_to_scanned_product: "unknown", category_or_job_demand: false,
    commercial_intent: false, first_party_experience: true, implementation_only: false, promotional_content: false,
    confidence: 0.2, evidence_spans: [], short_user_facing_summary: "Unclear market intent.",
    short_user_facing_why: "The direction is ambiguous.", relationship_candidates: [], authorial_stance: "unknown",
    ...overrides,
  };
}

function candidate(id: string, overrides: Partial<SemanticShadowPlanningCandidate> = {}): SemanticShadowPlanningCandidate {
  return {
    conversationId: id,
    text: "We are unhappy with the current workflow and evaluating another option.",
    deterministic: reasoning(), relevance: 0.7, noise: 0.1, reasoningVersion: "conversation_market_reasoning_v1",
    fingerprintInput: { id, version: "v1" },
    ...overrides,
  };
}

const neverCache = vi.fn(async () => false);

describe("semantic shadow planning", () => {
  it("keeps deterministic-only and reject-without-LLM routes out of LLM eligibility", async () => {
    const cacheHit = vi.fn(async () => false);
    const result = await planSemanticShadowReasoning({
      enabled: true, maxCalls: 10, cacheHit,
      candidates: [
        candidate("explicit", { deterministic: reasoning({ direction_relative_to_scanned_product: "toward_product", confidence: 0.9 }) }),
        candidate("noise", { text: "short", noise: 0.9 }),
      ],
    });
    expect(result.items.map((item) => [item.conversationId, item.route, item.execution])).toEqual([
      ["explicit", "deterministic_only", "none"],
      ["noise", "reject_without_llm", "none"],
    ]);
    expect(cacheHit).not.toHaveBeenCalled();
  });

  it("places ambiguous candidates into a shadow-only LLM plan", async () => {
    const result = await planSemanticShadowReasoning({ enabled: true, maxCalls: 1, cacheHit: neverCache, candidates: [candidate("ambiguous")] });
    expect(result.items).toMatchObject([{ conversationId: "ambiguous", route: "llm_reasoning", execution: "scheduled_for_llm" }]);
  });

  it("looks up the cache before applying the provider-call budget", async () => {
    const cacheHit = vi.fn(async ({ candidate: item }: { candidate: SemanticShadowPlanningCandidate }) => item.conversationId === "cached");
    const result = await planSemanticShadowReasoning({ enabled: true, maxCalls: 0, cacheHit, candidates: [candidate("cached"), candidate("miss")] });
    expect(result.items.map((item) => [item.conversationId, item.execution])).toEqual([
      ["cached", "cache_hit"],
      ["miss", "budget_skipped"],
    ]);
    expect(result.diagnostics).toMatchObject({ cacheHitCount: 1, scheduledForLlmCount: 0, budgetSkippedCount: 1 });
  });

  it("consumes budget slots only for cache misses and marks candidates over the cap", async () => {
    const result = await planSemanticShadowReasoning({ enabled: true, maxCalls: 1, cacheHit: neverCache, candidates: [candidate("one", { relevance: 0.9 }), candidate("two", { relevance: 0.6 })] });
    expect(result.items.map((item) => [item.conversationId, item.execution])).toEqual([
      ["one", "scheduled_for_llm"],
      ["two", "budget_skipped"],
    ]);
  });

  it("uses a deterministic priority order independent of candidate input order", async () => {
    const first = [candidate("z", { relevance: 0.8 }), candidate("a", { relevance: 0.8 }), candidate("high", { relevance: 0.9 })];
    const forward = await planSemanticShadowReasoning({ enabled: true, maxCalls: 1, cacheHit: neverCache, candidates: first });
    const reverse = await planSemanticShadowReasoning({ enabled: true, maxCalls: 1, cacheHit: neverCache, candidates: [...first].reverse() });
    expect(forward.items).toEqual(reverse.items);
    expect(forward.items.map((item) => item.conversationId)).toEqual(["high", "a", "z"]);
  });

  it("does not mutate deterministic reasoning or qualification state", async () => {
    const deterministic = reasoning();
    const before = structuredClone(deterministic);
    const result = await planSemanticShadowReasoning({ enabled: true, maxCalls: 1, cacheHit: neverCache, candidates: [candidate("stable", { deterministic })] });
    expect(deterministic).toEqual(before);
    expect(result.items[0]).not.toHaveProperty("qualified");
    expect(result.items[0]).not.toHaveProperty("qualification");
  });

  it("creates no LLM execution plan when shadow mode is disabled", async () => {
    const cacheHit = vi.fn(async () => false);
    const result = await planSemanticShadowReasoning({ enabled: false, maxCalls: 5, cacheHit, candidates: [candidate("ambiguous")] });
    expect(result.items).toMatchObject([{ route: "llm_reasoning", execution: "none", fingerprint: null }]);
    expect(cacheHit).not.toHaveBeenCalled();
    expect(result.diagnostics).toMatchObject({ llmRequestedCount: 1, cacheHitCount: 0, scheduledForLlmCount: 0, budgetSkippedCount: 0 });
  });

  it("reconciles diagnostics exactly with planned routing outcomes", async () => {
    const result = await planSemanticShadowReasoning({
      enabled: true, maxCalls: 1,
      cacheHit: async ({ candidate: item }) => item.conversationId === "cached",
      candidates: [
        candidate("explicit", { deterministic: reasoning({ direction_relative_to_scanned_product: "toward_product", confidence: 0.9 }) }),
        candidate("rejected", { text: "short", noise: 0.9 }),
        candidate("cached"), candidate("scheduled", { relevance: 0.9 }), candidate("skipped", { relevance: 0.4 }),
      ],
    });
    const count = (predicate: (item: typeof result.items[number]) => boolean) => result.items.filter(predicate).length;
    expect(result.diagnostics).toEqual({
      deterministicOnlyCount: count((item) => item.route === "deterministic_only"),
      rejectWithoutLlmCount: count((item) => item.route === "reject_without_llm"),
      llmRequestedCount: count((item) => item.route === "llm_reasoning"),
      cacheHitCount: count((item) => item.execution === "cache_hit"),
      scheduledForLlmCount: count((item) => item.execution === "scheduled_for_llm"),
      budgetSkippedCount: count((item) => item.execution === "budget_skipped"),
    });
  });

  it("defaults shadow planning to disabled with zero new provider calls", () => {
    expect(getSemanticReasoningShadowConfig({})).toEqual({ enabled: false, maxNewProviderCallsPerScan: 0 });
    expect(getSemanticReasoningShadowConfig({ SEMANTIC_REASONING_SHADOW_ENABLED: "true", SEMANTIC_REASONING_SHADOW_WORKSPACE_IDS: "workspace-a", SEMANTIC_REASONING_SHADOW_MAX_NEW_CALLS_PER_SCAN: "3" }, "workspace-a")).toEqual({ enabled: true, maxNewProviderCallsPerScan: 3 });
    expect(getSemanticReasoningShadowConfig({ SEMANTIC_REASONING_SHADOW_ENABLED: "true", SEMANTIC_REASONING_SHADOW_WORKSPACE_IDS: "workspace-a" }, "workspace-b")).toMatchObject({ enabled: false });
  });
});
