import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { getStructuredLlmProvider } from "@/server/providers/llm";
import { SupabaseIntelligenceRepository } from "@/server/modules/intelligence/intelligence.repository";
import { IntelligenceService } from "@/server/modules/intelligence/intelligence.service";
import { qualificationFromEvidence } from "@/server/modules/intelligence";
import { productMatchResultSchema } from "@/server/modules/intelligence/intelligence.schemas";
import { qualifySignalWithReasoning } from "@/server/modules/intelligence/signal-qualification.service";
import { SemanticShadowReasoningRepository } from "@/server/modules/intelligence/semantic-shadow-reasoning.repository";
import { replaySemanticShadowReasoning } from "@/server/modules/intelligence/semantic-shadow-replay";
import { semanticReasoningFingerprint, SEMANTIC_REASONING_PROMPT_VERSION, SEMANTIC_REASONING_ROUTER_VERSION } from "@/server/modules/intelligence/semantic-reasoning-router";

function requiredUuid(name: string, value: string | undefined): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error(`${name} must be a UUID.`);
  }
  return value;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function main() {
  const [workspaceId, productId, conversationId, evaluationId] = process.argv.slice(2).map((value) => requiredUuid("argument", value));
  if (!workspaceId || !productId || !conversationId || !evaluationId) {
    throw new Error("Usage: vite-node scripts/semantic-shadow-replay.ts <workspace-id> <product-id> <conversation-id> <evaluation-id>");
  }

  const client = createSupabaseServiceClient();
  const [{ data: product, error: productError }, { data: conversation, error: conversationError }, { data: evaluation, error: evaluationError }] = await Promise.all([
    client.from("products").select("*").eq("workspace_id", workspaceId).eq("id", productId).maybeSingle(),
    client.from("conversations").select("*").eq("id", conversationId).maybeSingle(),
    client.from("product_match_evaluations").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("conversation_id", conversationId).eq("id", evaluationId).maybeSingle(),
  ]);
  if (productError || !product) throw new Error("Stored replay product was not found in the workspace.");
  if (conversationError || !conversation) throw new Error("Stored replay conversation was not found.");
  if (evaluationError || !evaluation) throw new Error("Stored replay evaluation was not found for the product and conversation.");

  const [{ data: source, error: sourceError }, { data: analysis, error: analysisError }] = await Promise.all([
    client.from("source_items").select("*").eq("id", conversation.primary_source_item_id).maybeSingle(),
    client.from("conversation_analysis").select("*").eq("id", evaluation.conversation_analysis_id).maybeSingle(),
  ]);
  if (sourceError || !source) throw new Error("Stored replay source evidence was not found.");
  if (analysisError || !analysis) throw new Error("Stored replay conversation analysis was not found.");

  const actualQualification = qualificationFromEvidence(evaluation.evidence);
  if (!actualQualification) throw new Error("Stored replay evaluation has no valid deterministic qualification.");
  const repository = new SupabaseIntelligenceRepository(client);
  const profile = await repository.getDemandProfileById(evaluation.demand_profile_id);
  if (!profile) throw new Error("Stored replay demand profile was not found.");
  const qualificationProfile = await new IntelligenceService(repository).qualificationProfile(product, profile);
  const sourceText = `${source.title ?? conversation.title ?? ""} ${source.body ?? conversation.body ?? ""}`.replace(/\s+/g, " ").trim();
  const metadata = objectValue(source.metadata);
  const hostContext = typeof metadata.projectName === "string" ? metadata.projectName : typeof metadata.repositoryName === "string" ? metadata.repositoryName : null;
  const conversationType = typeof metadata.providerType === "string" ? metadata.providerType : null;
  const deterministic = actualQualification.conversation_reasoning;
  const candidate = {
    conversationId: conversation.id,
    text: sourceText,
    deterministic,
    relevance: actualQualification.dimensions.product_relevance,
    noise: actualQualification.dimensions.noise_risk,
    reasoningVersion: deterministic.version,
    fingerprintInput: {
      conversation: { id: conversation.id, content: sourceText },
      product: { id: product.id, name: product.name, profileId: evaluation.demand_profile_id },
      marketContext: actualQualification.market_context,
      sourceHostContext: { sourceKey: source.source_key, canonicalUrl: source.canonical_url },
      discoveryProvenance: [],
      routerVersion: SEMANTIC_REASONING_ROUTER_VERSION,
      reasoningVersion: deterministic.version,
      promptSchemaVersion: SEMANTIC_REASONING_PROMPT_VERSION,
    },
    promptContext: {
      product: { canonicalName: product.name, description: null, categories: actualQualification.market_context.categories, jobs: actualQualification.market_context.jobs_to_be_done, capabilities: actualQualification.market_context.capabilities, pains: actualQualification.market_context.pains_solved },
      marketContext: actualQualification.market_context,
      source: { provider: source.source_key, hostContext, conversationType, discoverySurfaces: [], queryFamilies: [], concepts: [] },
      conversation: { title: source.title ?? conversation.title, body: source.body ?? conversation.body ?? "", normalizedText: sourceText },
    },
    actualQualification,
    qualifyShadow: (mergedReasoning: typeof deterministic) => {
      const evidence = objectValue(evaluation.evidence);
      const match = productMatchResultSchema.parse({
        decision: evaluation.decision === "qualified" ? "qualified" : evaluation.decision === "weak" ? "weak" : "rejected",
        matchConfidence: evaluation.match_confidence,
        rationale: evaluation.rationale || "Stored deterministic match evaluation.",
        evidence: {
          painAlignment: stringValues(evidence.painAlignment),
          buyerAlignment: stringValues(evidence.buyerAlignment),
          capabilityAlignment: stringValues(evidence.capabilityAlignment),
          intentRelevance: stringValues(evidence.intentRelevance),
        },
      });
      return qualifySignalWithReasoning({ candidateId: conversation.id, productId: product.id, productName: product.name, conversation, sourceItem: source, analysis, match, profile: qualificationProfile }, mergedReasoning);
    },
  };

  const shadowRepository = new SemanticShadowReasoningRepository(client);
  const fingerprint = semanticReasoningFingerprint(candidate.fingerprintInput);
  const cached = await shadowRepository.findByFingerprint({ workspaceId, productId, conversationId, fingerprint, routerVersion: SEMANTIC_REASONING_ROUTER_VERSION, reasoningVersion: deterministic.version, promptSchemaVersion: SEMANTIC_REASONING_PROMPT_VERSION });
  if (cached) throw new Error("A successful immutable shadow artifact already exists for this exact replay input; no provider call was made.");
  const llm = getStructuredLlmProvider();
  if (!llm.provider) throw new Error("StructuredLlmProvider is not configured; no provider call was made.");

  const result = await replaySemanticShadowReasoning({
    enabled: true,
    maxCalls: 1,
    provider: llm.provider,
    providerIdentity: { provider: llm.config.provider, model: llm.config.model },
    persistence: shadowRepository,
    workspaceId,
    productId,
    candidates: [candidate],
  });
  const artifact = await shadowRepository.findByFingerprint({ workspaceId, productId, conversationId, fingerprint, routerVersion: SEMANTIC_REASONING_ROUTER_VERSION, reasoningVersion: deterministic.version, promptSchemaVersion: SEMANTIC_REASONING_PROMPT_VERSION });
  if (!artifact) throw new Error("Replay completed without a successful immutable shadow artifact.");
  console.log(JSON.stringify({
    route: artifact.route_decision,
    routeReasons: artifact.route_reasons,
    providerCalledExactlyOnce: result.execution.llmExecutedCount === 1,
    schemaValidation: artifact.execution_status === "success" ? "passed" : artifact.execution_status,
    evidenceValidation: artifact.evidence_validation,
    deterministicReasoning: artifact.deterministic_reasoning,
    validatedLlmReasoning: artifact.validated_reasoning,
    mergedShadowReasoning: artifact.merged_shadow_reasoning,
    actualQualification: { status: artifact.actual_qualification_status, reasonCodes: artifact.actual_reason_codes },
    shadowQualification: { status: artifact.shadow_qualification_status, reasonCodes: artifact.shadow_reason_codes },
    shadowImpact: artifact.shadow_impact,
    provider: artifact.provider,
    model: artifact.model,
    inputTokens: artifact.input_tokens,
    outputTokens: artifact.output_tokens,
    latencyMs: artifact.latency_ms,
    estimatedCostUsd: artifact.estimated_cost_usd,
    execution: result.execution,
    immutableShadowRowPersisted: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
