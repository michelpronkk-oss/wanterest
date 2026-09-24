import { conversationMarketReasoningSchema, type SignalQualification } from "./signal-qualification.schemas";
import { canCompareSemanticShadowArtifact, compareSemanticShadowQualification, summarizeSemanticShadowComparisons } from "./semantic-shadow-comparison";
import { executeScheduledSemanticShadowReasoning, type SemanticShadowExecutionCandidate, type SemanticShadowExecutionDiagnostics, type SemanticShadowPersistence } from "./semantic-shadow-execution";
import { planSemanticShadowReasoning, type ShadowPlanDiagnostics } from "./semantic-shadow-planning";
import { SEMANTIC_REASONING_PROMPT_VERSION, SEMANTIC_REASONING_ROUTER_VERSION } from "./semantic-reasoning-router";
import type { StructuredLlmProvider } from "../../providers/llm/contracts";

export type SemanticShadowReplayCandidate = SemanticShadowExecutionCandidate & {
  actualQualification: SignalQualification;
  qualifyShadow(mergedReasoning: SignalQualification["conversation_reasoning"]): SignalQualification;
};

export type SemanticShadowReplayPersistence = SemanticShadowPersistence & {
  findByFingerprint(input: { workspaceId: string; productId: string; conversationId: string; fingerprint: string; routerVersion: string; reasoningVersion: string; promptSchemaVersion: string }): Promise<Record<string, unknown> | null>;
  persistComparison(input: { workspaceId: string; productId: string; conversationId: string; fingerprint: string; routerVersion: string; reasoningVersion: string; promptSchemaVersion: string; actualStatus: string; actualReasonCodes: unknown; shadowStatus: string; shadowReasonCodes: unknown; impact: unknown }): Promise<unknown>;
};

/**
 * Replays stored/prepared candidates through the shadow path only. It has no
 * dependency on production evaluation, ranking, signal, or lifecycle writes.
 */
export async function replaySemanticShadowReasoning(input: {
  enabled: boolean;
  maxCalls: number;
  provider: StructuredLlmProvider | null;
  providerIdentity: { provider: string | null; model: string | null };
  persistence: SemanticShadowReplayPersistence;
  workspaceId: string;
  productId: string;
  candidates: SemanticShadowReplayCandidate[];
}): Promise<{ planning: ShadowPlanDiagnostics; execution: SemanticShadowExecutionDiagnostics; comparison: ReturnType<typeof summarizeSemanticShadowComparisons> }> {
  const plan = await planSemanticShadowReasoning({
    enabled: input.enabled,
    maxCalls: input.maxCalls,
    candidates: input.candidates,
    cacheHit: async ({ fingerprint, candidate }) => Boolean(await input.persistence.findByFingerprint({ workspaceId: input.workspaceId, productId: input.productId, conversationId: candidate.conversationId, fingerprint, routerVersion: SEMANTIC_REASONING_ROUTER_VERSION, reasoningVersion: candidate.reasoningVersion, promptSchemaVersion: SEMANTIC_REASONING_PROMPT_VERSION })),
  });
  const execution = await executeScheduledSemanticShadowReasoning({ provider: input.provider, providerIdentity: input.providerIdentity, persistence: input.persistence, workspaceId: input.workspaceId, productId: input.productId, plans: plan.items, candidates: input.candidates });
  const byConversation = new Map(input.candidates.map((candidate) => [candidate.conversationId, candidate]));
  const comparisons = [];
  for (const item of plan.items.filter((item) => item.execution === "cache_hit" || item.execution === "scheduled_for_llm")) {
    const candidate = byConversation.get(item.conversationId);
    if (!candidate || !item.fingerprint) continue;
    const artifact = await input.persistence.findByFingerprint({ workspaceId: input.workspaceId, productId: input.productId, conversationId: candidate.conversationId, fingerprint: item.fingerprint, routerVersion: SEMANTIC_REASONING_ROUTER_VERSION, reasoningVersion: candidate.reasoningVersion, promptSchemaVersion: SEMANTIC_REASONING_PROMPT_VERSION });
    if (!artifact || !canCompareSemanticShadowArtifact(artifact)) continue;
    const merged = conversationMarketReasoningSchema.safeParse(artifact.merged_shadow_reasoning);
    if (!merged.success) continue;
    const comparison = compareSemanticShadowQualification(candidate.actualQualification, candidate.qualifyShadow(merged.data));
    comparisons.push(comparison);
    await input.persistence.persistComparison({ workspaceId: input.workspaceId, productId: input.productId, conversationId: candidate.conversationId, fingerprint: item.fingerprint, routerVersion: SEMANTIC_REASONING_ROUTER_VERSION, reasoningVersion: candidate.reasoningVersion, promptSchemaVersion: SEMANTIC_REASONING_PROMPT_VERSION, actualStatus: comparison.actual.status, actualReasonCodes: comparison.actual.reason_codes, shadowStatus: comparison.shadow.status, shadowReasonCodes: comparison.shadow.reason_codes, impact: comparison.impact });
  }
  return { planning: plan.diagnostics, execution, comparison: summarizeSemanticShadowComparisons(comparisons) };
}
