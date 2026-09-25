import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { SourceControlService, SupabaseSourceControlStore } from "@/server/modules/operations/source-control.service";
import { SupabaseIngestionRepository } from "@/server/modules/ingestion/ingestion.repository";
import { IngestionService } from "@/server/modules/ingestion/ingestion.service";
import { getXRuntimeConfig } from "@/server/providers/source/x/x.auth";
import { getInternalXDiscoveryOverride, logInternalXDiscoveryOverride } from "@/server/providers/source/x/x.internal";
import { githubPainCompilationFromMetadata } from "@/server/modules/operations/query-planning.index";
import { xCompetitorPainCompilationFromMetadata, type XCompetitorPainRetrievalProvenance } from "@/server/modules/operations/x-retrieval-quality";
import type { GithubPainEvidenceAlignmentQuery } from "@/server/modules/operations/github-retrieval-quality";
import { boundedCursorContinuationCount, type QueryYieldExecutionStatus, type QueryYieldStopReason, type QueryYieldTelemetry } from "@/server/modules/operations/query-yield-telemetry";
import { sourceDiscoveryRequestSchema, type SourceDiscoveryRequest } from "@/server/providers/source/contracts";
import { prepareStackExchangeFeatureRequest } from "@/server/providers/source/stack-exchange";
import { g2MappingsFromSourceFilters, g2SourceFiltersWithMappings, type G2ProductMapping } from "@/server/providers/source/g2/product-resolution";
import { deriveMarketPartitionIdentity } from "@/server/modules/ingestion/market-partition-identity";
import { MarketPartitionRepository } from "@/server/modules/ingestion/market-partition.repository";

type Client = SupabaseClient<Database>;

/**
 * Stage 2A shared public-ingestion boundary (Wanterest 1B).
 *
 * This module owns the single canonical provider-retrieval -> ingestion ->
 * replay/canonicalization execution loop. It is deliberately provider- and
 * tenant-agnostic: `ingestPublicPartition` never requires a workspaceId or
 * productId to perform discovery, normalization, or canonicalization. The
 * only place workspace context enters is the optional `operationalContext`,
 * used exclusively for job-run idempotency scoping and internal X override
 * logging - never for storage scoping, matching, or qualification, which
 * remain entirely downstream of this boundary.
 */

/** Discovery evidence for a scan, including rediscovery of canonical rows. */
export type ScanDiscoveryProvenance = {
  conversationId: string;
  queryPlanId: string;
  source: string;
  queryFamily: string;
  demandSurface: string;
  semanticQuery?: string;
  concepts: string[];
  competitorSpecific: boolean;
  githubPainRetrievalV1?: GithubPainEvidenceAlignmentQuery;
  xCompetitorPainRetrievalV1?: XCompetitorPainRetrievalProvenance;
};

export function provenanceForReplay(request: SourceDiscoveryRequest, source: string, mappings: Array<{ conversationId: string }>): ScanDiscoveryProvenance[] {
  const metadata = request.requestMetadata ?? {};
  if (typeof metadata.queryPlanId !== "string" || typeof metadata.demandSurface !== "string") return [];
  const intent = objectValue(metadata.discoveryIntent);
  const concepts = Array.isArray(intent.concept_keys) ? intent.concept_keys.filter((value): value is string => typeof value === "string").slice(0, 20) : [];
  const githubPainRetrievalV1 = source === "github" && metadata.demandSurface === "pain_first" ? githubPainCompilationFromMetadata(metadata) : null;
  const xCompetitorPainRetrievalV1 = source === "x" && metadata.demandSurface === "competitor_pain" ? xCompetitorPainCompilationFromMetadata(metadata) : null;
  const semanticQuery = typeof metadata.semanticQuery === "string"
    ? metadata.semanticQuery
    : source === "github" && metadata.demandSurface === "feature_demand" && typeof request.query === "string"
      ? request.query
      : undefined;
  return mappings.map(({ conversationId }) => ({
    conversationId, queryPlanId: metadata.queryPlanId as string, source,
    queryFamily: typeof metadata.queryFamily === "string" ? metadata.queryFamily : "unknown",
    demandSurface: metadata.demandSurface as string,
    ...(semanticQuery ? { semanticQuery } : {}),
    concepts, competitorSpecific: metadata.competitorSpecific === true,
    ...(githubPainRetrievalV1 ? { githubPainRetrievalV1: { templateVersion: githubPainRetrievalV1.templateVersion, demandAnchors: githubPainRetrievalV1.demandAnchors, categoryAnchors: githubPainRetrievalV1.categoryAnchors } } : {}),
    ...(xCompetitorPainRetrievalV1 ? { xCompetitorPainRetrievalV1 } : {}),
  }));
}

export type DiscoveryProvenanceTemplate = Omit<ScanDiscoveryProvenance, "conversationId">;

/**
 * Wanterest 1B Stage 2D: the conversation-independent part of the discovery
 * provenance a request produces. Uses exactly the same derivation as
 * `provenanceForReplay` so an incremental match can rebuild provenance that is
 * byte-identical to what the product's own scan would have produced for the
 * same conversation. Returns null for requests without planner metadata.
 */
export function discoveryProvenanceTemplate(request: SourceDiscoveryRequest, source: string): DiscoveryProvenanceTemplate | null {
  const [entry] = provenanceForReplay(request, source, [{ conversationId: "00000000-0000-4000-8000-000000000000" }]);
  if (!entry) return null;
  const { conversationId: _conversationId, ...template } = entry;
  void _conversationId;
  return template;
}

export function provenanceFromTemplate(template: DiscoveryProvenanceTemplate, conversationIds: string[]): ScanDiscoveryProvenance[] {
  return conversationIds.map((conversationId) => ({ ...template, conversationId }));
}

export function uniqueProvenance(entries: ScanDiscoveryProvenance[]): ScanDiscoveryProvenance[] {
  return [...new Map(entries.map((entry) => [`${entry.conversationId}:${entry.source}:${entry.queryPlanId}`, entry])).values()]
    .sort((a, b) => a.conversationId.localeCompare(b.conversationId) || a.source.localeCompare(b.source) || a.queryPlanId.localeCompare(b.queryPlanId));
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function safeSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : "Provider request failed.";
  return message.replace(/(authorization|bearer|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 240);
}

function queryPlanIdForRequest(request: SourceDiscoveryRequest, source: string): string {
  const metadata = objectValue(request.requestMetadata);
  return typeof metadata.queryPlanId === "string" ? metadata.queryPlanId : `fallback:${source}:${request.query ?? "default"}`;
}

function queryTelemetryForRequest(input: {
  request: SourceDiscoveryRequest;
  source: string;
  pagesRequested: number;
  pagesCompleted: number;
  cursorContinuationCount: number;
  continuationStoppedReason: QueryYieldStopReason;
  executionStatus: QueryYieldExecutionStatus;
  rawItems: number;
  normalizedItems: number;
  conversationIds: string[];
  estimatedCostUsd: number | null;
  marketPartitionKey?: string | null;
  marketPartitionIneligibleReason?: string | null;
  rawNewItems?: number | null;
  discoveryProvenance?: DiscoveryProvenanceTemplate | null;
}): QueryYieldTelemetry {
  const metadata = objectValue(input.request.requestMetadata);
  const intent = objectValue(metadata.discoveryIntent);
  const uniqueConversations = new Set(input.conversationIds).size;
  return {
    queryPlanId: queryPlanIdForRequest(input.request, input.source),
    source: input.source,
    family: typeof metadata.queryFamily === "string" ? metadata.queryFamily : "fallback",
    surface: typeof metadata.demandSurface === "string" ? metadata.demandSurface : "unknown",
    concepts: Array.isArray(intent.concept_keys) ? (intent.concept_keys as unknown[]).filter((value): value is string => typeof value === "string") : [],
    competitorSpecific: metadata.competitorSpecific === true,
    pagesRequested: input.pagesRequested,
    pagesCompleted: input.pagesCompleted,
    cursorContinuationCount: input.cursorContinuationCount,
    continuationStoppedReason: input.continuationStoppedReason,
    executionStatus: input.executionStatus,
    rawItems: input.rawItems,
    normalizedItems: input.normalizedItems,
    uniqueConversations,
    duplicateCount: Math.max(0, input.normalizedItems - uniqueConversations),
    estimatedCostUsd: input.estimatedCostUsd,
    marketPartitionKey: input.marketPartitionKey ?? null,
    marketPartitionIneligibleReason: input.marketPartitionIneligibleReason ?? null,
    rawNewItems: input.rawNewItems ?? null,
    ...(input.discoveryProvenance ? { discoveryProvenance: input.discoveryProvenance as unknown as Record<string, unknown> } : {}),
  };
}

function queryFailureDiagnostic(error: unknown, request: SourceDiscoveryRequest, source: string): string {
  const value = error && typeof error === "object" ? error as { code?: unknown; providerDetails?: { status?: unknown; message?: unknown } } : {};
  const metadata = objectValue(request.requestMetadata);
  const queryPlanId = queryPlanIdForRequest(request, source).slice(0, 180);
  const code = typeof value.code === "string" ? value.code : "REQUEST_FAILED";
  const status = typeof value.providerDetails?.status === "number" ? String(value.providerDetails.status) : "unknown";
  const providerMessage = typeof value.providerDetails?.message === "string" ? value.providerDetails.message : safeSummary(error);
  const requestType = source === "github"
    ? metadata.contentType === "discussions" ? "github_discussion_search" : "github_issue_search"
    : `${source}_search`;
  return `query provider_error queryPlanId=${queryPlanId} requestType=${requestType} providerStatus=${status} providerCode=${code} message=${providerMessage.replace(/\s+/g, " ").slice(0, 200)}`;
}

function errorCodeOf(error: unknown): string | null {
  const value = error && typeof error === "object" ? error as { code?: unknown } : {};
  return typeof value.code === "string" ? value.code : null;
}

/**
 * Scopes a request to one durable job run so discovery is idempotent within a
 * scan while still allowing a later rescan to execute the same semantic
 * request again. Operational only: never affects canonicalization semantics.
 */
function requestScopedToScan(request: SourceDiscoveryRequest, jobRunId: string, sourceKey: string, workspaceId?: string): SourceDiscoveryRequest {
  return sourceDiscoveryRequestSchema.parse({
    ...request,
    requestMetadata: {
      ...request.requestMetadata,
      scanJobRunId: jobRunId,
      ...(sourceKey === "x" && workspaceId ? { internalWorkspaceId: workspaceId } : {}),
    },
  });
}

function logXDiscoveryOverride(workspaceId: string, requests: SourceDiscoveryRequest[]): void {
  const override = getInternalXDiscoveryOverride(workspaceId);
  if (!override) return;
  logInternalXDiscoveryOverride({
    workspaceId,
    queryCount: requests.length,
    maxPosts: override.maxPostsPerScan,
    postReadCostUsd: getXRuntimeConfig().postReadCostUsd,
  });
}

function g2ContextFromRequests(requests: SourceDiscoveryRequest[]): { workspaceId: string; productId: string } | null {
  for (const request of requests) {
    const context = objectValue(request.requestMetadata.g2ScanContext);
    if (typeof context.workspaceId === "string" && typeof context.productId === "string") return { workspaceId: context.workspaceId, productId: context.productId };
  }
  return null;
}

/**
 * Persists resolved G2 product mappings for reuse on the next scan. This is the
 * one place shared ingestion still writes workspace/product-scoped state, and it
 * does so using workspace/product identifiers carried in the request's own
 * `g2ScanContext` metadata (set by product-aware query planning upstream) -
 * never from a required top-level parameter on the ingestion contract itself.
 */
export async function persistG2Resolutions(client: Client, context: { workspaceId: string; productId: string }, resolutions: SourceExecutionResult["resolutions"]): Promise<void> {
  if (!resolutions?.length) return;
  const existing = await client.from("discovery_strategies").select("filters").eq("workspace_id", context.workspaceId).eq("product_id", context.productId).eq("source_key", "g2").eq("strategy_version", 1).maybeSingle();
  if (existing.error) throw new AppError("INTERNAL_ERROR", "G2 source metadata could not be loaded.", 500, { providerMessage: existing.error.message });
  const mappings = g2MappingsFromSourceFilters(existing.data?.filters);
  for (const resolution of resolutions) mappings[resolution.targetKey] = resolution as G2ProductMapping;
  const filters = g2SourceFiltersWithMappings(existing.data?.filters, mappings);
  const saved = await client.from("discovery_strategies").upsert({ workspace_id: context.workspaceId, product_id: context.productId, source_key: "g2", strategy_version: 1, filters, is_active: true }, { onConflict: "workspace_id,product_id,source_key,strategy_version" }).select("id").single();
  if (saved.error) throw new AppError("INTERNAL_ERROR", "G2 source metadata could not be stored.", 500, { providerMessage: saved.error.message });
}

/**
 * Legacy input shape kept for the `executeSourceDiscovery` compatibility wrapper
 * in `initial-scan.service.ts`. New callers should use `PublicIngestionInput`.
 */
export type SourceExecutionInput = {
  sourceKey: string;
  productId: string;
  requests: SourceDiscoveryRequest[];
  traceId: string;
  workspaceId: string;
  jobRunId: string;
};

export type SourceExecutionResult = {
  sourceKey: string;
  rawSourceItemIds: string[];
  normalizedSourceItemIds: string[];
  conversationIds: string[];
  provenance: ScanDiscoveryProvenance[];
  rawInserted: number;
  itemsReturned: number;
  queryCount: number;
  diagnostics: string[];
  rateLimitRemaining: number | null;
  estimatedCost: number | null;
  queryTelemetry: QueryYieldTelemetry[];
  failedQueryCount?: number;
  errorCode?: string | null;
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

/**
 * Operational job-run association. Required only because job_runs / ingestion
 * idempotency keys are scoped per durable job run today - not used for any
 * provider-retrieval or canonicalization semantics. Omit it entirely when
 * calling this function outside of a product-demand-scan job run.
 */
export type PublicIngestionOperationalContext = {
  jobRunId: string;
  workspaceId?: string;
};

export type PublicIngestionInput = {
  sourceKey: string;
  requests: SourceDiscoveryRequest[];
  traceId: string;
  operationalContext?: PublicIngestionOperationalContext;
};

export type PublicIngestionResult = SourceExecutionResult;

/**
 * Executes provider discovery plus the existing raw -> normalized -> canonical
 * replay for one source. This is the single canonical public-ingestion
 * execution loop for Wanterest 1B Stage 2A: both the Trigger-backed
 * `discover-product-source` task and any direct-execution caller run through
 * this exact function, so there is no second implementation of the discovery
 * loop left anywhere in the codebase.
 */
export async function ingestPublicPartition(input: PublicIngestionInput): Promise<PublicIngestionResult> {
  const client = createSupabaseServiceClient();
  const ingestionRepository = new SupabaseIngestionRepository(client);
  const ingestion = new IngestionService(ingestionRepository, undefined, new SourceControlService(new SupabaseSourceControlStore(client)));
  const marketPartitionRepository = new MarketPartitionRepository(client);
  const rawSourceItemIds: string[] = [];
  const normalizedSourceItemIds: string[] = [];
  const conversationIds: string[] = [];
  const provenance: ScanDiscoveryProvenance[] = [];
  const diagnostics: string[] = [];
  const resolutions: NonNullable<SourceExecutionResult["resolutions"]> = [];
  let rawInserted = 0;
  let rateLimitRemaining: number | null = null;
  let estimatedCost: number | null = null;
  const providerMetrics: Record<string, unknown> = {};
  const queryTelemetry: QueryYieldTelemetry[] = [];
  let failedQueryCount = 0;
  let firstQueryErrorCode: string | null = null;
  if (input.sourceKey === "x" && input.operationalContext?.workspaceId) logXDiscoveryOverride(input.operationalContext.workspaceId, input.requests);
  for (const rawRequest of input.requests) {
    const parsedRequest = sourceDiscoveryRequestSchema.parse(rawRequest);
    let request = parsedRequest;
    let metadata = request.requestMetadata as Record<string, unknown>;
    const maxPages = Math.min(3, Math.max(1, typeof metadata.maxPages === "number" ? Math.floor(metadata.maxPages) : 1));
    let cursor = request.cursor;
    let rawItems = 0;
    let normalizedItems = 0;
    let queryRawInserted = 0;
    const queryConversationIds: string[] = [];
    let pagesCompleted = 0;
    let continuations = 0;
    let queryCost: number | null = null;
    let queryError: unknown;
    let marketPartitionKey: string | null = null;
    let marketPartitionIneligibleReason: string | null = null;
    let discoveryProvenance: DiscoveryProvenanceTemplate | null = null;
    try {
      request = input.sourceKey === "stack-exchange" ? prepareStackExchangeFeatureRequest(parsedRequest) : parsedRequest;
      metadata = request.requestMetadata as Record<string, unknown>;
      // Stage 2B: identity is derived once per request (before per-page cursor
      // assignment and operational scoping) so it can never depend on paging,
      // the job run, or workspace context. Persistence failure is caught and
      // downgraded to a diagnostic - it must never turn a successful provider
      // retrieval into a failed scan.
      const partitionIdentity = deriveMarketPartitionIdentity({ sourceKey: input.sourceKey, request });
      if (partitionIdentity.eligible) {
        marketPartitionKey = partitionIdentity.partitionKey;
        discoveryProvenance = discoveryProvenanceTemplate(request, input.sourceKey);
        try {
          await marketPartitionRepository.ensure({
            id: partitionIdentity.partitionId,
            partitionKey: partitionIdentity.partitionKey,
            identityVersion: partitionIdentity.identityVersion,
            sourceKey: input.sourceKey,
            retrievalSpec: partitionIdentity.retrievalSpec,
          });
        } catch (partitionError) {
          diagnostics.push(`market partition persistence skipped: ${safeSummary(partitionError)}`);
        }
      } else {
        marketPartitionIneligibleReason = partitionIdentity.reason;
      }
      for (let page = 1; page <= maxPages; page += 1) {
        const pageRequest = { ...request, ...(cursor ? { cursor } : {}) };
        const scopedRequest = input.operationalContext
          ? requestScopedToScan(pageRequest, input.operationalContext.jobRunId, input.sourceKey, input.operationalContext.workspaceId)
          : sourceDiscoveryRequestSchema.parse(pageRequest);
        const discovery = await ingestion.discoverSource(input.sourceKey, scopedRequest, input.traceId);
        rawSourceItemIds.push(...discovery.rawSourceItemIds);
        rawItems += discovery.rawSourceItemIds.length;
        rawInserted += discovery.rawInserted;
        queryRawInserted += discovery.rawInserted;
        diagnostics.push(...discovery.diagnostics);
        if (discovery.resolutions) resolutions.push(...discovery.resolutions);
        const replay = await ingestion.replayDetailed({ rawSourceItemIds: discovery.rawSourceItemIds, normalizationVersion: `${input.sourceKey}-v1`, canonicalizationVersion: "canonical-v1", limit: 100 });
        normalizedSourceItemIds.push(...replay.normalizedSourceItemIds);
        normalizedItems += replay.normalizedSourceItemIds.length;
        pagesCompleted += 1;
        conversationIds.push(...replay.canonicalizedConversationIds);
        queryConversationIds.push(...replay.canonicalizedConversationIds);
        provenance.push(...provenanceForReplay(request, input.sourceKey, replay.replayMappings));
        if (typeof metadata.estimatedCost === "number") estimatedCost = (estimatedCost ?? 0) + metadata.estimatedCost;
        if (typeof metadata.rateLimitRemaining === "number") rateLimitRemaining = metadata.rateLimitRemaining;
        if (typeof discovery.estimatedCost === "number") { estimatedCost = (estimatedCost ?? 0) + discovery.estimatedCost; queryCost = (queryCost ?? 0) + discovery.estimatedCost; }
        if (typeof discovery.rateLimit?.remaining === "number") rateLimitRemaining = discovery.rateLimit.remaining;
        if (discovery.providerMetrics) for (const [key, value] of Object.entries(discovery.providerMetrics)) {
          if (typeof value === "number" && typeof providerMetrics[key] === "number") providerMetrics[key] = (providerMetrics[key] as number) + value;
          else providerMetrics[key] = value;
        }
        cursor = discovery.nextCursor;
        if (!cursor) break;
        continuations += 1;
      }
    } catch (error) {
      queryError = error;
      failedQueryCount += 1;
      firstQueryErrorCode ??= errorCodeOf(error);
      diagnostics.push(queryFailureDiagnostic(error, request, input.sourceKey));
    }
    const executionStatus: QueryYieldExecutionStatus = queryError ? errorCodeOf(queryError) === "RATE_LIMITED" ? "rate_limited" : "provider_error" : rawItems ? "completed_with_results" : "completed_zero_results";
    queryTelemetry.push(queryTelemetryForRequest({
      request,
      source: input.sourceKey,
      pagesRequested: maxPages,
      pagesCompleted,
      cursorContinuationCount: boundedCursorContinuationCount(continuations, maxPages),
      continuationStoppedReason: queryError ? "error" : cursor ? "page_cap_reached" : rawItems ? "no_cursor" : "zero_results",
      executionStatus,
      rawItems,
      normalizedItems,
      conversationIds: queryConversationIds,
      estimatedCostUsd: queryCost,
      marketPartitionKey,
      marketPartitionIneligibleReason,
      rawNewItems: queryRawInserted,
      discoveryProvenance,
    }));
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
    provenance: uniqueProvenance(provenance),
    rawInserted,
    itemsReturned: rawSourceItemIds.length,
    queryCount: input.requests.length,
    diagnostics,
    rateLimitRemaining,
    estimatedCost,
    queryTelemetry,
    ...(failedQueryCount ? { failedQueryCount, errorCode: firstQueryErrorCode } : {}),
    ...(Object.keys(providerMetrics).length ? { providerMetrics } : {}),
    ...(resolutions.length ? { resolutions } : {}),
  };
}
