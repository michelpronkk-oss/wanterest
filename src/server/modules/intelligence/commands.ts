import "server-only";

import { requireUser } from "../auth";
import { getProductQuery } from "../products";
import { workspaceIdSchema } from "../products/product.schemas";
import { AppError } from "../../lib/errors";
import { createSupabaseServerClient } from "../../providers/supabase/server";
import { createSupabaseServiceClient } from "../../providers/supabase/service";
import { SupabaseIntelligenceRepository } from "./intelligence.repository";
import { IntelligenceService } from "./intelligence.service";
import { FixtureConversationAnalysisEngine, FixtureDemandProfileEngine, FixtureProductMatchingEngine } from "./engines";
import { FixtureBusinessClassificationEngine, StructuredLlmBusinessClassificationEngine } from "./business-classification.engines";
import { classifyProductBusiness, tryClassifyProductBusiness } from "./business-classification.service";
import { FixtureDemandProfileV2Engine, StructuredLlmDemandProfileV2Engine } from "./demand-profile-v2.engines";
import { buildDemandProfileV2, readDemandProfileV2, tryBuildDemandProfileV2 } from "./demand-profile-v2.service";
import { getStructuredLlmProvider, engineRegistryVersion, type LlmRuntimeConfig } from "../../providers/llm";
import { WebsiteUnderstandingService } from "../../providers/website";
import { jsonValueSchema, type Json } from "../../db/database.helpers";
import { ensureEngineVersion } from "../observability/engine.repository";

function service() {
  return new IntelligenceService(new SupabaseIntelligenceRepository(createSupabaseServiceClient()));
}

function logUnderstanding(operation: string, input: { config: LlmRuntimeConfig; fallbackUsed: boolean; success: boolean; confidence?: number; failureKind?: string; status?: number | null }): void {
  if (process.env.NODE_ENV === "production") return;
  console.info("[product-understanding]", {
    provider: input.config.provider,
    model: input.config.model,
    operation,
    success: input.success,
    fallbackUsed: input.fallbackUsed,
    outputConfidence: input.confidence ?? null,
    failureKind: input.failureKind ?? null,
    status: input.status ?? null,
  });
}

async function productUnderstandingEngineVersion(client: ReturnType<typeof createSupabaseServiceClient>, engineType: "classification" | "profile", version: string, config: LlmRuntimeConfig): Promise<string | null> {
  try {
    return (await ensureEngineVersion(client, {
      engine_type: engineType,
      version: engineRegistryVersion(version, config),
      model: config.model,
      prompt_version: version,
      config_hash: null,
      metadata: { workflow: "product-understanding", provider: config.provider },
    })).id;
  } catch {
    console.warn("[product-understanding] engine version unavailable; continuing without registry linkage.", { engineType, provider: config.provider, model: config.model });
    return null;
  }
}

function providerFailure(error: unknown): { kind: string; status: number | null } {
  if (!error || typeof error !== "object") return { kind: "failed", status: null };
  const value = error as { kind?: unknown; status?: unknown };
  return { kind: typeof value.kind === "string" ? value.kind : "failed", status: typeof value.status === "number" ? value.status : null };
}

function demandProfileCounts(profile: { problems: unknown[]; desired_outcomes: unknown[]; jobs_to_be_done: unknown[]; switching_triggers: unknown[]; buying_intents: unknown[]; feature_demands: unknown[]; objections: unknown[]; competitors: { known_competitors: unknown[]; detected_competitor_candidates: unknown[] }; alternatives: unknown[]; comparison_terms: unknown[] }): Record<string, number> {
  return {
    painCount: profile.problems.length,
    desiredOutcomeCount: profile.desired_outcomes.length,
    jobCount: profile.jobs_to_be_done.length,
    switchingTriggerCount: profile.switching_triggers.length,
    buyingIntentCount: profile.buying_intents.length,
    featureDemandCount: profile.feature_demands.length,
    objectionCount: profile.objections.length,
    knownCompetitorCount: profile.competitors.known_competitors.length,
    detectedCompetitorCount: profile.competitors.detected_competitor_candidates.length,
    alternativeCount: profile.alternatives.length,
    comparisonTermCount: profile.comparison_terms.length,
  };
}

type ProductSnapshotCapture = {
  rawText: string;
  sourceUrl?: string | null;
  pageType: "manual" | "homepage" | "pricing" | "features" | "use_cases";
  metadata?: Json;
};

async function captureProductUnderstandingSnapshotCommand(workspaceId: unknown, productId: unknown, capture: ProductSnapshotCapture) {
  const product = await getProductQuery(workspaceId, productId);
  const client = createSupabaseServiceClient();
  const intelligence = new IntelligenceService(new SupabaseIntelligenceRepository(client));
  const llm = getStructuredLlmProvider();
  const fixtureClassificationEngine = new FixtureBusinessClassificationEngine();
  const classificationEngine = llm.provider ? new StructuredLlmBusinessClassificationEngine(llm.provider) : fixtureClassificationEngine;
  const classificationEngineVersionId = await productUnderstandingEngineVersion(client, classificationEngine.engineType, classificationEngine.version, llm.config);
  const classificationInput = {
    product,
    productName: product.name,
    websiteUrl: capture.sourceUrl ?? product.website_url,
    snapshotText: capture.rawText,
    sourceReference: capture.sourceUrl ?? product.website_url ?? `product:${product.id}`,
  };
  let classification = null;
  let classificationConfig = llm.config;
  if (llm.provider) {
    try {
      classification = await classifyProductBusiness(classificationInput, classificationEngine, classificationEngineVersionId);
      logUnderstanding("business_classification", { config: llm.config, fallbackUsed: false, success: true, confidence: classification.overall_confidence });
    } catch (error) {
      const failure = providerFailure(error);
      const fallbackConfig = { provider: "fixture" as const, model: "deterministic", apiKeyPresent: false };
      const fallbackVersionId = await productUnderstandingEngineVersion(client, fixtureClassificationEngine.engineType, fixtureClassificationEngine.version, fallbackConfig);
      classificationConfig = fallbackConfig;
      classification = await tryClassifyProductBusiness(classificationInput, fixtureClassificationEngine, fallbackVersionId);
      logUnderstanding("business_classification", { config: llm.config, fallbackUsed: true, success: Boolean(classification), failureKind: failure.kind, status: failure.status, confidence: classification?.overall_confidence });
    }
  } else {
    classification = await tryClassifyProductBusiness(classificationInput, fixtureClassificationEngine, classificationEngineVersionId);
    logUnderstanding("business_classification", { config: llm.config, fallbackUsed: true, success: Boolean(classification), failureKind: llm.config.apiKeyPresent ? "failed" : "unavailable", confidence: classification?.overall_confidence });
  }
  if (!classification) {
    console.warn("[business-classification] unavailable; product understanding will continue.", { provider: classificationConfig.provider });
  }
  const fixtureProfileEngine = new FixtureDemandProfileV2Engine();
  const profileEngine = llm.provider ? new StructuredLlmDemandProfileV2Engine(llm.provider) : fixtureProfileEngine;
  const profileEngineVersionId = await productUnderstandingEngineVersion(client, profileEngine.engineType, profileEngine.version, llm.config);
  const profileInput = { productName: product.name, websiteUrl: capture.sourceUrl ?? product.website_url, snapshot: { id: "pending", normalized_text: capture.rawText, source_url: capture.sourceUrl ?? product.website_url, metadata: jsonValueSchema.parse(capture.metadata ?? {}), page_type: capture.pageType }, sourceReference: capture.sourceUrl ?? product.website_url ?? `product:${product.id}`, businessClassification: classification };
  let demandProfileV2 = null;
  if (llm.provider) {
    try {
      demandProfileV2 = await buildDemandProfileV2(profileInput, profileEngine, profileEngineVersionId);
      logUnderstanding("demand_profile_v2", { config: llm.config, fallbackUsed: false, success: true, confidence: demandProfileV2.confidence.overall_profile_confidence });
    } catch (error) {
      const failure = providerFailure(error);
      const fallbackConfig = { provider: "fixture" as const, model: "deterministic", apiKeyPresent: false };
      const fallbackVersionId = await productUnderstandingEngineVersion(client, fixtureProfileEngine.engineType, fixtureProfileEngine.version, fallbackConfig);
      demandProfileV2 = await tryBuildDemandProfileV2(profileInput, fixtureProfileEngine, fallbackVersionId);
      logUnderstanding("demand_profile_v2", { config: llm.config, fallbackUsed: true, success: Boolean(demandProfileV2), failureKind: failure.kind, status: failure.status, confidence: demandProfileV2?.confidence.overall_profile_confidence });
    }
  } else {
    demandProfileV2 = await tryBuildDemandProfileV2(profileInput, fixtureProfileEngine, profileEngineVersionId);
    logUnderstanding("demand_profile_v2", { config: llm.config, fallbackUsed: true, success: Boolean(demandProfileV2), failureKind: llm.config.apiKeyPresent ? "failed" : "unavailable", confidence: demandProfileV2?.confidence.overall_profile_confidence });
  }
  if (!demandProfileV2) console.warn("[demand-profile-v2] unavailable; product understanding will continue.");
  else console.info("[demand-profile-v2]", JSON.stringify({ version: demandProfileV2.version, confidence: demandProfileV2.confidence.overall_profile_confidence, ...demandProfileCounts(demandProfileV2) }));
  return intelligence.createSnapshot(product, { pageType: capture.pageType, rawText: capture.rawText, sourceUrl: capture.sourceUrl, metadata: capture.metadata, businessClassification: classification, demandProfileV2 });
}

export async function captureManualProductSnapshotCommand(workspaceId: unknown, productId: unknown, rawText: string, sourceUrl?: string | null) {
  return captureProductUnderstandingSnapshotCommand(workspaceId, productId, { rawText, sourceUrl, pageType: "manual" });
}

export async function captureWebsiteProductSnapshotCommand(workspaceId: unknown, productId: unknown, userDescription: string, sourceUrl: string) {
  const understanding = await new WebsiteUnderstandingService().understand({ websiteUrl: sourceUrl, userDescription });
  const rawText = understanding.input.combinedText || userDescription;
  return {
    snapshot: await captureProductUnderstandingSnapshotCommand(workspaceId, productId, {
      rawText,
      sourceUrl: understanding.input.canonicalUrl,
      pageType: understanding.input.pages.length ? "homepage" : "manual",
      metadata: jsonValueSchema.parse({ website_understanding: understanding.provenance }),
    }),
    website: understanding,
  };
}

export async function generateDemandProfileCommand(workspaceId: unknown, productId: unknown, engineVersionId: string) {
  const product = await getProductQuery(workspaceId, productId);
  const intelligence = service();
  const profile = await intelligence.generateDemandProfile(product, engineVersionId, new FixtureDemandProfileEngine());
  try {
    const client = createSupabaseServiceClient();
    const repository = new SupabaseIntelligenceRepository(client);
    const latestSnapshot = (await repository.getProductSnapshots(product.id)).at(-1);
    const existingV2 = latestSnapshot ? readDemandProfileV2(latestSnapshot) : null;
    if (existingV2) {
      console.info("[demand-profile-v2] reused persisted result", { provider: existingV2.provider, model: existingV2.model, confidence: existingV2.confidence.overall_profile_confidence });
      return profile;
    }
    const llm = getStructuredLlmProvider();
    const fixtureEngine = new FixtureDemandProfileV2Engine();
    const engine = llm.provider ? new StructuredLlmDemandProfileV2Engine(llm.provider) : fixtureEngine;
    const engineVersionIdForRun = await productUnderstandingEngineVersion(client, engine.engineType, engine.version, llm.config);
    if (!engineVersionIdForRun) throw new Error("Product understanding engine version was not available.");
    let result;
    if (llm.provider) {
      try {
        result = await intelligence.generateDemandProfileV2(product, engineVersionIdForRun, engine);
        logUnderstanding("demand_profile_v2", { config: llm.config, fallbackUsed: false, success: true, confidence: result.profile.confidence.overall_profile_confidence });
      } catch (error) {
        const failure = providerFailure(error);
        const fallbackConfig = { provider: "fixture" as const, model: "deterministic", apiKeyPresent: false };
        const fallbackVersionId = await productUnderstandingEngineVersion(client, fixtureEngine.engineType, fixtureEngine.version, fallbackConfig);
        if (!fallbackVersionId) throw error;
        result = await intelligence.generateDemandProfileV2(product, fallbackVersionId, fixtureEngine);
        logUnderstanding("demand_profile_v2", { config: llm.config, fallbackUsed: true, success: true, failureKind: failure.kind, status: failure.status, confidence: result.profile.confidence.overall_profile_confidence });
      }
    } else {
      result = await intelligence.generateDemandProfileV2(product, engineVersionIdForRun, fixtureEngine);
      logUnderstanding("demand_profile_v2", { config: llm.config, fallbackUsed: true, success: true, failureKind: "unavailable", confidence: result.profile.confidence.overall_profile_confidence });
    }
    console.info("[demand-profile-v2]", JSON.stringify({ version: result.profile.version, confidence: result.profile.confidence.overall_profile_confidence, ...demandProfileCounts(result.profile) }));
  } catch {
    console.warn("[demand-profile-v2] unavailable; existing demand profile remains usable.");
  }
  return profile;
}

export async function analyzeConversationJob(conversationId: string, sourceItemId: string, engineVersionId: string) {
  const repository = new SupabaseIntelligenceRepository(createSupabaseServiceClient());
  const conversation = await repository.getConversation(conversationId);
  const sourceItem = await repository.getSourceItem(sourceItemId);
  if (!conversation || !sourceItem) throw new Error("Conversation source evidence was not found.");
  return new IntelligenceService(repository).analyzeConversation(conversation, sourceItem, engineVersionId, new FixtureConversationAnalysisEngine());
}

export async function matchProductJob(workspaceId: unknown, productId: unknown, profileId: string, analysisId: string, engineVersionId: string) {
  const product = await getProductQuery(workspaceId, productId);
  return service().matchProduct(product, profileId, analysisId, engineVersionId, new FixtureProductMatchingEngine());
}

export async function rankMatchJob(workspaceId: unknown, productId: unknown, evaluationId: string, rankingEngineVersionId: string) {
  const product = await getProductQuery(workspaceId, productId);
  return service().rankEvaluation(product, evaluationId, rankingEngineVersionId);
}

export async function refreshSignalJob(workspaceId: unknown, productId: unknown, evaluationId: string, rankingId: string) {
  const product = await getProductQuery(workspaceId, productId);
  return service().materializeSignal(product, evaluationId, rankingId);
}

export async function addMatchFeedbackCommand(input: Parameters<IntelligenceService["addFeedback"]>[0]) {
  const user = await requireUser();
  return service().addFeedback({ ...input, actorUserId: user.id });
}

export async function listSignalsQuery(workspaceId: unknown, productId: unknown, filters?: Parameters<IntelligenceService["listSignals"]>[2]) {
  const product = await getProductQuery(workspaceId, productId);
  return service().listSignals(product.workspace_id, product.id, filters);
}

export async function getSignalQuery(workspaceId: unknown, signalId: string) {
  await requireUser();
  const workspace = workspaceIdSchema.safeParse(workspaceId);
  if (!workspace.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace identifier.");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("signals").select("product_id").eq("workspace_id", workspace.data).eq("id", signalId).maybeSingle();
  if (error || !data) throw new Error("Signal was not found.");
  const product = await getProductQuery(workspace.data, data.product_id);
  return service().getSignal(product.workspace_id, signalId);
}

/** Thin read wrapper: resolves the product's current snapshot (business classification / demand profile v2 live in its metadata). No product-understanding logic here. */
export async function getCurrentProductSnapshotQuery(workspaceId: unknown, productId: unknown) {
  const product = await getProductQuery(workspaceId, productId);
  await requireUser();
  if (!product.current_snapshot_id) return null;
  const repository = new SupabaseIntelligenceRepository(createSupabaseServiceClient());
  const snapshots = await repository.getProductSnapshots(product.id);
  return snapshots.find((snapshot) => snapshot.id === product.current_snapshot_id) ?? null;
}

export async function setSignalLifecycleCommand(workspaceId: unknown, signalId: string, lifecycleStatus: "active" | "saved" | "dismissed" | "archived") {
  await requireUser();
  const workspace = workspaceIdSchema.safeParse(workspaceId);
  if (!workspace.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace identifier.");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("set_signal_lifecycle", { p_workspace_id: workspace.data, p_signal_id: signalId, p_lifecycle_status: lifecycleStatus });
  if (error || !data) throw new Error("Signal lifecycle could not be updated.");
  return data;
}
