import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "@/server/db/database.types";
import { jsonObjectSchema, type ProductRow, type SourceItemRow, type ConversationRow } from "@/server/db/database.helpers";
import { AppError, toPublicError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { SourceControlService, SupabaseSourceControlStore } from "@/server/modules/operations/source-control.service";
import { SupabaseIngestionRepository } from "@/server/modules/ingestion/ingestion.repository";
import { IngestionService } from "@/server/modules/ingestion/ingestion.service";
import { createSourceRegistry } from "@/server/providers/source/registry";
import { getRedditRuntimeConfig } from "@/server/providers/source/reddit/reddit.auth";
import { getXRuntimeConfig } from "@/server/providers/source/x/x.auth";
import { SupabaseIntelligenceRepository } from "@/server/modules/intelligence/intelligence.repository";
import { IntelligenceService } from "@/server/modules/intelligence/intelligence.service";
import { qualificationFromEvidence, readBusinessClassification, readDemandProfileV2, readDemandProfileV2RoutingModel } from "@/server/modules/intelligence";
import { FixtureConversationAnalysisEngine, FixtureProductMatchingEngine } from "@/server/modules/intelligence/engines";
import { ensureEngineVersion } from "@/server/modules/observability/engine.repository";
import { getTraceId } from "@/server/lib/request-context";
import { buildSourceRoutingPlan, selectExecutableSourceRoutes, type SourceRoutingPlan, type SourceRoutingHealthStatus } from "@/server/modules/operations/source-routing.index";
import { buildQueryPlan, toSourceDiscoveryRequest, type QueryPlan } from "@/server/modules/operations/query-planning.index";
import { sourceDiscoveryRequestSchema, type SourceDiscoveryRequest } from "@/server/providers/source/contracts";
import { g2MappingsFromSourceFilters, g2SourceFiltersWithMappings, type G2ProductMapping, type G2ProductResolutionTarget } from "@/server/providers/source/g2/product-resolution";
import { getSourceRuntimeConfiguration } from "@/server/providers/source/runtime";
import { rebuildDemandIntelligenceForScan, type DemandRebuildResult } from "@/server/modules/demand-intelligence/demand.orchestration";
import { generateActionsForScan, type ActionGenerationForScanResult } from "@/server/modules/actions/action.orchestration";
import { scanCandidateReviewSchema, sourceScanResultSchema, type ScanCandidateReview, type ScanMode, type ScanProgress, type SourceScanResult } from "@/server/modules/operations/product-demand-scan.schemas";
import { initialScanIdempotencyKey, isActiveProductDemandScanJob, PRODUCT_DEMAND_SCAN_JOB_TYPE, shouldRefreshDerivedIntelligence } from "@/server/modules/operations/product-demand-scan.identity";
import { reconcileActiveProductDemandScanJobs, reconcileProductDemandScanJob } from "@/server/modules/operations/product-demand-scan.recovery";
import { isActiveProduct } from "@/server/modules/products/product-lifecycle";
import { resolveMonitoringPolicy, type MonitoringPolicy } from "@/server/modules/entitlements/monitoring-policy";
import { getProviderBudget, getScanBudget, resolveWorkspaceCapabilities, scanProfileForMode, sourceKeyForProviderBudget, type PlanCapabilities } from "@/server/modules/entitlements/plan-capabilities";
import { buildScanJobReference } from "./scan-job-metadata";

type Client = SupabaseClient<Database>;

const scanResultSchema = z.object({
  state: z.enum(["complete", "complete_no_signals", "complete_with_warnings"]),
  rawItems: z.number().int().nonnegative(),
  normalizedItems: z.number().int().nonnegative(),
  conversations: z.number().int().nonnegative(),
  analyses: z.number().int().nonnegative(),
  evaluations: z.number().int().nonnegative(),
  rankings: z.number().int().nonnegative(),
  signals: z.number().int().nonnegative(),
  newSignals: z.number().int().nonnegative().optional(),
  sources: z.array(z.string()),
  diagnostics: z.array(z.object({ sourceKey: z.string(), state: z.string(), message: z.string().optional() })),
  sourceResults: z.array(sourceScanResultSchema).optional(),
  mapUpdated: z.number().int().nonnegative().optional(),
  gapUpdated: z.number().int().nonnegative().optional(),
  driftUpdated: z.number().int().nonnegative().optional(),
  actionsUpdated: z.number().int().nonnegative().optional(),
  routing: z.object({ version: z.string(), coverageStatus: z.string(), coverageConfidence: z.number(), selectedSources: z.array(z.string()), excludedSources: z.array(z.string()) }).optional(),
  queryPlanning: z.object({ version: z.string(), sourceCount: z.number().int().nonnegative(), queryCount: z.number().int().nonnegative(), queryFamilyDistribution: z.record(z.string(), z.number().int().nonnegative()), queriesPerSource: z.record(z.string(), z.number().int().nonnegative()), candidateBudgetPerSource: z.record(z.string(), z.number().int().nonnegative()), suppressedDuplicateCount: z.number().int().nonnegative(), lowConfidence: z.boolean() }).optional(),
  qualification: z.object({ version: z.string(), thresholdVersion: z.string(), candidateCount: z.number().int().nonnegative(), qualifiedCount: z.number().int().nonnegative(), highConfidenceCount: z.number().int().nonnegative(), weakCount: z.number().int().nonnegative(), rejectedCount: z.number().int().nonnegative(), rejectionReasonDistribution: z.record(z.string(), z.number().int().nonnegative()), intentDistribution: z.record(z.string(), z.number().int().nonnegative()), averageDemandQuality: z.number().min(0).max(1), averageConfidence: z.number().min(0).max(1) }).optional(),
  candidateReviews: z.array(scanCandidateReviewSchema).max(100).optional(),
});

export type InitialScanResult = z.infer<typeof scanResultSchema>;

export type InitialScanJobState = {
  jobRunId: string;
  status: string;
  phase: string;
  progress: ScanProgress | null;
  result: InitialScanResult | null;
  errorMessage: string | null;
  idempotencyKey: string;
  completedAt: string | null;
};

export type SourceExecutionInput = {
  sourceKey: string;
  requests: SourceDiscoveryRequest[];
  traceId: string;
  /**
   * Keeps discovery idempotent within one durable scan while allowing a
   * later manual rescan to execute the same semantic request again.
   */
  jobRunId: string;
};

export type SourceExecutionResult = {
  sourceKey: string;
  rawSourceItemIds: string[];
  normalizedSourceItemIds: string[];
  conversationIds: string[];
  rawInserted: number;
  itemsReturned: number;
  queryCount: number;
  diagnostics: string[];
  rateLimitRemaining: number | null;
  estimatedCost: number | null;
  providerMetrics?: Record<string, unknown>;
  resolutions?: Array<{
    status: "resolved" | "no_match" | "ambiguous_match";
    targetKey: string;
    targetFingerprint: string;
    productId?: string;
    matchedBy?: "domain" | "name" | "slug" | "vendor_product_metadata";
    candidateProductIds: string[];
    resolvedAt: string;
    resolverVersion: string;
  }>;
};

export type SourceExecutionBatchResult = {
  sourceKey: string;
  execution?: SourceExecutionResult;
  fallback?: boolean;
  error?: string;
};

function requestScopedToScan(request: SourceDiscoveryRequest, jobRunId: string): SourceDiscoveryRequest {
  return sourceDiscoveryRequestSchema.parse({
    ...request,
    requestMetadata: { ...request.requestMetadata, scanJobRunId: jobRunId },
  });
}

function productDomain(product: ProductRow): string | undefined {
  if (!product.website_url) return undefined;
  try { return new URL(product.website_url).hostname.replace(/^www\./, ""); } catch { return undefined; }
}

function g2ProductTarget(product: ProductRow): G2ProductResolutionTarget {
  return { key: "product", kind: "product", name: product.name, slug: product.slug, domain: productDomain(product), metadata: { wanterestProductId: product.id } };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function loadG2ProductMappings(client: Client, product: ProductRow): Promise<Record<string, G2ProductMapping>> {
  const result = await client.from("discovery_strategies").select("filters").eq("workspace_id", product.workspace_id).eq("product_id", product.id).eq("source_key", "g2").eq("strategy_version", 1).maybeSingle();
  if (result.error) throw new AppError("INTERNAL_ERROR", "G2 source metadata could not be loaded.", 500, { providerMessage: result.error.message });
  return g2MappingsFromSourceFilters(result.data?.filters);
}

function g2RequestForProduct(request: SourceDiscoveryRequest, product: ProductRow, mappings: Record<string, G2ProductMapping>): SourceDiscoveryRequest {
  if (request.requestMetadata && typeof request.requestMetadata === "object") {
    const metadata = request.requestMetadata as Record<string, unknown>;
    const currentTargets = Array.isArray(metadata.g2Targets) ? metadata.g2Targets : [];
    const targets = currentTargets.length
      ? currentTargets.map((value) => {
          const target = objectValue(value);
          return target.key === "product" ? g2ProductTarget(product) : value;
        })
      : [g2ProductTarget(product)];
    return sourceDiscoveryRequestSchema.parse({
      ...request,
      requestMetadata: {
        ...metadata,
        g2Targets: targets,
        g2ProductMappings: mappings,
        g2ScanContext: { workspaceId: product.workspace_id, productId: product.id },
      },
    });
  }
  return sourceDiscoveryRequestSchema.parse({ ...request, requestMetadata: { g2Targets: [g2ProductTarget(product)], g2ProductMappings: mappings, g2ScanContext: { workspaceId: product.workspace_id, productId: product.id } } });
}

async function persistG2Resolutions(client: Client, context: { workspaceId: string; productId: string }, resolutions: SourceExecutionResult["resolutions"]): Promise<void> {
  if (!resolutions?.length) return;
  const existing = await client.from("discovery_strategies").select("filters").eq("workspace_id", context.workspaceId).eq("product_id", context.productId).eq("source_key", "g2").eq("strategy_version", 1).maybeSingle();
  if (existing.error) throw new AppError("INTERNAL_ERROR", "G2 source metadata could not be loaded.", 500, { providerMessage: existing.error.message });
  const mappings = g2MappingsFromSourceFilters(existing.data?.filters);
  for (const resolution of resolutions) mappings[resolution.targetKey] = resolution as G2ProductMapping;
  const filters = g2SourceFiltersWithMappings(existing.data?.filters, mappings);
  const saved = await client.from("discovery_strategies").upsert({ workspace_id: context.workspaceId, product_id: context.productId, source_key: "g2", strategy_version: 1, filters, is_active: true }).select("id").single();
  if (saved.error) throw new AppError("INTERNAL_ERROR", "G2 source metadata could not be stored.", 500, { providerMessage: saved.error.message });
}

function g2ContextFromRequests(requests: SourceDiscoveryRequest[]): { workspaceId: string; productId: string } | null {
  for (const request of requests) {
    const context = objectValue(request.requestMetadata.g2ScanContext);
    if (typeof context.workspaceId === "string" && typeof context.productId === "string") return { workspaceId: context.workspaceId, productId: context.productId };
  }
  return null;
}

export type CandidateProcessingResult = {
  conversationCount: number;
  analyses: number;
  evaluations: number;
  rankings: number;
  signals: number;
  /** Qualified signals created by this scan; existing signal refreshes are excluded. */
  newSignals?: number;
  evaluationIds: string[];
  /** Positional with evaluationIds; null means the evaluation was not materialized as a signal. */
  signalIds: Array<string | null>;
  candidateReviews: ScanCandidateReview[];
  qualification?: InitialScanResult["qualification"];
  diagnostics: InitialScanResult["diagnostics"];
};

export type InitialScanExecutionOptions = {
  traceId?: string;
  scanMode?: ScanMode;
  idempotencyKey?: string;
  jobRunId?: string;
  triggerRunId?: string;
  sourceExecutor?: (input: SourceExecutionInput) => Promise<SourceExecutionResult>;
  sourceBatchExecutor?: (inputs: SourceExecutionInput[]) => Promise<SourceExecutionBatchResult[]>;
  candidateExecutor?: (input: { product: ProductRow; profileId: string; normalizedSourceItemIds: string[]; conversationIds: string[]; traceId: string; maxLlmEvaluations: number }) => Promise<CandidateProcessingResult>;
  demandExecutor?: (input: { product: ProductRow; evaluationIds: string[]; signalIds: Array<string | null>; traceId: string }) => Promise<DemandRebuildResult>;
  actionsExecutor?: (input: { product: ProductRow; traceId: string }) => Promise<ActionGenerationForScanResult>;
  onProgress?: (progress: ScanProgress) => Promise<void>;
};

export async function getScanProduct(workspaceId: string, productId: string): Promise<ProductRow> {
  const { data, error } = await createSupabaseServiceClient().from("products").select("*").eq("workspace_id", workspaceId).eq("id", productId).maybeSingle();
  if (error) throw new AppError("INTERNAL_ERROR", "The scan product could not be loaded.");
  if (!data) throw new AppError("NOT_FOUND", "The scan product was not found.");
  if (!isActiveProduct(data)) throw new AppError("CONFLICT", "Archived products cannot be scanned.");
  return data;
}

function publicFailure(error: unknown): string {
  const appError = toPublicError(error);
  return appError.code === "INTERNAL_ERROR" ? "The first scan could not be completed. Please try again." : appError.message;
}

function sourceConfigurationStatus(sourceKey: string, configuredReddit: ReturnType<typeof getRedditRuntimeConfig>, configuredX: ReturnType<typeof getXRuntimeConfig>): { configured: boolean; message: string } {
  if (sourceKey === "reddit") return configuredReddit.clientId && configuredReddit.clientSecret && configuredReddit.userAgent
    ? { configured: true, message: "" }
    : { configured: false, message: "Reddit credentials are not configured." };
  if (sourceKey === "x") return configuredX.token
    ? { configured: true, message: "" }
    : { configured: false, message: "X API bearer token is not configured." };
  const runtime = getSourceRuntimeConfiguration(sourceKey);
  return { configured: runtime.configured, message: runtime.configured ? "" : `${sourceKey} is not configured (${runtime.reason}).` };
}

function isSilentOptionalSource(sourceKey: string): boolean {
  return ["trustpilot", "youtube", "gitlab"].includes(sourceKey);
}

function safeSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : "Provider request failed.";
  return message.replace(/(authorization|bearer|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 240);
}

function jsonStrings(value: Json): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isCycleScanMode(mode: ScanMode): boolean { return mode === "scheduled" || mode === "monitoring" || mode === "intelligence_cycle"; }
function isDeepScanMode(mode: ScanMode): boolean { return mode === "manual_deep" || mode === "deep" || mode === "deep_refresh"; }
function isMonitoringScanMode(mode: ScanMode): boolean { return mode === "monitoring"; }

function boundMonitoringRequests(
  requests: SourceDiscoveryRequest[],
  sourceKey: string,
  scanMode: ScanMode,
  policy: MonitoringPolicy | null,
  capabilities: PlanCapabilities,
): SourceDiscoveryRequest[] {
  const profile = scanProfileForMode(scanMode);
  const providerKey = sourceKeyForProviderBudget(sourceKey);
  const providerBudget = providerKey ? getProviderBudget(capabilities, providerKey, profile) : null;
  const scanBudget = getScanBudget(capabilities, profile);
  const deep = isDeepScanMode(scanMode);
  const policyMaxRequests = policy && (isCycleScanMode(scanMode) || isDeepScanMode(scanMode))
    ? sourceKey === "x"
      ? (deep ? policy.xMaxRequestsPerDeepRefresh : policy.xMaxRequestsPerCycle)
      : Math.max(1, Math.ceil((deep ? policy.deepRefreshQueryBudget : policy.intelligenceCycleQueryBudget) / Math.max(1, deep ? policy.deepRefreshMaxSources : policy.intelligenceCycleMaxSources)))
    : Number.MAX_SAFE_INTEGER;
  const policyMaxCandidates = policy && (isCycleScanMode(scanMode) || isDeepScanMode(scanMode))
    ? sourceKey === "x"
      ? (deep ? policy.xMaxBillablePostsPerDeepRefresh : policy.xMaxBillablePostsPerCycle)
      : Math.max(1, Math.ceil((deep ? policy.deepRefreshCandidateBudget : policy.intelligenceCycleCandidateBudget) / Math.max(1, deep ? policy.deepRefreshMaxSources : policy.intelligenceCycleMaxSources)))
    : Number.MAX_SAFE_INTEGER;
  const maxRequests = Math.min(
    requests.length,
    policyMaxRequests,
    providerBudget ? (isCycleScanMode(scanMode) ? providerBudget.maxQueriesPerCycle : providerBudget.maxQueriesPerScan) : scanBudget.maxQueriesPerScan,
  );
  const maxCandidates = Math.min(
    providerBudget?.maxCandidatesPerCycle ?? scanBudget.maxCandidatesPerScan,
    policyMaxCandidates,
  );
  const maxCandidatesPerRequest = providerBudget?.maxCandidatesPerQuery ?? maxCandidates;
  let remaining = maxCandidates;
  return requests.slice(0, Math.max(0, maxRequests)).flatMap((request) => {
    const limit = Math.min(request.limit, remaining, maxCandidatesPerRequest);
    remaining -= limit;
    if (limit < 1) return [];
    const requestMetadata = {
      ...request.requestMetadata,
      ...(providerBudget ? { maxPages: providerBudget.maxPagesPerQuery } : {}),
      ...(providerKey === "youtube" && providerBudget ? {
        maxVideos: providerBudget.maxVideosPerQuery ?? 3,
        maxCommentsPerVideo: Math.max(0, Math.floor((providerBudget.maxCommentsPerCycle ?? 15) / Math.max(1, providerBudget.maxVideosPerQuery ?? 3))),
        includeReplies: false,
      } : {}),
      ...(sourceKey === "x" ? { maxResults: limit, maxBillablePostsPerDiscovery: limit } : {}),
    };
    return [sourceDiscoveryRequestSchema.parse({ ...request, limit, requestMetadata })];
  });
}

function reviewExcerpt(conversation: ConversationRow | undefined, source: SourceItemRow | undefined, fallback: string): string {
  const value = source?.body || conversation?.body || source?.title || conversation?.title || fallback;
  return value.replace(/\s+/g, " ").trim().slice(0, 500) || "No readable excerpt was stored.";
}

function candidateReviewsFromRows(
  evaluations: Awaited<ReturnType<IntelligenceService["matchProduct"]>>[],
  conversations: ConversationRow[],
  sourceById: Map<string, SourceItemRow>,
): ScanCandidateReview[] {
  const conversationById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  return evaluations.map((evaluation) => {
    const qualification = qualificationFromEvidence(evaluation.evidence);
    if (!qualification || !["weak_candidate", "rejected"].includes(qualification.status)) return null;
    const conversation = conversationById.get(evaluation.conversation_id);
    const source = conversation ? sourceById.get(conversation.primary_source_item_id) : undefined;
    return scanCandidateReviewSchema.parse({
      evaluationId: evaluation.id,
      source: source?.source_key ?? "unknown",
      title: source?.title ?? conversation?.title ?? null,
      excerpt: reviewExcerpt(conversation, source, evaluation.rationale),
      canonicalUrl: source?.canonical_url ?? conversation?.canonical_url ?? null,
      status: qualification.status,
      scores: {
        relevance: qualification.dimensions.product_relevance,
        intent: qualification.dimensions.demand_intent,
        pain: qualification.dimensions.pain_clarity,
        specificity: qualification.dimensions.specificity,
        evidence: qualification.dimensions.evidence_quality,
        noise: qualification.dimensions.noise_risk,
      },
      reasonCodes: qualification.reason_codes,
    });
  }).filter((review): review is ScanCandidateReview => Boolean(review));
}

export function scanJobKey(workspaceId: string, productId: string): string {
  return initialScanIdempotencyKey(workspaceId, productId);
}

async function loadScanJob(client: Client, workspaceId: string, productId: string, idempotencyKey = scanJobKey(workspaceId, productId)) {
  const { data, error } = await client
    .from("job_runs")
    .select("*")
    .eq("job_type", PRODUCT_DEMAND_SCAN_JOB_TYPE)
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL_ERROR", "The first-scan status could not be loaded.");
  return data;
}

async function loadActiveScanJob(client: Client, workspaceId: string, productId: string) {
  const { data, error } = await client
    .from("job_runs")
    .select("*")
    .eq("job_type", PRODUCT_DEMAND_SCAN_JOB_TYPE)
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new AppError("INTERNAL_ERROR", "The active scan status could not be loaded.");
  const reconciled = await reconcileActiveProductDemandScanJobs(client, data ?? []);
  if (reconciled.some((result) => result.reason === "dispatch-link-uncertain")) return null;
  return reconciled.filter((result) => result.action !== "recovered").map((result) => result.job).find(isActiveProductDemandScanJob) ?? null;
}

async function loadLatestScanJob(client: Client, workspaceId: string, productId: string) {
  const { data, error } = await client
    .from("job_runs")
    .select("*")
    .eq("job_type", PRODUCT_DEMAND_SCAN_JOB_TYPE)
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL_ERROR", "The latest scan status could not be loaded.");
  return data;
}

export type ScanJobUpdate = { status?: string; phase: string; scanMode?: ScanMode; result?: InitialScanResult | null; errorCode?: string | null; errorMessage?: string | null; completed?: boolean; progress?: Partial<ScanProgress> };

export async function setScanJob(client: Client, id: string, input: ScanJobUpdate) {
  const reference = buildScanJobReference(input);
  const { error } = await client.from("job_runs").update({
    ...(input.status === undefined ? {} : { status: input.status }),
    input_reference: reference,
    error_code: input.errorCode ?? null,
    error_details: input.errorMessage ? { message: input.errorMessage } : null,
    completed_at: input.completed ? new Date().toISOString() : null,
    terminal_at: input.completed ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) throw new AppError("INTERNAL_ERROR", "The first-scan status could not be saved.");
}

async function createOrResumeScanJob(client: Client, workspaceId: string, productId: string, traceId: string, options: Pick<InitialScanExecutionOptions, "idempotencyKey" | "jobRunId" | "scanMode" | "triggerRunId"> = {}) {
  const idempotencyKey = options.idempotencyKey ?? scanJobKey(workspaceId, productId);
  const scanMode = options.scanMode ?? "onboarding";
  const existing = options.jobRunId
    ? (await client.from("job_runs").select("*").eq("id", options.jobRunId).maybeSingle()).data
    : await loadScanJob(client, workspaceId, productId, idempotencyKey);
  if (existing && (existing.workspace_id !== workspaceId || existing.product_id !== productId || existing.idempotency_key !== idempotencyKey)) {
    throw new AppError("FORBIDDEN", "The scan job does not belong to this product.");
  }
  if (existing?.status === "succeeded") return { job: existing, alreadyComplete: true };
  if (existing) {
    const { data, error } = await client.from("job_runs").update({ status: "running", attempt_count: existing.attempt_count + 1, started_at: new Date().toISOString(), completed_at: null, terminal_at: null, error_code: null, error_details: null }).eq("id", existing.id).select("*").single();
    if (error || !data) throw new AppError("INTERNAL_ERROR", "The first scan could not be started.");
    await setScanJob(client, data.id, { status: "running", phase: "preparing", scanMode, progress: { stage: "preparing_product", percent: 5, currentLabel: "Understanding your product" } });
    return { job: data, alreadyComplete: false };
  }
  const { data, error } = await client.from("job_runs").insert({
    job_type: PRODUCT_DEMAND_SCAN_JOB_TYPE,
    workspace_id: workspaceId,
    product_id: productId,
    idempotency_key: idempotencyKey,
    input_reference: jsonObjectSchema.parse({ workflow: "product-demand-scan", phase: "preparing", scanMode: options.scanMode ?? "onboarding", result: null, progress: { stage: "preparing_product", percent: 5, completedSources: 0, totalSources: 0, currentLabel: "Understanding your product", warnings: [] } }),
    status: "pending",
    attempt_count: 1,
    started_at: null,
    trace_id: traceId,
    trigger_run_id: options.triggerRunId ?? null,
  }).select("*").single();
  if (error || !data) throw new AppError("INTERNAL_ERROR", "The first scan could not be started.");
  await setScanJob(client, data.id, { status: "running", phase: "preparing", scanMode, progress: { stage: "preparing_product", percent: 5, currentLabel: "Understanding your product" } });
  return { job: data, alreadyComplete: false };
}

async function loadRows(client: Client, sourceItemIds: string[], conversationIds: string[]) {
  const sourceItemsResult = sourceItemIds.length
    ? await client.from("source_items").select("*").in("id", sourceItemIds)
    : { data: [], error: null };
  if (sourceItemsResult.error) throw new AppError("INTERNAL_ERROR", "Normalized source evidence could not be loaded.");
  const conversationsResult = conversationIds.length
    ? await client.from("conversations").select("*").in("id", conversationIds)
    : { data: [], error: null };
  if (conversationsResult.error) throw new AppError("INTERNAL_ERROR", "Canonical conversations could not be loaded.");
  const conversations = (conversationsResult.data ?? []) as ConversationRow[];
  const primaryIds = [...new Set(conversations.map((conversation) => conversation.primary_source_item_id))];
  const missingPrimaryIds = primaryIds.filter((id) => !sourceItemIds.includes(id));
  const primaryResult = missingPrimaryIds.length
    ? await client.from("source_items").select("*").in("id", missingPrimaryIds)
    : { data: [], error: null };
  if (primaryResult.error) throw new AppError("INTERNAL_ERROR", "Primary source evidence could not be loaded.");
  return {
    sourceItems: [...(sourceItemsResult.data ?? []), ...(primaryResult.data ?? [])] as SourceItemRow[],
    conversations,
  };
}

/**
 * Executes only provider discovery plus the existing raw -> normalized -> canonical replay.
 * Trigger child tasks call this function; it deliberately contains no Trigger.dev dependency.
 */
export async function executeSourceDiscovery(input: SourceExecutionInput): Promise<SourceExecutionResult> {
  const client = createSupabaseServiceClient();
  const ingestionRepository = new SupabaseIngestionRepository(client);
  const ingestion = new IngestionService(ingestionRepository, undefined, new SourceControlService(new SupabaseSourceControlStore(client)));
  const rawSourceItemIds: string[] = [];
  const normalizedSourceItemIds: string[] = [];
  const conversationIds: string[] = [];
  const diagnostics: string[] = [];
  const resolutions: NonNullable<SourceExecutionResult["resolutions"]> = [];
  let rawInserted = 0;
  let rateLimitRemaining: number | null = null;
  let estimatedCost: number | null = null;
  const providerMetrics: Record<string, unknown> = {};
  for (const rawRequest of input.requests) {
    const request = sourceDiscoveryRequestSchema.parse(rawRequest);
    const discovery = await ingestion.discoverSource(input.sourceKey, requestScopedToScan(request, input.jobRunId), input.traceId);
    rawSourceItemIds.push(...discovery.rawSourceItemIds);
    rawInserted += discovery.rawInserted;
    diagnostics.push(...discovery.diagnostics);
    if (discovery.resolutions) resolutions.push(...discovery.resolutions);
    const replay = await ingestion.replayDetailed({ rawSourceItemIds: discovery.rawSourceItemIds, normalizationVersion: `${input.sourceKey}-v1`, canonicalizationVersion: "canonical-v1", limit: 100 });
    normalizedSourceItemIds.push(...replay.normalizedSourceItemIds);
    conversationIds.push(...replay.canonicalizedConversationIds);
    const metadata = request.requestMetadata;
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      if (typeof metadata.estimatedCost === "number") estimatedCost = (estimatedCost ?? 0) + metadata.estimatedCost;
      if (typeof metadata.rateLimitRemaining === "number") rateLimitRemaining = metadata.rateLimitRemaining;
    }
    if (typeof discovery.estimatedCost === "number") estimatedCost = (estimatedCost ?? 0) + discovery.estimatedCost;
    if (typeof discovery.rateLimit?.remaining === "number") rateLimitRemaining = discovery.rateLimit.remaining;
    if (discovery.providerMetrics) {
      for (const [key, value] of Object.entries(discovery.providerMetrics)) {
        if (typeof value === "number" && typeof providerMetrics[key] === "number") providerMetrics[key] = (providerMetrics[key] as number) + value;
        else providerMetrics[key] = value;
      }
    }
  }
  if (input.sourceKey === "g2") {
    const context = g2ContextFromRequests(input.requests);
    if (context) await persistG2Resolutions(client, context, resolutions);
  }
  return {
    sourceKey: input.sourceKey,
    rawSourceItemIds: [...new Set(rawSourceItemIds)],
    normalizedSourceItemIds: [...new Set(normalizedSourceItemIds)],
    conversationIds: [...new Set(conversationIds)],
    rawInserted,
    itemsReturned: rawSourceItemIds.length,
    queryCount: input.requests.length,
    diagnostics,
    rateLimitRemaining,
    estimatedCost,
    ...(Object.keys(providerMetrics).length ? { providerMetrics } : {}),
    ...(resolutions.length ? { resolutions } : {}),
  };
}

export async function processScanCandidates(input: { product: ProductRow; profileId: string; normalizedSourceItemIds: string[]; conversationIds: string[]; traceId: string; maxLlmEvaluations?: number }): Promise<CandidateProcessingResult> {
  const client = createSupabaseServiceClient();
  const rows = await loadRows(client, [...new Set(input.normalizedSourceItemIds)], [...new Set(input.conversationIds)]);
  const sourceById = new Map(rows.sourceItems.map((item) => [item.id, item]));
  const repository = new SupabaseIntelligenceRepository(client);
  const intelligence = new IntelligenceService(repository);
  const classifier = new FixtureConversationAnalysisEngine();
  const matcher = new FixtureProductMatchingEngine();
  const classifierVersion = await ensureEngineVersion(client, { engine_type: "classifier", version: classifier.version, model: "deterministic", prompt_version: classifier.version, config_hash: null, metadata: { workflow: "product-demand-scan", traceId: input.traceId } });
  const matcherVersion = await ensureEngineVersion(client, { engine_type: "matcher", version: matcher.version, model: "deterministic", prompt_version: matcher.version, config_hash: null, metadata: { workflow: "product-demand-scan", traceId: input.traceId } });
  const rankerVersion = await ensureEngineVersion(client, { engine_type: "ranker", version: "ranking-v1", model: "deterministic", prompt_version: "ranking-v1", config_hash: null, metadata: { workflow: "product-demand-scan", traceId: input.traceId } });
  const diagnostics: InitialScanResult["diagnostics"] = [];
  const analyses: Awaited<ReturnType<IntelligenceService["analyzeConversation"]>>[] = [];
  for (const conversation of rows.conversations.slice(0, Math.max(0, input.maxLlmEvaluations ?? rows.conversations.length))) {
    const sourceItem = sourceById.get(conversation.primary_source_item_id);
    if (!sourceItem) continue;
    try {
      analyses.push(await intelligence.analyzeConversation(conversation, sourceItem, classifierVersion.id, classifier));
    } catch (error) {
      diagnostics.push({ sourceKey: sourceItem.source_key, state: "failed", message: `Analysis skipped: ${safeSummary(error)}` });
    }
  }
  const evaluations: Awaited<ReturnType<IntelligenceService["matchProduct"]>>[] = [];
  for (const analysis of analyses.slice(0, Math.max(0, input.maxLlmEvaluations ?? analyses.length))) {
    try {
      evaluations.push(await intelligence.matchProduct(input.product, input.profileId, analysis.id, matcherVersion.id, matcher));
    } catch (error) {
      diagnostics.push({ sourceKey: "matching", state: "failed", message: safeSummary(error) });
    }
  }
  const rankings: NonNullable<Awaited<ReturnType<IntelligenceService["rankEvaluation"]>>>[] = [];
  const signals: Awaited<ReturnType<IntelligenceService["materializeSignal"]>>[] = [];
  const signalIdsByEvaluation: Array<string | null> = [];
  for (const evaluation of evaluations) {
    try {
      const ranking = await intelligence.rankEvaluation(input.product, evaluation.id, rankerVersion.id);
      if (!ranking) {
        signalIdsByEvaluation.push(null);
        diagnostics.push({ sourceKey: "signals", state: "filtered", message: "Candidate did not pass Signal Qualification." });
        continue;
      }
      rankings.push(ranking);
      const signal = await intelligence.materializeSignal(input.product, evaluation.id, ranking.id);
      signalIdsByEvaluation.push(signal?.id ?? null);
      if (signal) signals.push(signal);
    } catch (error) {
      signalIdsByEvaluation.push(null);
      diagnostics.push({ sourceKey: "signals", state: "failed", message: safeSummary(error) });
    }
  }
  const qualificationRows = evaluations.map((evaluation) => qualificationFromEvidence(evaluation.evidence)).filter((value): value is NonNullable<typeof value> => Boolean(value));
  const rejectionReasonDistribution: Record<string, number> = {};
  const intentDistribution: Record<string, number> = {};
  for (const qualification of qualificationRows) {
    for (const code of qualification.reason_codes) rejectionReasonDistribution[code] = (rejectionReasonDistribution[code] ?? 0) + 1;
    intentDistribution[qualification.primary_intent] = (intentDistribution[qualification.primary_intent] ?? 0) + 1;
  }
  return {
    conversationCount: rows.conversations.length,
    analyses: analyses.length,
    evaluations: evaluations.length,
    rankings: rankings.length,
    signals: signals.length,
    evaluationIds: evaluations.map((evaluation) => evaluation.id),
    signalIds: signalIdsByEvaluation,
    candidateReviews: candidateReviewsFromRows(evaluations, rows.conversations, sourceById),
    diagnostics,
    ...(qualificationRows.length ? {
      qualification: {
        version: qualificationRows[0].version,
        thresholdVersion: qualificationRows[0].diagnostics.threshold_version,
        candidateCount: qualificationRows.length,
        qualifiedCount: qualificationRows.filter((item) => item.status === "qualified").length,
        highConfidenceCount: qualificationRows.filter((item) => item.status === "high_confidence_signal").length,
        weakCount: qualificationRows.filter((item) => item.status === "weak_candidate").length,
        rejectedCount: qualificationRows.filter((item) => item.status === "rejected").length,
        rejectionReasonDistribution,
        intentDistribution,
        averageDemandQuality: qualificationRows.reduce((sum, item) => sum + item.demand_quality_score, 0) / qualificationRows.length,
        averageConfidence: qualificationRows.reduce((sum, item) => sum + item.confidence, 0) / qualificationRows.length,
      },
    } : {}),
  };
}

function parseScanJobState(job: NonNullable<Awaited<ReturnType<typeof loadScanJob>>>): InitialScanJobState {
  const reference = job.input_reference && typeof job.input_reference === "object" && !Array.isArray(job.input_reference) ? job.input_reference : {};
  const resultValue = "result" in reference && reference.result && typeof reference.result === "object" ? scanResultSchema.safeParse(reference.result) : null;
  const progressValue = "progress" in reference ? z.object({ stage: z.string(), percent: z.number(), completedSources: z.number(), totalSources: z.number(), currentLabel: z.string(), warnings: z.array(z.string()) }).safeParse(reference.progress) : null;
  return {
    jobRunId: job.id,
    status: job.status,
    phase: typeof reference.phase === "string" ? reference.phase : "preparing",
    progress: progressValue?.success ? progressValue.data as ScanProgress : null,
    result: resultValue?.success ? resultValue.data : null,
    errorMessage: typeof reference.errorMessage === "string" ? reference.errorMessage : job.error_code ? "The first scan could not be completed. Please try again." : null,
    idempotencyKey: job.idempotency_key,
    completedAt: job.completed_at,
  };
}

export async function getInitialScanState(workspaceId: string, productId: string, idempotencyKey = scanJobKey(workspaceId, productId)): Promise<InitialScanJobState | null> {
  const client = createSupabaseServiceClient();
  const job = await loadScanJob(client, workspaceId, productId, idempotencyKey);
  if (!job) return null;
  const reconciled = await reconcileProductDemandScanJob(client, job);
  if (reconciled.reason === "dispatch-link-uncertain") {
    return {
      ...parseScanJobState(reconciled.job),
      status: "failed",
      errorMessage: "The scan dispatch needs to be recovered. Retry to continue safely.",
    };
  }
  return parseScanJobState(reconciled.job);
}

/** Read-only dashboard view of the newest pending/running scan for this product. */
export async function getActiveScanState(workspaceId: string, productId: string): Promise<InitialScanJobState | null> {
  const job = await loadActiveScanJob(createSupabaseServiceClient(), workspaceId, productId);
  return job ? parseScanJobState(job) : null;
}

/** Reads the newest persisted scan so a completed manual rescan remains visible after its active poll ends. */
export async function getLatestScanState(workspaceId: string, productId: string): Promise<InitialScanJobState | null> {
  const job = await loadLatestScanJob(createSupabaseServiceClient(), workspaceId, productId);
  return job ? parseScanJobState(job) : null;
}

export async function runInitialScan(product: ProductRow, traceId = getTraceId(), options: InitialScanExecutionOptions = {}): Promise<InitialScanResult> {
  const client = createSupabaseServiceClient();
  const scanStartedAt = Date.now();
  const scanMode = options.scanMode ?? "onboarding";
  const capabilities = await resolveWorkspaceCapabilities(client, product.workspace_id);
  const scanProfile = scanProfileForMode(scanMode);
  const scanBudget = getScanBudget(capabilities, scanProfile);
  if (!scanBudget.enabled) throw new AppError("CAPABILITY_DISABLED", "This scan profile is not enabled for the workspace plan.");
  const { job, alreadyComplete } = await createOrResumeScanJob(client, product.workspace_id, product.id, traceId, {
    idempotencyKey: options.idempotencyKey,
    jobRunId: options.jobRunId,
    scanMode,
    triggerRunId: options.triggerRunId,
  });
  if (alreadyComplete) {
    const state = await getInitialScanState(product.workspace_id, product.id, options.idempotencyKey ?? scanJobKey(product.workspace_id, product.id));
    if (state?.result) return state.result;
  }

  const ingestionRepository = new SupabaseIngestionRepository(client);
  const ingestion = new IngestionService(ingestionRepository, undefined, new SourceControlService(new SupabaseSourceControlStore(client)));
  const controls = new SourceControlService(new SupabaseSourceControlStore(client));
  const registry = createSourceRegistry();
  const configuredReddit = getRedditRuntimeConfig();
  const configuredX = getXRuntimeConfig();
  const intelligenceRepository = new SupabaseIntelligenceRepository(client);
  const profile = product.current_demand_profile_id ? await intelligenceRepository.getDemandProfileById(product.current_demand_profile_id) : null;
  if (!profile) {
    const message = "A demand profile is required before the first scan.";
    await setScanJob(client, job.id, { status: "failed", phase: "failed", scanMode, errorCode: "VALIDATION_ERROR", errorMessage: message, completed: true });
    throw new AppError("VALIDATION_ERROR", message);
  }
  const queryTerms = jsonStrings(profile.include_terms);
  const sourceKeys = [...registry.keys()].filter((key) => key !== "fixture");
  const environment = process.env.NODE_ENV === "production" ? "production" : process.env.NODE_ENV === "test" ? "test" : "development";
  const snapshots = await intelligenceRepository.getProductSnapshots(product.id);
  const latestSnapshot = [...snapshots].reverse()[0] ?? null;
  const classification = latestSnapshot ? readBusinessClassification(latestSnapshot) : null;
  const demandProfileV2 = latestSnapshot ? readDemandProfileV2(latestSnapshot) : null;
  const monitoringPolicy = isCycleScanMode(scanMode) || isDeepScanMode(scanMode)
    ? await resolveMonitoringPolicy(client, product.workspace_id)
    : null;
  const providerSafetyCaps = Object.fromEntries(
    sourceKeys.flatMap((sourceKey) => {
      const providerKey = sourceKeyForProviderBudget(sourceKey);
      if (!providerKey) return [];
      const providerBudget = getProviderBudget(capabilities, providerKey, scanProfile);
      return [[sourceKey, { maxCandidates: providerBudget.maxCandidatesPerCycle, maxPages: providerBudget.maxPagesPerQuery }]];
    }),
  );
  const sourceStates = await Promise.all(sourceKeys.map(async (sourceKey) => {
    const control = await controls.get(sourceKey);
    const health = await ingestionRepository.getSourceHealth(sourceKey, environment).catch(() => null);
    const configuration = sourceConfigurationStatus(sourceKey, configuredReddit, configuredX);
    const configured = configuration.configured;
    const healthStatus: SourceRoutingHealthStatus = !configured && isSilentOptionalSource(sourceKey)
      ? "unknown"
      : health?.degradation_state === "healthy" || health?.degradation_state === "degraded" || health?.degradation_state === "blocked" ? health.degradation_state : "unknown";
    const retryWindowOpen = Boolean(control.next_retry_at && control.next_retry_at > new Date().toISOString());
    return { sourceKey, configured, controlState: retryWindowOpen && control.state === "enabled" ? "paused" : control.state, healthStatus, reason: configured ? control.reason : configuration.message };
  }));
  const routingPlan: SourceRoutingPlan | null = demandProfileV2
    ? buildSourceRoutingPlan({
        productId: product.id,
        classification,
        demandProfile: readDemandProfileV2RoutingModel(demandProfileV2),
        sourceStates,
        scanMode,
        totalCandidateBudget: scanBudget.maxCandidatesPerScan,
        maxSources: scanBudget.maxSourcesPerScan,
        rotationSeed: options.idempotencyKey ?? job.id,
        safetyCaps: {
          ...providerSafetyCaps,
          x: { maxCandidates: Math.min(providerSafetyCaps.x?.maxCandidates ?? 10, configuredX.maxPostsPerScan), maxPages: 1 },
        },
      })
    : null;
  const selectedRoutes = routingPlan ? selectExecutableSourceRoutes(routingPlan) : [];
  const routedSourceKeys = selectedRoutes.map((route) => route.source_key);
  const routeBySource = new Map(selectedRoutes.map((route) => [route.source_key, route]));
  const sources: string[] = [];
  const sourceResults: SourceScanResult[] = [];
  const diagnostics: InitialScanResult["diagnostics"] = [];
  diagnostics.push({
    sourceKey: "plan-budget",
    state: "resolved",
    message: capabilities.plan + "/" + scanProfile + ": " + scanBudget.maxSourcesPerScan + " sources, " + scanBudget.maxQueriesPerScan + " queries, " + scanBudget.maxCandidatesPerScan + " candidates, " + scanBudget.maxLlmEvaluationsPerScan + " LLM evaluations.",
  });
  let queryPlan: QueryPlan | null = null;
  if (routingPlan) {
    diagnostics.push({ sourceKey: "source-routing", state: "planned", message: `${routingPlan.coverage_status} coverage (${routingPlan.overall_coverage_confidence}); selected ${routingPlan.diagnostics.selected_sources.join(", ") || "none"}.` });
    try {
      queryPlan = buildQueryPlan({
        classification,
        demandProfile: demandProfileV2 ? readDemandProfileV2RoutingModel(demandProfileV2) : null,
        sourceRoutingPlan: routingPlan,
        scanMode,
        maxQueries: scanBudget.maxQueriesPerScan,
      });
      diagnostics.push({ sourceKey: "query-planning", state: "planned", message: `${queryPlan.diagnostics.query_count} semantic quer${queryPlan.diagnostics.query_count === 1 ? "y" : "ies"} across ${queryPlan.diagnostics.source_count} source${queryPlan.diagnostics.source_count === 1 ? "" : "s"}.` });
    } catch (error) {
      diagnostics.push({ sourceKey: "query-planning", state: "fallback", message: safeSummary(error) });
    }
  } else {
    diagnostics.push({ sourceKey: "source-routing", state: "fallback", message: "Demand Profile v2 is unavailable; using the existing configured-source selection." });
  }
  const rawSourceItemIds: string[] = [];
  const normalizedSourceItemIds: string[] = [];
  const conversationIds: string[] = [];
  const queryPlanBySource = new Map((queryPlan?.source_plans ?? []).map((source) => [source.source_key, source]));
  const g2ProductMappings = sourceKeys.includes("g2") ? await loadG2ProductMappings(client, product) : {};

  try {
    await setScanJob(client, job.id, { status: "running", phase: "planning", scanMode, progress: { stage: "planning", percent: 25, currentLabel: "Choosing the best sources" } });
    await setScanJob(client, job.id, { status: "running", phase: "discovering", scanMode, progress: { stage: "discovering", percent: 40, currentLabel: "Finding conversations" } });
    const plannedSourceKeys = routingPlan ? routedSourceKeys : sourceKeys;
    const sourceExecutor = options.sourceExecutor;
    const sourceBatchExecutor = options.sourceBatchExecutor;
    if (sourceBatchExecutor || sourceExecutor) {
      const sourceInputs: Array<{ input: SourceExecutionInput; fallback: boolean; candidateBudget: number }> = [];
      for (const sourceKey of plannedSourceKeys) {
        const control = await controls.get(sourceKey);
        if (control.state !== "enabled") {
          sourceResults.push({ sourceKey, planned: true, executed: false, status: "skipped", queryCount: 0, candidateBudget: 0, itemsReturned: 0, rawItems: 0, normalizedItems: 0, warnings: [`Source is ${control.state}.`], errorCode: null, rateLimitRemaining: null, estimatedCost: null });
          diagnostics.push({ sourceKey, state: "skipped", message: `Source is ${control.state}.` });
          continue;
        }
        const configuration = sourceConfigurationStatus(sourceKey, configuredReddit, configuredX);
        if (!configuration.configured) {
          sourceResults.push({ sourceKey, planned: true, executed: false, status: "skipped", queryCount: 0, candidateBudget: 0, itemsReturned: 0, rawItems: 0, normalizedItems: 0, warnings: isSilentOptionalSource(sourceKey) ? [] : [configuration.message], errorCode: isSilentOptionalSource(sourceKey) ? null : "CONFIGURATION_MISSING", rateLimitRemaining: null, estimatedCost: null });
          if (!isSilentOptionalSource(sourceKey)) diagnostics.push({ sourceKey, state: "skipped", message: configuration.message });
          continue;
        }
        const route = routeBySource.get(sourceKey);
        const query = sourceKey === "bluesky" || sourceKey === "reddit" || sourceKey === "x" ? [product.name, ...queryTerms.slice(0, 5)].join(" ").slice(0, 180) : undefined;
        const sourcePlan = queryPlanBySource.get(sourceKey);
        const plannedRequests = sourcePlan?.queries.length && route ? sourcePlan.queries.map((plannedQuery) => toSourceDiscoveryRequest({ sourcePlan, query: plannedQuery, maxPages: route.max_pages })) : [];
        const fallbackLimit = Math.min(route?.max_candidates ?? 5, sourceKey === "x" ? configuredX.maxPostsPerScan : 100);
        const fallbackRequest = sourceKey === "x"
          ? { limit: fallbackLimit, query, requestMetadata: { maxResults: fallbackLimit, maxPages: route?.max_pages ?? 1, maxBillablePostsPerDiscovery: fallbackLimit } }
          : { limit: fallbackLimit, ...(query ? { query } : {}) };
        const requests = boundMonitoringRequests((plannedRequests.length ? plannedRequests : [fallbackRequest]).map((request) => sourceDiscoveryRequestSchema.parse(request)), sourceKey, scanMode, monitoringPolicy, capabilities)
          .map((request) => sourceKey === "g2" ? g2RequestForProduct(request, product, g2ProductMappings) : request);
        sourceInputs.push({ input: { sourceKey, requests, traceId, jobRunId: job.id }, fallback: !plannedRequests.length && Boolean(queryPlan), candidateBudget: requests.reduce((sum, request) => sum + request.limit, 0) });
        sources.push(sourceKey);
      }
      const results = sourceBatchExecutor
        ? await sourceBatchExecutor(sourceInputs.map(({ input }) => input))
        : await Promise.all(sourceInputs.map(async ({ input, fallback }) => {
            try {
              return { sourceKey: input.sourceKey, execution: await sourceExecutor!(input), fallback };
            } catch (error) {
              return { sourceKey: input.sourceKey, error: safeSummary(error), fallback };
            }
          }));
      for (const result of results) {
        const sourceInput = sourceInputs.find(({ input }) => input.sourceKey === result.sourceKey);
        if (result.error || !result.execution) {
          sourceResults.push({ sourceKey: result.sourceKey, planned: true, executed: true, status: "failed", queryCount: sourceInput?.input.requests.length ?? 0, candidateBudget: sourceInput?.candidateBudget ?? 0, itemsReturned: 0, rawItems: 0, normalizedItems: 0, warnings: [result.error ?? "Source task returned no result."], errorCode: null, rateLimitRemaining: null, estimatedCost: null });
          diagnostics.push({ sourceKey: result.sourceKey, state: "failed", message: result.error ?? "Source task returned no result." });
          continue;
        }
        sourceResults.push({ sourceKey: result.sourceKey, planned: true, executed: true, status: "completed", queryCount: sourceInput?.input.requests.length ?? 0, candidateBudget: sourceInput?.candidateBudget ?? 0, itemsReturned: result.execution.itemsReturned, rawItems: result.execution.rawInserted, normalizedItems: result.execution.normalizedSourceItemIds.length, warnings: result.execution.diagnostics, errorCode: null, rateLimitRemaining: result.execution.rateLimitRemaining, estimatedCost: result.execution.estimatedCost, ...(result.execution.providerMetrics ? { providerMetrics: result.execution.providerMetrics } : {}), ...(result.execution.resolutions?.length ? { resolutions: result.execution.resolutions } : {}) });
        rawSourceItemIds.push(...result.execution.rawSourceItemIds);
        normalizedSourceItemIds.push(...result.execution.normalizedSourceItemIds);
        conversationIds.push(...result.execution.conversationIds);
        if (result.fallback) diagnostics.push({ sourceKey: result.sourceKey, state: "fallback", message: "Query Planning produced no executable query; using the existing conservative request." });
        diagnostics.push({ sourceKey: result.sourceKey, state: "complete", message: `${result.execution.rawInserted} new raw item${result.execution.rawInserted === 1 ? "" : "s"}.` });
      }
      await setScanJob(client, job.id, { status: "running", phase: "discovering", scanMode, progress: { stage: "discovering", percent: 55, completedSources: results.length, totalSources: plannedSourceKeys.length, currentLabel: "Finding conversations" } });
    } else {
    for (const sourceKey of plannedSourceKeys) {
      const control = await controls.get(sourceKey);
      if (control.state !== "enabled") {
        sourceResults.push({ sourceKey, planned: true, executed: false, status: "skipped", queryCount: 0, candidateBudget: 0, itemsReturned: 0, rawItems: 0, normalizedItems: 0, warnings: [`Source is ${control.state}.`], errorCode: null, rateLimitRemaining: null, estimatedCost: null });
        diagnostics.push({ sourceKey, state: "skipped", message: `Source is ${control.state}.` });
        continue;
      }
      const configuration = sourceConfigurationStatus(sourceKey, configuredReddit, configuredX);
      if (!configuration.configured) {
        sourceResults.push({ sourceKey, planned: true, executed: false, status: "skipped", queryCount: 0, candidateBudget: 0, itemsReturned: 0, rawItems: 0, normalizedItems: 0, warnings: isSilentOptionalSource(sourceKey) ? [] : [configuration.message], errorCode: isSilentOptionalSource(sourceKey) ? null : "CONFIGURATION_MISSING", rateLimitRemaining: null, estimatedCost: null });
        if (!isSilentOptionalSource(sourceKey)) diagnostics.push({ sourceKey, state: "skipped", message: configuration.message });
        continue;
      }
      sources.push(sourceKey);
      let requests: SourceDiscoveryRequest[] = [];
      try {
        const route = routeBySource.get(sourceKey);
        const query = sourceKey === "bluesky" || sourceKey === "reddit" || sourceKey === "x"
          ? [product.name, ...queryTerms.slice(0, 5)].join(" ").slice(0, 180)
          : undefined;
        const sourcePlan = queryPlanBySource.get(sourceKey);
        const plannedRequests = sourcePlan?.queries.length && route
          ? sourcePlan.queries.map((plannedQuery) => toSourceDiscoveryRequest({ sourcePlan, query: plannedQuery, maxPages: route.max_pages }))
          : [];
        const fallbackLimit = Math.min(route?.max_candidates ?? 5, sourceKey === "x" ? configuredX.maxPostsPerScan : 100);
        const fallbackRequest = sourceKey === "x"
          ? {
              limit: fallbackLimit,
              query,
              requestMetadata: {
                maxResults: fallbackLimit,
                maxPages: route?.max_pages ?? 1,
                maxBillablePostsPerDiscovery: fallbackLimit,
              },
            }
          : { limit: fallbackLimit, ...(query ? { query } : {}) };
        requests = boundMonitoringRequests((plannedRequests.length ? plannedRequests : [fallbackRequest]).map((request) => sourceDiscoveryRequestSchema.parse(request)), sourceKey, scanMode, monitoringPolicy, capabilities)
          .map((request) => sourceKey === "g2" ? g2RequestForProduct(request, product, g2ProductMappings) : request);
        let sourceItemsReturned = 0;
        let sourceRawItems = 0;
        let sourceNormalizedItems = 0;
        let sourceWarnings: string[] = [];
        const sourceMetrics: Record<string, unknown> = {};
        const sourceResolutions: NonNullable<SourceExecutionResult["resolutions"]> = [];
        if (!plannedRequests.length && queryPlan) diagnostics.push({ sourceKey, state: "fallback", message: "Query Planning produced no executable query; using the existing conservative request." });
        for (const discoveryRequest of requests) {
          const discovery = await ingestion.discoverSource(sourceKey, requestScopedToScan(discoveryRequest, job.id));
          sourceItemsReturned += discovery.rawSourceItemIds.length;
          sourceRawItems += discovery.rawInserted;
          sourceWarnings = [...sourceWarnings, ...discovery.diagnostics];
          if (discovery.resolutions) sourceResolutions.push(...discovery.resolutions);
          if (discovery.providerMetrics) {
            for (const [key, value] of Object.entries(discovery.providerMetrics)) {
              if (typeof value === "number" && typeof sourceMetrics[key] === "number") sourceMetrics[key] = (sourceMetrics[key] as number) + value;
              else sourceMetrics[key] = value;
            }
          }
          rawSourceItemIds.push(...discovery.rawSourceItemIds);
          const replay = await ingestion.replayDetailed({ rawSourceItemIds: discovery.rawSourceItemIds, normalizationVersion: `${sourceKey}-v1`, canonicalizationVersion: "canonical-v1", limit: 100 });
          sourceNormalizedItems += replay.normalizedSourceItemIds.length;
          normalizedSourceItemIds.push(...replay.normalizedSourceItemIds);
          conversationIds.push(...replay.canonicalizedConversationIds);
          const requestMetadata = discoveryRequest.requestMetadata;
          const semanticQuery = requestMetadata && typeof requestMetadata === "object" && !Array.isArray(requestMetadata) && "semanticQuery" in requestMetadata && typeof requestMetadata.semanticQuery === "string" ? requestMetadata.semanticQuery : null;
          const queryLabel = semanticQuery ? ` for “${semanticQuery}”` : "";
          diagnostics.push({ sourceKey, state: "complete", message: `${discovery.rawInserted} new raw item${discovery.rawInserted === 1 ? "" : "s"}${queryLabel}.` });
        }
        if (sourceKey === "g2") await persistG2Resolutions(client, { workspaceId: product.workspace_id, productId: product.id }, sourceResolutions);
        sourceResults.push({ sourceKey, planned: true, executed: true, status: "completed", queryCount: requests.length, candidateBudget: requests.reduce((sum, request) => sum + request.limit, 0), itemsReturned: sourceItemsReturned, rawItems: sourceRawItems, normalizedItems: sourceNormalizedItems, warnings: sourceWarnings, errorCode: null, rateLimitRemaining: null, estimatedCost: null, ...(Object.keys(sourceMetrics).length ? { providerMetrics: sourceMetrics } : {}), ...(sourceResolutions.length ? { resolutions: sourceResolutions } : {}) });
      } catch (error) {
        sourceResults.push({ sourceKey, planned: true, executed: true, status: "failed", queryCount: requests?.length ?? 0, candidateBudget: requests?.reduce((sum, request) => sum + request.limit, 0) ?? 0, itemsReturned: 0, rawItems: 0, normalizedItems: 0, warnings: [safeSummary(error)], errorCode: null, rateLimitRemaining: null, estimatedCost: null });
        diagnostics.push({ sourceKey, state: "failed", message: safeSummary(error) });
      }
      await setScanJob(client, job.id, { status: "running", phase: "discovering", scanMode });
    }
    }
    if (!sources.length || !conversationIds.length) throw new AppError("CONFLICT", "No usable source results were available for the first scan.");

    await setScanJob(client, job.id, { status: "running", phase: "analyzing", scanMode, progress: { stage: "processing", percent: 65, currentLabel: "Processing conversations" } });
    let candidateResult: CandidateProcessingResult;
    const newSignalEvaluationIds: string[] = [];
    if (options.candidateExecutor) {
      candidateResult = await options.candidateExecutor({ product, profileId: profile.id, normalizedSourceItemIds: [...new Set(normalizedSourceItemIds)], conversationIds: [...new Set(conversationIds)], traceId, maxLlmEvaluations: scanBudget.maxLlmEvaluationsPerScan });
      diagnostics.push(...candidateResult.diagnostics);
    } else {
    const rows = await loadRows(client, [...new Set(normalizedSourceItemIds)], [...new Set(conversationIds)]);
    const sourceById = new Map(rows.sourceItems.map((item) => [item.id, item]));
    const intelligence = new IntelligenceService(intelligenceRepository);
    const classifier = new FixtureConversationAnalysisEngine();
    const matcher = new FixtureProductMatchingEngine();
    const classifierVersion = await ensureEngineVersion(client, { engine_type: "classifier", version: classifier.version, model: "deterministic", prompt_version: classifier.version, config_hash: null, metadata: { workflow: "initial-scan" } });
    const matcherVersion = await ensureEngineVersion(client, { engine_type: "matcher", version: matcher.version, model: "deterministic", prompt_version: matcher.version, config_hash: null, metadata: { workflow: "initial-scan" } });
    const rankerVersion = await ensureEngineVersion(client, { engine_type: "ranker", version: "ranking-v1", model: "deterministic", prompt_version: "ranking-v1", config_hash: null, metadata: { workflow: "initial-scan" } });
    const analyses = [];
    for (const conversation of rows.conversations.slice(0, scanBudget.maxLlmEvaluationsPerScan)) {
      const sourceItem = sourceById.get(conversation.primary_source_item_id);
      if (!sourceItem) continue;
      try {
        analyses.push(await intelligence.analyzeConversation(conversation, sourceItem, classifierVersion.id, classifier));
      } catch (error) {
        diagnostics.push({ sourceKey: sourceItem.source_key, state: "failed", message: `Analysis skipped: ${safeSummary(error)}` });
      }
    }
    if (!analyses.length) throw new AppError("CONFLICT", "No usable conversations were available for analysis.");

    await setScanJob(client, job.id, { status: "running", phase: "matching", scanMode });
    const evaluations = [];
    for (const analysis of analyses.slice(0, scanBudget.maxLlmEvaluationsPerScan)) {
      try {
        evaluations.push(await intelligence.matchProduct(product, profile.id, analysis.id, matcherVersion.id, matcher));
      } catch (error) {
        diagnostics.push({ sourceKey: "matching", state: "failed", message: safeSummary(error) });
      }
    }
    await setScanJob(client, job.id, { status: "running", phase: "ranking", scanMode });
    const rankings = [];
    const signals = [];
    const signalIdsByEvaluation: Array<string | null> = [];
    for (const evaluation of evaluations) {
      try {
        const ranking = await intelligence.rankEvaluation(product, evaluation.id, rankerVersion.id);
        if (!ranking) {
          signalIdsByEvaluation.push(null);
          diagnostics.push({ sourceKey: "signals", state: "filtered", message: "Candidate did not pass Signal Qualification." });
          continue;
        }
        rankings.push(ranking);
        const signal = await intelligence.materializeSignal(product, evaluation.id, ranking.id);
        signalIdsByEvaluation.push(signal?.id ?? null);
        if (signal) {
          signals.push(signal);
          if (Date.parse(signal.created_at) >= scanStartedAt) newSignalEvaluationIds.push(evaluation.id);
        }
      } catch (error) {
        signalIdsByEvaluation.push(null);
        diagnostics.push({ sourceKey: "signals", state: "failed", message: safeSummary(error) });
      }
    }

    const qualificationRows = evaluations.map((evaluation) => qualificationFromEvidence(evaluation.evidence)).filter((value): value is NonNullable<typeof value> => Boolean(value));
    const rejectionReasonDistribution: Record<string, number> = {};
    const intentDistribution: Record<string, number> = {};
    for (const qualification of qualificationRows) {
      for (const code of qualification.reason_codes) rejectionReasonDistribution[code] = (rejectionReasonDistribution[code] ?? 0) + 1;
      intentDistribution[qualification.primary_intent] = (intentDistribution[qualification.primary_intent] ?? 0) + 1;
    }
    candidateResult = {
      conversationCount: rows.conversations.length,
      analyses: analyses.length,
      evaluations: evaluations.length,
      rankings: rankings.length,
      signals: signals.length,
      newSignals: newSignalEvaluationIds.length,
      evaluationIds: evaluations.map((evaluation) => evaluation.id),
      signalIds: signalIdsByEvaluation,
      candidateReviews: candidateReviewsFromRows(evaluations, rows.conversations, sourceById),
      diagnostics: [],
      ...(qualificationRows.length ? { qualification: {
        version: qualificationRows[0].version,
        thresholdVersion: qualificationRows[0].diagnostics.threshold_version,
        candidateCount: qualificationRows.length,
        qualifiedCount: qualificationRows.filter((item) => item.status === "qualified").length,
        highConfidenceCount: qualificationRows.filter((item) => item.status === "high_confidence_signal").length,
        weakCount: qualificationRows.filter((item) => item.status === "weak_candidate").length,
        rejectedCount: qualificationRows.filter((item) => item.status === "rejected").length,
        rejectionReasonDistribution,
        intentDistribution,
        averageDemandQuality: qualificationRows.reduce((sum, item) => sum + item.demand_quality_score, 0) / qualificationRows.length,
        averageConfidence: qualificationRows.reduce((sum, item) => sum + item.confidence, 0) / qualificationRows.length,
      } } : {}),
    };
    }
    const newSignalCount = candidateResult.newSignals ?? (isMonitoringScanMode(scanMode) ? newSignalEvaluationIds.length : candidateResult.signals);
    const shouldRefreshDerived = shouldRefreshDerivedIntelligence(scanMode, newSignalCount);
    const derivedEvaluationIds = isMonitoringScanMode(scanMode) && newSignalEvaluationIds.length
      ? candidateResult.evaluationIds.filter((evaluationId) => newSignalEvaluationIds.includes(evaluationId))
      : candidateResult.evaluationIds;
    const derivedSignalIds = isMonitoringScanMode(scanMode) && newSignalEvaluationIds.length
      ? candidateResult.signalIds.filter((signalId, index) => signalId !== null && newSignalEvaluationIds.includes(candidateResult.evaluationIds[index] ?? ""))
      : candidateResult.signalIds;
    await setScanJob(client, job.id, { status: "running", phase: "qualifying", scanMode, progress: { stage: "qualifying", percent: 75, currentLabel: "Qualifying real demand" } });
    let demand: DemandRebuildResult = { observationsUpdated: 0, mapUpdated: 0, gapUpdated: 0, driftUpdated: 0, warnings: [] };
    if (shouldRefreshDerived) {
      try {
        await setScanJob(client, job.id, { status: "running", phase: "building-intelligence", scanMode, progress: { stage: "building_intelligence", percent: 82, currentLabel: "Building your demand map" } });
        demand = await (options.demandExecutor ?? rebuildDemandIntelligenceForScan)({ product, evaluationIds: derivedEvaluationIds, signalIds: derivedSignalIds, traceId });
        for (const warning of demand.warnings) diagnostics.push({ sourceKey: "demand-intelligence", state: "warning", message: warning });
      } catch (error) {
        demand = { ...demand, warnings: [safeSummary(error)] };
        diagnostics.push({ sourceKey: "demand-intelligence", state: "warning", message: demand.warnings[0] });
      }
    } else {
      diagnostics.push({ sourceKey: "demand-intelligence", state: "unchanged", message: "No new qualified signals; existing intelligence was left unchanged." });
    }
    let actions: ActionGenerationForScanResult = { actionsUpdated: 0, warnings: [] };
    if (shouldRefreshDerived) {
      try {
        await setScanJob(client, job.id, { status: "running", phase: "generating-actions", scanMode, progress: { stage: "generating_actions", percent: 92, currentLabel: "Preparing actions" } });
        actions = await (options.actionsExecutor ?? generateActionsForScan)({ product, traceId });
        for (const warning of actions.warnings) diagnostics.push({ sourceKey: "actions", state: "warning", message: warning });
      } catch (error) {
        actions = { actionsUpdated: 0, warnings: [safeSummary(error)] };
        diagnostics.push({ sourceKey: "actions", state: "warning", message: actions.warnings[0] });
      }
    } else {
      diagnostics.push({ sourceKey: "actions", state: "unchanged", message: "No new qualified signals; existing actions were left unchanged." });
    }
    const hasWarnings = diagnostics.some((item) => item.state === "failed" || item.state === "warning" || item.state === "skipped") || demand.warnings.length > 0 || actions.warnings.length > 0;
    const result: InitialScanResult = {
      state: hasWarnings ? "complete_with_warnings" : candidateResult.signals ? "complete" : "complete_no_signals",
      rawItems: rawSourceItemIds.length,
      normalizedItems: normalizedSourceItemIds.length,
      conversations: candidateResult.conversationCount,
      analyses: candidateResult.analyses,
      evaluations: candidateResult.evaluations,
      rankings: candidateResult.rankings,
      signals: candidateResult.signals,
      newSignals: newSignalCount,
      sources,
      sourceResults,
      diagnostics,
      mapUpdated: demand.mapUpdated,
      gapUpdated: demand.gapUpdated,
      driftUpdated: demand.driftUpdated,
      actionsUpdated: actions.actionsUpdated,
      candidateReviews: candidateResult.candidateReviews,
      ...(candidateResult.qualification ? { qualification: candidateResult.qualification } : {}),
      ...(routingPlan ? {
        routing: {
          version: routingPlan.version,
          coverageStatus: routingPlan.coverage_status,
          coverageConfidence: routingPlan.overall_coverage_confidence,
          selectedSources: routingPlan.diagnostics.selected_sources,
          excludedSources: routingPlan.excluded_sources.map((source) => source.source_key),
        },
      } : {}),
      ...(queryPlan ? {
        queryPlanning: {
          version: queryPlan.version,
          sourceCount: queryPlan.diagnostics.source_count,
          queryCount: queryPlan.diagnostics.query_count,
          queryFamilyDistribution: queryPlan.diagnostics.query_family_distribution,
          queriesPerSource: queryPlan.diagnostics.queries_per_source,
          candidateBudgetPerSource: queryPlan.diagnostics.candidate_budget_per_source,
          suppressedDuplicateCount: queryPlan.diagnostics.suppressed_duplicate_count,
          lowConfidence: queryPlan.diagnostics.low_confidence,
        },
      } : {}),
    };
    await setScanJob(client, job.id, { status: "succeeded", phase: result.state, scanMode, result, completed: true, progress: { stage: hasWarnings ? "partial_failure" : "completed", percent: 100, completedSources: sources.length, totalSources: sources.length, currentLabel: "Complete", warnings: diagnostics.map((item) => item.message).filter((message): message is string => Boolean(message)).slice(0, 100) } });
    return result;
  } catch (error) {
    const message = publicFailure(error);
    await setScanJob(client, job.id, { status: "failed", phase: "failed", scanMode, errorCode: error instanceof AppError ? error.code : "INITIAL_SCAN_FAILED", errorMessage: message, completed: true });
    throw error;
  }
}
