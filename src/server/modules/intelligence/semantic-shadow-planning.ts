import type { ConversationMarketReasoning } from "./signal-qualification.schemas";
import { routeSemanticReasoning, semanticReasoningFingerprint, type SemanticReasoningReason, type SemanticReasoningRoute } from "./semantic-reasoning-router";

export type ShadowPlanItem = { conversationId: string; route: SemanticReasoningRoute; reasons: SemanticReasoningReason[]; priority: number; fingerprint: string | null; execution: "none" | "cache_hit" | "scheduled_for_llm" | "budget_skipped" };
export type ShadowPlanDiagnostics = { deterministicOnlyCount: number; rejectWithoutLlmCount: number; llmRequestedCount: number; cacheHitCount: number; scheduledForLlmCount: number; budgetSkippedCount: number };

export type SemanticShadowPlanningCandidate = {
  conversationId: string;
  text: string;
  deterministic: ConversationMarketReasoning;
  relevance: number;
  noise: number;
  fingerprintInput: unknown;
  reasoningVersion: string;
};

export async function planSemanticShadowReasoning(input: { enabled: boolean; maxCalls: number; candidates: SemanticShadowPlanningCandidate[]; cacheHit: (input: { fingerprint: string; candidate: SemanticShadowPlanningCandidate }) => Promise<boolean> }): Promise<{ items: ShadowPlanItem[]; diagnostics: ShadowPlanDiagnostics }> {
  const items: ShadowPlanItem[] = [];
  const eligible: ShadowPlanItem[] = [];
  for (const candidate of input.candidates) {
    const decision = routeSemanticReasoning(candidate);
    if (!input.enabled || decision.route !== "llm_reasoning") { items.push({ conversationId: candidate.conversationId, route: decision.route, reasons: decision.reasons, priority: decision.priority, fingerprint: null, execution: "none" }); continue; }
    const fingerprint = semanticReasoningFingerprint(candidate.fingerprintInput);
    if (await input.cacheHit({ fingerprint, candidate })) items.push({ conversationId: candidate.conversationId, route: decision.route, reasons: decision.reasons, priority: decision.priority, fingerprint, execution: "cache_hit" });
    else eligible.push({ conversationId: candidate.conversationId, route: decision.route, reasons: decision.reasons, priority: decision.priority, fingerprint, execution: "scheduled_for_llm" });
  }
  eligible.sort((a, b) => b.priority - a.priority || a.conversationId.localeCompare(b.conversationId));
  for (const [index, item] of eligible.entries()) items.push({ ...item, execution: index < Math.max(0, input.maxCalls) ? "scheduled_for_llm" : "budget_skipped" });
  items.sort((a, b) => b.priority - a.priority || a.conversationId.localeCompare(b.conversationId));
  const count = (predicate: (item: ShadowPlanItem) => boolean) => items.filter(predicate).length;
  return { items, diagnostics: { deterministicOnlyCount: count((item) => item.route === "deterministic_only"), rejectWithoutLlmCount: count((item) => item.route === "reject_without_llm"), llmRequestedCount: count((item) => item.route === "llm_reasoning"), cacheHitCount: count((item) => item.execution === "cache_hit"), scheduledForLlmCount: count((item) => item.execution === "scheduled_for_llm"), budgetSkippedCount: count((item) => item.execution === "budget_skipped") } };
}
