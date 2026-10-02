import "server-only";

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
import { deriveMarketPartitionIdentity } from "@/server/modules/ingestion/market-partition-identity";
import { MarketPartitionRepository } from "@/server/modules/ingestion/market-partition.repository";
import { sha256Json } from "@/server/modules/ingestion/hash";
import {
  persistSourceQueryExecution,
  sourceExecutionId,
  sourceExecutionPageId,
  sourceResultAttributionId,
  type SourceQueryExecutionAttribution,
  type SourceQueryPageAttribution,
  type SourceQueryResultAttribution,
} from "@/server/modules/operations/source-execution-telemetry.repository";
import { queryIntentFamilySchema, queryNoveltyStateSchema, querySelectionReasonSchema, queryVariantVersionSchema } from "@/server/modules/operations/query-planning.schemas";
import { sourceExecutionObservabilityEnabled } from "@/server/modules/operations/source-execution-telemetry.config";
import { signalPaginationDepthV1Enabled } from "@/server/modules/operations/signal-pagination-depth.config";
import {
  classifySignalPaginationContinuation,
  decideSignalPaginationContinuation,
  signalPaginationDepthV1MaxContinuationsPerScan,
  signalPaginationDepthV1MaxPagesPerQuery,
  signalPaginationDepthV1Version,
  supportsSignalPaginationDepthV1,
} from "@/server/modules/operations/signal-pagination-depth.policy";

export type { SourceQueryResultAttribution };

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
  return typeof metadata.queryPlanId === "string" ? metadata.queryPlanId : `fallback:${source}:${sha256Json(request.query ?? "default").slice(0, 32)}`;
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
  // Planner IDs contain a slug of the normalized query. Error diagnostics are
  // durable, so include only a stable fingerprint instead of query-derived text.
  const queryPlanId = sha256Json(queryPlanIdForRequest(request, source));
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
  /** Stable query→provider row→normalized item→canonical root links for later product-outcome attribution. */
  resultAttributions?: SourceQueryResultAttribution[];
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

type PageResultObservation = {
  rawSourceItemId: string;
  providerItemFingerprint: string;
  rawSnapshotInserted: boolean | null;
  sourceItemId: string | null;
  conversationId: string | null;
};

type PageObservation = {
  pageNumber: number;
  paginationPolicyVersion: typeof signalPaginationDepthV1Version | null;
  continuationEligible: boolean | null;
  continuationReason: string | null;
  continuationAttempted: boolean;
  continuationStatus: "not_attempted" | "received" | "empty" | "repetitive" | "failed" | null;
  sourceJobRunId: string | null;
  cursorRequested: boolean;
  providerResultsReturned: number;
  rawSnapshotsAccepted: number;
  rawSnapshotsInserted: number;
  rawSnapshotsDuplicate: number;
  normalizedItems: number;
  rateLimitRemaining: number | null;
  retryAfterMs: number | null;
  attemptCount: number;
  durationMs: number;
  observedAt: string;
  continuationAvailable: boolean;
  failed: boolean;
  items: PageResultObservation[];
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

export function mergeProviderMetrics(target: Record<string, unknown>, incoming: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(incoming)) {
    const existing = target[key];
    if (existing && value && typeof existing === "object" && !Array.isArray(existing) && typeof value === "object" && !Array.isArray(value)
      && typeof (existing as Record<string, unknown>).policyVersion === "string" && typeof (value as Record<string, unknown>).policyVersion === "string") {
      const merged: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
      for (const [field, next] of Object.entries(value as Record<string, unknown>)) {
        merged[field] = typeof next === "number" && typeof merged[field] === "number" ? (merged[field] as number) + next : next;
      }
      target[key] = merged;
    } else if (typeof value === "number" && typeof existing === "number") {
      target[key] = existing + value;
    } else {
      target[key] = value;
    }
  }
}

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
  const captureSourceTelemetry = sourceExecutionObservabilityEnabled();
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
  const resultAttributions: SourceQueryResultAttribution[] = [];
  let failedQueryCount = 0;
  let firstQueryErrorCode: string | null = null;
  let continuationBudgetRemaining = Math.min(signalPaginationDepthV1MaxContinuationsPerScan, input.requests.length);
  if (input.sourceKey === "x" && input.operationalContext?.workspaceId) logXDiscoveryOverride(input.operationalContext.workspaceId, input.requests);
  for (const rawRequest of input.requests) {
    const parsedRequest = sourceDiscoveryRequestSchema.parse(rawRequest);
    let request = parsedRequest;
    let metadata = request.requestMetadata as Record<string, unknown>;
    const configuredMaxPages = Math.min(3, Math.max(1, typeof metadata.maxPages === "number" ? Math.floor(metadata.maxPages) : 1));
    let maxPages = configuredMaxPages;
    let paginationDepthV1Active = false;
    let continuationFailed = false;
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
    const queryStartedAt = Date.now();
    const pageObservations: PageObservation[] = [];
    try {
      request = input.sourceKey === "stack-exchange" ? prepareStackExchangeFeatureRequest(parsedRequest) : parsedRequest;
      metadata = request.requestMetadata as Record<string, unknown>;
      paginationDepthV1Active = Boolean(
        captureSourceTelemetry
        && input.operationalContext
        && signalPaginationDepthV1Enabled()
        && supportsSignalPaginationDepthV1(input.sourceKey, metadata),
      );
      if (paginationDepthV1Active) maxPages = Math.min(configuredMaxPages, signalPaginationDepthV1MaxPagesPerQuery);
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
        const pageStartedAt = Date.now();
        const cursorRequested = Boolean(cursor);
        const pageRequest = { ...request, ...(cursor ? { cursor } : {}) };
        const scopedRequest = input.operationalContext
          ? requestScopedToScan(pageRequest, input.operationalContext.jobRunId, input.sourceKey, input.operationalContext.workspaceId)
          : sourceDiscoveryRequestSchema.parse(pageRequest);
        const adapterRequest = paginationDepthV1Active
          ? sourceDiscoveryRequestSchema.parse({
            ...scopedRequest,
            requestMetadata: { ...(scopedRequest.requestMetadata ?? {}), maxPages: 1 },
          })
          : scopedRequest;
        try {
          const discovery = await ingestion.discoverSource(input.sourceKey, adapterRequest, input.traceId);
          rawSourceItemIds.push(...discovery.rawSourceItemIds);
          rawItems += discovery.rawSourceItemIds.length;
          rawInserted += discovery.rawInserted;
          queryRawInserted += discovery.rawInserted;
          diagnostics.push(...discovery.diagnostics);
          if (discovery.resolutions) resolutions.push(...discovery.resolutions);
          const normalizationVersion = input.sourceKey === "stack-exchange" && metadata.stackExchangeV2 === true ? "stack-exchange-v2" : `${input.sourceKey}-v1`;
          const replay = await ingestion.replayDetailed({ rawSourceItemIds: discovery.rawSourceItemIds, normalizationVersion, canonicalizationVersion: "canonical-v1", limit: 100 });
          normalizedSourceItemIds.push(...replay.normalizedSourceItemIds);
          normalizedItems += replay.normalizedSourceItemIds.length;
          pagesCompleted += 1;
          conversationIds.push(...replay.canonicalizedConversationIds);
          queryConversationIds.push(...replay.canonicalizedConversationIds);
          provenance.push(...provenanceForReplay(request, input.sourceKey, replay.replayMappings));
          const nextCursor = discovery.nextCursor ?? null;

          if (captureSourceTelemetry) {
          let observations: Array<{ rawSourceItemId: string; providerItemFingerprint: string; inserted: boolean | null }> = discovery.rawItemObservations ?? [];
          if (observations.length !== discovery.rawSourceItemIds.length) {
            let byId = new Map<string, string>();
            try {
              const rawRows = discovery.rawSourceItemIds.length
                ? await client.from("raw_source_items").select("id,external_id").in("id", discovery.rawSourceItemIds)
                : { data: [], error: null };
              byId = new Map((rawRows.error ? [] : rawRows.data ?? []).map((row) => [String(row.id), String(row.external_id)]));
              if (rawRows.error) diagnostics.push("source result attribution lookup unavailable for a replayed discovery page.");
            } catch {
              diagnostics.push("source result attribution lookup unavailable for a replayed discovery page.");
            }
            observations = discovery.rawSourceItemIds.map((rawSourceItemId) => {
              const externalId = byId.get(rawSourceItemId);
              return { rawSourceItemId, providerItemFingerprint: externalId ? sha256Json({ sourceKey: input.sourceKey, externalId }) : rawSourceItemId, inserted: null };
            });
          }
          const mappingByRawId = new Map<string, { sourceItemId: string; conversationId: string }>();
          replay.replayMappings.forEach((mapping, index) => {
            const rawSourceItemId = typeof mapping.rawSourceItemId === "string" ? mapping.rawSourceItemId : discovery.rawSourceItemIds[index];
            if (rawSourceItemId && typeof mapping.sourceItemId === "string" && typeof mapping.conversationId === "string") {
              mappingByRawId.set(rawSourceItemId, { sourceItemId: mapping.sourceItemId, conversationId: mapping.conversationId });
            }
          });
          const observationByIndex = discovery.rawItemObservations && discovery.rawItemObservations.length === discovery.rawSourceItemIds.length
            ? discovery.rawItemObservations
            : observations;
          const items = discovery.rawSourceItemIds.map((rawSourceItemId, index) => {
            const mapping = mappingByRawId.get(rawSourceItemId);
            const observation = observationByIndex[index];
            return {
              rawSourceItemId,
              providerItemFingerprint: observation?.providerItemFingerprint ?? rawSourceItemId,
              rawSnapshotInserted: observation?.inserted ?? null,
              sourceItemId: mapping?.sourceItemId ?? null,
              conversationId: mapping?.conversationId ?? null,
            };
          });
          const observedAt = new Date().toISOString();
          pageObservations.push({
            pageNumber: page,
            paginationPolicyVersion: paginationDepthV1Active ? signalPaginationDepthV1Version : null,
            continuationEligible: null,
            continuationReason: null,
            continuationAttempted: false,
            continuationStatus: null,
            sourceJobRunId: typeof discovery.jobRunId === "string" ? discovery.jobRunId : null,
            cursorRequested,
            providerResultsReturned: discovery.rawSourceItemIds.length + (discovery.rejected ?? 0),
            rawSnapshotsAccepted: discovery.rawSourceItemIds.length,
            rawSnapshotsInserted: discovery.rawInserted ?? 0,
            rawSnapshotsDuplicate: discovery.rawDuplicates ?? Math.max(0, discovery.rawSourceItemIds.length - (discovery.rawInserted ?? 0)),
            normalizedItems: replay.normalizedSourceItemIds.length,
            rateLimitRemaining: discovery.rateLimit?.remaining ?? null,
            retryAfterMs: discovery.rateLimit?.retryAfterMs ?? null,
            attemptCount: discovery.attemptCount ?? 1,
            durationMs: Date.now() - pageStartedAt,
            observedAt,
            continuationAvailable: Boolean(nextCursor),
            failed: false,
            items,
          });
          }

          if (typeof metadata.estimatedCost === "number") estimatedCost = (estimatedCost ?? 0) + metadata.estimatedCost;
          if (typeof metadata.rateLimitRemaining === "number") rateLimitRemaining = metadata.rateLimitRemaining;
          if (typeof discovery.estimatedCost === "number") { estimatedCost = (estimatedCost ?? 0) + discovery.estimatedCost; queryCost = (queryCost ?? 0) + discovery.estimatedCost; }
          if (typeof discovery.rateLimit?.remaining === "number") rateLimitRemaining = discovery.rateLimit.remaining;
          if (discovery.providerMetrics) mergeProviderMetrics(providerMetrics, discovery.providerMetrics);
          if (paginationDepthV1Active && page === 1) {
            const firstPage = pageObservations[pageObservations.length - 1];
            if (firstPage) {
              const attributableResults = firstPage.items.filter((item) => item.conversationId !== null).length;
              const independentRoots = new Set(firstPage.items.flatMap((item) => item.conversationId ? [item.conversationId] : [])).size;
              const uniqueProviderItems = new Set(firstPage.items.map((item) => item.providerItemFingerprint)).size;
              const decision = decideSignalPaginationContinuation({
                failed: false,
                cursorAvailable: Boolean(nextCursor),
                pageBudget: maxPages,
                acceptedItems: firstPage.rawSnapshotsAccepted,
                insertedRawItems: firstPage.rawSnapshotsInserted,
                uniqueProviderItems,
                attributableResults,
                independentRoots,
                repeatedRootAttributions: Math.max(0, attributableResults - independentRoots),
                rateLimitRemaining: firstPage.rateLimitRemaining,
                continuationBudgetRemaining,
              });
              firstPage.continuationEligible = decision.eligible;
              firstPage.continuationReason = decision.reason;
              firstPage.continuationStatus = decision.status;
              if (decision.eligible) {
                firstPage.continuationAttempted = true;
                continuationBudgetRemaining -= 1;
                continuations += 1;
              }
            }
            cursor = nextCursor ?? undefined;
            if (!firstPage?.continuationEligible) break;
          } else if (paginationDepthV1Active && page === 2) {
            // Pagination V1 has exactly one optional continuation step. Even
            // when page two offers another cursor, never request page three.
            cursor = nextCursor ?? undefined;
            break;
          } else {
            cursor = nextCursor ?? undefined;
            if (!cursor) break;
            continuations += 1;
          }
        } catch (error) {
          if (captureSourceTelemetry) {
            pageObservations.push({
              pageNumber: page,
              paginationPolicyVersion: paginationDepthV1Active ? signalPaginationDepthV1Version : null,
              continuationEligible: null,
              continuationReason: null,
              continuationAttempted: false,
              continuationStatus: null,
              sourceJobRunId: null,
              cursorRequested,
              providerResultsReturned: 0,
              rawSnapshotsAccepted: 0,
              rawSnapshotsInserted: 0,
              rawSnapshotsDuplicate: 0,
              normalizedItems: 0,
              rateLimitRemaining: null,
              retryAfterMs: null,
              attemptCount: 1,
              durationMs: Date.now() - pageStartedAt,
              observedAt: new Date().toISOString(),
              continuationAvailable: false,
              failed: true,
              items: [],
            });
          }
          if (paginationDepthV1Active && page === 1) {
            const firstPage = pageObservations[pageObservations.length - 1];
            if (firstPage) {
              firstPage.continuationEligible = false;
              firstPage.continuationReason = "first_page_failed";
              firstPage.continuationStatus = "not_attempted";
            }
          }
          if (paginationDepthV1Active && page === 2) {
            const firstPage = pageObservations.find((observation) => observation.pageNumber === 1);
            if (firstPage) firstPage.continuationStatus = "failed";
            continuationFailed = true;
            cursor = undefined;
            diagnostics.push(`optional provider continuation warning: ${queryFailureDiagnostic(error, request, input.sourceKey)}`);
            break;
          }
          throw error;
        }
      }
    } catch (error) {
      queryError = error;
      failedQueryCount += 1;
      firstQueryErrorCode ??= errorCodeOf(error);
      diagnostics.push(queryFailureDiagnostic(error, request, input.sourceKey));
    }
    if (paginationDepthV1Active && !continuationFailed) {
      const firstPage = pageObservations.find((page) => page.pageNumber === 1);
      const continuationPage = pageObservations.find((page) => page.pageNumber === 2);
      if (firstPage?.continuationAttempted && continuationPage) {
        const firstPageProviderItems = new Set(firstPage.items.map((item) => item.providerItemFingerprint));
        const firstPageRoots = new Set(firstPage.items.flatMap((item) => item.conversationId ? [item.conversationId] : []));
        const newProviderItems = new Set(continuationPage.items
          .map((item) => item.providerItemFingerprint)
          .filter((fingerprint) => !firstPageProviderItems.has(fingerprint))).size;
        const firstSeenRootsInExecution = new Set(continuationPage.items
          .flatMap((item) => item.conversationId && !firstPageRoots.has(item.conversationId) ? [item.conversationId] : [])).size;
        firstPage.continuationStatus = classifySignalPaginationContinuation({
          providerResultsReturned: continuationPage.providerResultsReturned,
          acceptedItems: continuationPage.rawSnapshotsAccepted,
          newProviderItems,
          firstSeenRootsInExecution,
        });
      }
    }
    const executionStatus: QueryYieldExecutionStatus = queryError ? errorCodeOf(queryError) === "RATE_LIMITED" ? "rate_limited" : "provider_error" : rawItems ? "completed_with_results" : "completed_zero_results";

    if (captureSourceTelemetry) {
    // Compute the per-execution item/root overlap locally. Only booleans and
    // database UUIDs are persisted; query strings and provider cursors stay out.
    const queryPlanId = queryPlanIdForRequest(request, input.sourceKey);
    const pageAttemptKeys = pageObservations.map((page) => `${page.sourceJobRunId ?? `page-${page.pageNumber}`}:${page.attemptCount}`);
    const executionKey = sha256Json({ parentJobRunId: input.operationalContext?.jobRunId ?? null, sourceKey: input.sourceKey, queryPlanId, pageAttemptKeys });
    const executionId = sourceExecutionId(executionKey);
    const providerItemsSeen = new Set<string>();
    const rootsSeen = new Set<string>();
    const persistedPages: SourceQueryPageAttribution[] = [];
    const persistedResults: SourceQueryResultAttribution[] = [];
    for (const [pageIndex, page] of pageObservations.entries()) {
      const pageId = sourceExecutionPageId(executionId, page.pageNumber);
      let pageUniqueProviderItems = 0;
      let pageDuplicateProviderItems = 0;
      let pageUniqueRoots = 0;
      let pageDuplicateRoots = 0;
      page.items.slice(0, 500).forEach((item, index) => {
        const firstProviderItemInExecution = !providerItemsSeen.has(item.providerItemFingerprint);
        providerItemsSeen.add(item.providerItemFingerprint);
        if (firstProviderItemInExecution) pageUniqueProviderItems += 1; else pageDuplicateProviderItems += 1;
        const firstRootInExecution = item.conversationId !== null && !rootsSeen.has(item.conversationId);
        if (item.conversationId) rootsSeen.add(item.conversationId);
        if (firstRootInExecution) pageUniqueRoots += 1;
        else if (item.conversationId) pageDuplicateRoots += 1;
        persistedResults.push({
          id: sourceResultAttributionId(pageId, index + 1), pageId, resultOrdinal: index + 1,
          rawSourceItemId: item.rawSourceItemId, sourceItemId: item.sourceItemId, conversationId: item.conversationId,
          rawSnapshotInserted: item.rawSnapshotInserted, firstProviderItemInExecution, firstRootInExecution,
        });
      });
      const continuationFollowed = pageIndex < pageObservations.length - 1 && page.continuationAvailable && pageObservations[pageIndex + 1]?.cursorRequested === true;
      const stopReason: SourceQueryPageAttribution["stopReason"] = continuationFollowed ? "continuation_followed" : page.failed ? "error" : page.continuationAvailable ? "page_cap_reached" : page.providerResultsReturned === 0 ? "zero_results" : "no_cursor";
      persistedPages.push({
        id: pageId, pageNumber: page.pageNumber,
        paginationPolicyVersion: page.paginationPolicyVersion,
        continuationEligible: page.continuationEligible,
        continuationReason: page.continuationReason,
        continuationAttempted: page.continuationAttempted,
        continuationStatus: page.continuationStatus,
        sourceJobRunId: page.sourceJobRunId,
        cursorRequested: page.cursorRequested, providerResultsReturned: page.providerResultsReturned,
        rawSnapshotsAccepted: page.rawSnapshotsAccepted, rawSnapshotsInserted: page.rawSnapshotsInserted, rawSnapshotsDuplicate: page.rawSnapshotsDuplicate,
        normalizedItems: page.normalizedItems, uniqueProviderItems: pageUniqueProviderItems, duplicateProviderItems: pageDuplicateProviderItems,
        uniqueRoots: pageUniqueRoots, duplicateRoots: pageDuplicateRoots, continuationAvailable: page.continuationAvailable,
        continuationFollowed, stopReason, rateLimitRemaining: page.rateLimitRemaining, retryAfterMs: page.retryAfterMs, attemptCount: page.attemptCount,
        durationMs: page.durationMs, observedAt: page.observedAt,
      });
    }
    const errorCode = errorCodeOf(queryError);
    const safeErrorCode = errorCode && /^[A-Z0-9_-]{1,80}$/.test(errorCode) ? errorCode : null;
    if (input.operationalContext) {
      const sourceCounts = pageObservations.reduce((counts, page) => ({
        providerResultsReturned: counts.providerResultsReturned + page.providerResultsReturned,
        rawSnapshotsAccepted: counts.rawSnapshotsAccepted + page.rawSnapshotsAccepted,
        rawSnapshotsInserted: counts.rawSnapshotsInserted + page.rawSnapshotsInserted,
        rawSnapshotsDuplicate: counts.rawSnapshotsDuplicate + page.rawSnapshotsDuplicate,
        normalizedItems: counts.normalizedItems + page.normalizedItems,
      }), { providerResultsReturned: 0, rawSnapshotsAccepted: 0, rawSnapshotsInserted: 0, rawSnapshotsDuplicate: 0, normalizedItems: 0 });
      const queryRoots = new Set(pageObservations.flatMap((page) => page.items.map((item) => item.conversationId).filter((id): id is string => id !== null)));
      const continuationsFollowed = persistedPages.filter((page) => page.continuationFollowed).length;
      const summary: SourceQueryExecutionAttribution = {
        id: executionId, executionKey, parentJobRunId: input.operationalContext.jobRunId, queryPlanFingerprint: sha256Json(queryPlanId), sourceKey: input.sourceKey,
        queryFamily: typeof metadata.queryFamily === "string" ? metadata.queryFamily.trim().slice(0, 80) || "fallback" : "fallback",
        intentFamily: queryIntentFamilySchema.safeParse(metadata.intentFamily).success ? queryIntentFamilySchema.parse(metadata.intentFamily) : "unclassified",
        queryVariantVersion: queryVariantVersionSchema.safeParse(metadata.queryVariantVersion).success ? queryVariantVersionSchema.parse(metadata.queryVariantVersion) : "legacy",
        selectionReason: querySelectionReasonSchema.safeParse(metadata.querySelectionReason).success ? querySelectionReasonSchema.parse(metadata.querySelectionReason) : null,
        noveltyState: queryNoveltyStateSchema.safeParse(metadata.queryNoveltyState).success ? queryNoveltyStateSchema.parse(metadata.queryNoveltyState) : null,
        demandSurface: typeof metadata.demandSurface === "string" ? metadata.demandSurface.trim().slice(0, 80) || "unknown" : "unknown",
        pagesRequested: maxPages, pagesCompleted, continuationCount: continuationsFollowed,
        stopReason: queryError || continuationFailed ? "error" : cursor ? "page_cap_reached" : rawItems ? "no_cursor" : "zero_results",
        executionStatus, providerResultsReturned: sourceCounts.providerResultsReturned, rawSnapshotsAccepted: sourceCounts.rawSnapshotsAccepted,
        rawSnapshotsInserted: sourceCounts.rawSnapshotsInserted, rawSnapshotsDuplicate: sourceCounts.rawSnapshotsDuplicate,
        uniqueProviderItems: providerItemsSeen.size, duplicateProviderItems: Math.max(0, sourceCounts.rawSnapshotsAccepted - providerItemsSeen.size),
        normalizedItems: sourceCounts.normalizedItems, uniqueRoots: queryRoots.size,
        duplicateRoots: Math.max(0, pageObservations.reduce((count, page) => count + page.items.filter((item) => item.conversationId !== null).length, 0) - queryRoots.size),
        errorCode: safeErrorCode, startedAt: new Date(queryStartedAt).toISOString(), completedAt: new Date().toISOString(), durationMs: Date.now() - queryStartedAt,
        pages: persistedPages, results: persistedResults,
      };
      // Failed pages have no child job ID but still receive a page row; result
      // rows only exist for provider envelopes accepted into raw evidence.
      resultAttributions.push(...persistedResults);
      try {
        await persistSourceQueryExecution(client, summary);
      } catch {
        diagnostics.push("source execution telemetry persistence unavailable; provider ingestion and matching continued.");
      }
    } else {
      // No durable parent job means there is no safe idempotency scope for the
      // new telemetry tables. Keep the in-memory result links for this caller.
      resultAttributions.push(...persistedResults);
    }
    }
    queryTelemetry.push(queryTelemetryForRequest({
      request,
      source: input.sourceKey,
      pagesRequested: maxPages,
      pagesCompleted,
      cursorContinuationCount: boundedCursorContinuationCount(continuations, maxPages),
      continuationStoppedReason: queryError || continuationFailed ? "error" : cursor ? "page_cap_reached" : rawItems ? "no_cursor" : "zero_results",
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
    ...(captureSourceTelemetry ? { resultAttributions } : {}),
    ...(failedQueryCount ? { failedQueryCount, errorCode: firstQueryErrorCode } : {}),
    ...(Object.keys(providerMetrics).length ? { providerMetrics } : {}),
    ...(resolutions.length ? { resolutions } : {}),
  };
}
