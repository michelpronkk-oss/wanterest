import { z } from "zod";

import { jsonObjectSchema, omitUndefined, type Json, type JsonObject } from "../../db/database.helpers";
import type {
  ConversationInsert,
  EvidenceNodeInsert,
  EvidenceProvenanceInsert,
  JobRunInsert,
  RawSourceItemInsert,
  SourceHealthInsert,
  SourceItemInsert,
} from "../../db/database.helpers";
import { getTraceId } from "../../lib/request-context";
import {
  rawSourceItemEnvelopeSchema,
  sourceDiscoveryRequestSchema,
  sourceItemCandidateSchema,
  type RawSourceItemEnvelope,
  type SourceAdapter,
  type SourceHealthResult as SourceHealthContract,
  type RateLimitMetadata,
} from "../../providers/source/contracts";
import { createSourceRegistry } from "../../providers/source/registry";
import { enrichSourceMetadata } from "../geography/geo-enrichment";
import { contentHash, deterministicUuid, normalizedUrl, sha256Json } from "./hash";
import { replayInputSchema, type ReplayInput } from "./ingestion.schemas";
import type { IngestionRepository } from "./ingestion.repository";

export type SourceControlGate = { assertDiscoverable(sourceKey: string): Promise<void> };

const environment = process.env.NODE_ENV === "production" ? "production" : process.env.NODE_ENV === "test" ? "test" : "development";

function timestamp(): string {
  return new Date().toISOString();
}

function jsonObject(value: unknown): JsonObject {
  return jsonObjectSchema.parse(omitUndefined(value));
}

function sanitizedError(error: unknown): { code: string; summary: string; details: Record<string, Json | undefined> } {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "INGESTION_FAILED";
  const summary = error instanceof Error
    ? error.message.replace(/(authorization|bearer|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 500)
    : "Ingestion failed.";
  return { code, summary, details: { summary, code } };
}

export type DiscoveryResult = {
  jobRunId: string;
  sourceKey: string;
  rawInserted: number;
  rawDuplicates: number;
  rejected: number;
  rawSourceItemIds: string[];
  nextCursor?: string;
  rateLimit?: RateLimitMetadata;
  estimatedCost?: number;
  providerMetrics?: JsonObject;
  diagnostics: string[];
  resolutions?: NonNullable<Awaited<ReturnType<SourceAdapter["discover"]>>["diagnostics"]["resolutions"]>;
};

export type NormalizationResult = {
  jobRunId: string;
  rawSourceItemId: string;
  sourceItemId: string;
  normalizationVersion: string;
};

export type CanonicalizationResult = {
  jobRunId: string;
  sourceItemId: string;
  conversationId: string;
  conversationKey: string;
  relationType: string;
};

export class IngestionService {
  constructor(
    private readonly repository: IngestionRepository,
    private readonly registry = createSourceRegistry(),
    private readonly sourceControl?: SourceControlGate,
  ) {}

  async discoverSource(sourceKey: string, rawRequest: unknown, traceId = getTraceId()): Promise<DiscoveryResult> {
    const request = sourceDiscoveryRequestSchema.parse(rawRequest);
    if (this.sourceControl) await this.sourceControl.assertDiscoverable(sourceKey);
    const adapter = this.adapter(sourceKey);
    const requestHash = sha256Json({ sourceKey, request });
    const idempotencyKey = `discover:${sourceKey}:${requestHash}`;
    const existing = await this.repository.getJobRun("discover-source", idempotencyKey);
    if (existing?.status === "succeeded") return this.resultFromJob(existing.input_reference, existing.id) as DiscoveryResult;

    const job = await this.startJob({
      job_type: "discover-source",
      idempotency_key: idempotencyKey,
      input_reference: { sourceKey, request },
      trace_id: traceId,
    });
    const started = Date.now();
    try {
      const page = await adapter.discover(request);
      let rawInserted = 0;
      let rawDuplicates = 0;
      let rejected = 0;
      const rawSourceItemIds: string[] = [];
      const diagnostics = [...page.diagnostics.messages];
      for (const envelope of page.items) {
        const parsed = rawSourceItemEnvelopeSchema.safeParse(envelope);
        if (!parsed.success) {
          rejected += 1;
          diagnostics.push(`raw envelope rejected: ${parsed.error.issues[0]?.message ?? "invalid envelope"}`);
          continue;
        }
        const raw = parsed.data;
        const payloadHash = sha256Json(raw.payload);
        const rawId = deterministicUuid(`raw:${raw.sourceKey}:${raw.externalId}:${payloadHash}`);
        rawSourceItemIds.push(rawId);
        const evidenceNodeId = deterministicUuid(`evidence:raw_source_item:${rawId}`);
        const before = await this.repository.getRawSourceItem(rawId);
        const input: RawSourceItemInsert = {
          id: rawId,
          evidence_node_id: evidenceNodeId,
          source_key: raw.sourceKey,
          external_id: raw.externalId,
          fetched_at: raw.fetchedAt,
          payload_json: raw.payload,
          payload_uri: raw.payloadUri ?? null,
          payload_hash: payloadHash,
          fetch_job_run_id: job.id,
          request_metadata: raw.requestMetadata,
          cursor_context: raw.cursorContext,
        };
        const evidence: EvidenceNodeInsert = {
          id: evidenceNodeId,
          node_type: "raw_source_item",
          workspace_id: null,
          entity_table: "raw_source_items",
          entity_id: rawId,
          content_hash: payloadHash,
        };
        await this.repository.insertRawSourceItem(input, evidence);
        if (before) rawDuplicates += 1;
        else rawInserted += 1;
      }
      const result: DiscoveryResult = {
        jobRunId: job.id,
        sourceKey,
        rawInserted,
        rawDuplicates,
        rejected,
        rawSourceItemIds,
        nextCursor: page.nextCursor,
        rateLimit: page.rateLimit,
        estimatedCost: page.estimatedCost,
        ...(page.providerMetrics ? { providerMetrics: page.providerMetrics } : {}),
        diagnostics,
        ...(page.diagnostics.resolutions ? { resolutions: page.diagnostics.resolutions } : {}),
      };
      await this.repository.upsertSourceHealth(this.successHealth(sourceKey, Date.now() - started, page.rateLimit));
      await this.repository.updateJobRun(job.id, {
        status: "succeeded",
        completed_at: timestamp(),
        input_reference: jsonObject({ sourceKey, request, result }),
      });
      return result;
    } catch (error) {
      const failure = sanitizedError(error);
      await this.repository.upsertSourceHealth(await this.failureHealth(sourceKey, Date.now() - started, failure));
      await this.repository.updateJobRun(job.id, {
        status: "failed",
        completed_at: timestamp(),
        error_code: failure.code,
        error_details: failure.details,
      });
      throw error;
    }
  }

  async normalizeRawSourceItem(rawSourceItemId: string, normalizationVersion: string, traceId = getTraceId()): Promise<NormalizationResult> {
    const idempotencyKey = `normalize:${rawSourceItemId}:${normalizationVersion}`;
    const existing = await this.repository.getJobRun("normalize-source-items", idempotencyKey);
    if (existing?.status === "succeeded") return this.resultFromJob(existing.input_reference, existing.id) as NormalizationResult;
    const raw = await this.repository.getRawSourceItem(rawSourceItemId);
    if (!raw) throw new Error("Raw source item was not found.");
    const job = await this.startJob({
      job_type: "normalize-source-items",
      idempotency_key: idempotencyKey,
      input_reference: { rawSourceItemId, normalizationVersion },
      trace_id: traceId,
    });
    try {
      const adapter = this.adapter(raw.source_key);
      if (raw.payload_json === null) throw new Error("Raw source item has no replayable payload JSON.");
      const envelope: RawSourceItemEnvelope = {
        sourceKey: raw.source_key,
        externalId: raw.external_id,
        fetchedAt: raw.fetched_at,
        payload: raw.payload_json,
        payloadUri: raw.payload_uri ?? undefined,
        requestMetadata: jsonObject(raw.request_metadata),
        cursorContext: jsonObject(raw.cursor_context),
      };
      const candidate = sourceItemCandidateSchema.parse(adapter.normalize(envelope));
      const sourceItemId = deterministicUuid(`source-item:${candidate.sourceKey}:${candidate.externalId}`);
      const evidenceNodeId = deterministicUuid(`evidence:source_item:${sourceItemId}`);
      // Geo is optional enrichment on normalized source evidence. It is persisted with
      // the source item so page reads do not repeatedly resolve the same public field.
      const enrichedCandidate = {
        ...candidate,
        metadata: enrichSourceMetadata(candidate.metadata, { sourceKey: candidate.sourceKey, language: candidate.language ?? null }),
      };
      const normalizedContentHash = contentHash(enrichedCandidate);
      const input: SourceItemInsert = {
        id: sourceItemId,
        evidence_node_id: evidenceNodeId,
        source_key: enrichedCandidate.sourceKey,
        external_id: enrichedCandidate.externalId,
        external_conversation_id: enrichedCandidate.externalConversationId ?? null,
        canonical_url: enrichedCandidate.canonicalUrl ?? null,
        author_external_id: enrichedCandidate.authorExternalId ?? null,
        author_display_name: enrichedCandidate.authorDisplayName ?? null,
        author_profile_url: enrichedCandidate.authorProfileUrl ?? null,
        title: enrichedCandidate.title ?? null,
        body: enrichedCandidate.body,
        published_at: enrichedCandidate.publishedAt ?? null,
        captured_at: enrichedCandidate.capturedAt,
        language: enrichedCandidate.language ?? null,
        metadata: enrichedCandidate.metadata,
        content_hash: normalizedContentHash,
        latest_raw_source_item_id: raw.id,
        normalization_version: normalizationVersion,
        status: enrichedCandidate.status,
      };
      const evidence: EvidenceNodeInsert = {
        id: evidenceNodeId,
        node_type: "source_item",
        workspace_id: null,
        entity_table: "source_items",
        entity_id: sourceItemId,
        content_hash: normalizedContentHash,
      };
      await this.repository.upsertSourceItem(input, evidence);
      const provenance: EvidenceProvenanceInsert = {
        id: deterministicUuid(`provenance:${evidenceNodeId}:${raw.evidence_node_id}:normalized_from`),
        derived_evidence_node_id: evidenceNodeId,
        source_evidence_node_id: raw.evidence_node_id,
        relation_type: "normalized_from",
        weight: 1,
        ordinal: 0,
        span: null,
        measurement: { normalizationVersion },
        engine_version_id: null,
      };
      await this.repository.insertEvidenceProvenance(provenance);
      const result: NormalizationResult = { jobRunId: job.id, rawSourceItemId, sourceItemId, normalizationVersion };
      await this.repository.updateJobRun(job.id, { status: "succeeded", completed_at: timestamp(), input_reference: jsonObject({ rawSourceItemId, normalizationVersion, result }) });
      return result;
    } catch (error) {
      const failure = sanitizedError(error);
      await this.repository.updateJobRun(job.id, { status: "failed", completed_at: timestamp(), error_code: failure.code, error_details: failure.details });
      throw error;
    }
  }

  async canonicalizeSourceItem(sourceItemId: string, canonicalizationVersion: string, traceId = getTraceId()): Promise<CanonicalizationResult> {
    const idempotencyKey = `canonicalize:${sourceItemId}:${canonicalizationVersion}`;
    const existing = await this.repository.getJobRun("dedupe-conversations", idempotencyKey);
    if (existing?.status === "succeeded") return this.resultFromJob(existing.input_reference, existing.id) as CanonicalizationResult;
      const sourceItem = await this.repository.getSourceItem(sourceItemId);
    if (!sourceItem) throw new Error("Source item was not found.");
    const job = await this.startJob({
      job_type: "dedupe-conversations",
      idempotency_key: idempotencyKey,
      input_reference: { sourceItemId, canonicalizationVersion },
      trace_id: traceId,
    });
    try {
      const identity = this.conversationIdentity(sourceItem);
      let conversation = await this.repository.findConversationByKey(identity.key);
      const matchedByIdentity = Boolean(conversation);
      if (!conversation && identity.contentHashCandidate) {
        conversation = await this.repository.findConversationByContentHash(sourceItem.content_hash);
      }
      const relationType = conversation && identity.contentHashCandidate && !matchedByIdentity
        ? "content_hash"
        : identity.relationType;
      const conversationId = conversation?.id ?? deterministicUuid(`conversation:${identity.key}`);
      const evidenceNodeId = conversation?.evidence_node_id ?? deterministicUuid(`evidence:conversation:${conversationId}`);
      const isNew = !conversation;
      const currentPrimary = conversation ? await this.repository.getSourceItem(conversation.primary_source_item_id) : null;
      const isPrimary = isNew || this.shouldPreferPrimary(sourceItem, currentPrimary);
      const primarySourceItemId = isPrimary ? sourceItem.id : conversation!.primary_source_item_id;
      const input: ConversationInsert = {
        id: conversationId,
        evidence_node_id: evidenceNodeId,
        conversation_key: conversation?.conversation_key ?? identity.key,
        primary_source_item_id: primarySourceItemId,
        canonical_url: isPrimary ? sourceItem.canonical_url : conversation?.canonical_url ?? null,
        author_external_id: isPrimary ? sourceItem.author_external_id : conversation?.author_external_id ?? null,
        author_display_name: isPrimary ? sourceItem.author_display_name : conversation?.author_display_name ?? null,
        author_profile_url: isPrimary ? sourceItem.author_profile_url : conversation?.author_profile_url ?? null,
        title: isPrimary ? sourceItem.title : conversation?.title ?? null,
        body: isPrimary ? sourceItem.body : conversation?.body ?? "",
        published_at: isPrimary ? sourceItem.published_at : conversation?.published_at ?? null,
        last_activity_at: this.latestTimestamp(conversation?.last_activity_at, sourceItem.published_at ?? sourceItem.captured_at),
        captured_at: sourceItem.captured_at,
        language: isPrimary ? sourceItem.language : conversation?.language ?? null,
        metadata: isPrimary ? sourceItem.metadata : conversation?.metadata ?? {},
        content_hash: isPrimary ? sourceItem.content_hash : conversation?.content_hash ?? sourceItem.content_hash,
        canonicalization_version: canonicalizationVersion,
      };
      const evidence: EvidenceNodeInsert = {
        id: evidenceNodeId,
        node_type: "conversation",
        workspace_id: null,
        entity_table: "conversations",
        entity_id: conversationId,
        content_hash: input.content_hash,
      };
      conversation = await this.repository.upsertConversation(input, evidence);
      if (isPrimary) await this.repository.clearConversationPrimary(conversation.id);
      await this.repository.upsertConversationSourceItem({
        conversation_id: conversation.id,
        source_item_id: sourceItem.id,
        relation_type: relationType,
        is_primary: conversation.primary_source_item_id === sourceItem.id,
        dedupe_evidence: {
          strategy: relationType,
          conversationKey: conversation.conversation_key,
          sourceKey: sourceItem.source_key,
          externalId: sourceItem.external_id,
          contentHash: sourceItem.content_hash,
        },
      });
      await this.repository.insertEvidenceProvenance({
        id: deterministicUuid(`provenance:${conversation.evidence_node_id}:${sourceItem.evidence_node_id}:contains`),
        derived_evidence_node_id: conversation.evidence_node_id,
        source_evidence_node_id: sourceItem.evidence_node_id,
        relation_type: "contains_source_item",
        weight: 1,
        ordinal: 0,
        span: null,
        measurement: { canonicalizationVersion, relationType },
        engine_version_id: null,
      });
      const result: CanonicalizationResult = {
        jobRunId: job.id,
        sourceItemId,
        conversationId: conversation.id,
        conversationKey: conversation.conversation_key,
        relationType,
      };
      await this.repository.updateJobRun(job.id, { status: "succeeded", completed_at: timestamp(), input_reference: jsonObject({ sourceItemId, canonicalizationVersion, result }) });
      return result;
    } catch (error) {
      const failure = sanitizedError(error);
      await this.repository.updateJobRun(job.id, { status: "failed", completed_at: timestamp(), error_code: failure.code, error_details: failure.details });
      throw error;
    }
  }

  async replay(rawInput: unknown): Promise<{ normalized: number; canonicalized: number; failed: number; rawItems: number }> {
    const result = await this.replayDetailed(rawInput);
    return { normalized: result.normalized, canonicalized: result.canonicalized, failed: result.failed, rawItems: result.rawItems };
  }

  async replayDetailed(rawInput: unknown): Promise<{
    normalized: number;
    canonicalized: number;
    failed: number;
    rawItems: number;
    normalizedSourceItemIds: string[];
    canonicalizedConversationIds: string[];
    replayMappings: Array<{ rawSourceItemId: string; sourceItemId: string; conversationId: string }>;
  }> {
    const input: ReplayInput = replayInputSchema.parse(rawInput);
    const rawItems = input.rawSourceItemIds
      ? (await Promise.all(input.rawSourceItemIds.map((id) => this.repository.getRawSourceItem(id)))).filter((item): item is NonNullable<typeof item> => Boolean(item))
      : await this.repository.listRawSourceItems({ sourceKey: input.sourceKey, from: input.from, to: input.to, limit: input.limit });
    let normalized = 0;
    let canonicalized = 0;
    let failed = 0;
    const normalizedSourceItemIds: string[] = [];
    const canonicalizedConversationIds: string[] = [];
    const replayMappings: Array<{ rawSourceItemId: string; sourceItemId: string; conversationId: string }> = [];
    for (const raw of rawItems) {
      try {
        const normalization = await this.normalizeRawSourceItem(raw.id, input.normalizationVersion, input.traceId);
        normalized += 1;
        normalizedSourceItemIds.push(normalization.sourceItemId);
        const canonicalization = await this.canonicalizeSourceItem(normalization.sourceItemId, input.canonicalizationVersion, input.traceId);
        canonicalized += 1;
        canonicalizedConversationIds.push(canonicalization.conversationId);
        replayMappings.push({ rawSourceItemId: raw.id, sourceItemId: normalization.sourceItemId, conversationId: canonicalization.conversationId });
      } catch {
        failed += 1;
      }
    }
    return { normalized, canonicalized, failed, rawItems: rawItems.length, normalizedSourceItemIds, canonicalizedConversationIds, replayMappings };
  }

  async healthCheck(sourceKey: string): Promise<SourceHealthContract> {
    const adapter = this.adapter(sourceKey);
    const result = await adapter.healthCheck();
    const failure = result.ok ? undefined : { code: result.errorCode ?? "HEALTH_CHECK_FAILED", summary: result.errorSummary ?? "Source health check failed.", details: { summary: result.errorSummary ?? "Source health check failed." } };
    await this.repository.upsertSourceHealth(
      result.ok
        ? this.successHealth(sourceKey, result.latencyMs, result.rateLimit)
        : await this.failureHealth(sourceKey, result.latencyMs, failure!),
    );
    return result;
  }

  private adapter(sourceKey: string): SourceAdapter {
    const adapter = this.registry.get(sourceKey);
    if (!adapter) throw new Error(`Unknown source adapter: ${sourceKey}`);
    return adapter;
  }

  private async startJob(input: Pick<JobRunInsert, "job_type" | "idempotency_key" | "input_reference" | "trace_id"> & Partial<Pick<JobRunInsert, "workspace_id" | "product_id" | "trigger_run_id" | "started_at" | "completed_at" | "error_code" | "error_details">>) {
    const safeInput = { ...input, input_reference: jsonObject(input.input_reference) };
    const existing = await this.repository.getJobRun(safeInput.job_type, safeInput.idempotency_key);
    if (existing?.status === "running") return existing;
    const job = await this.repository.createJobRun({ ...safeInput, status: "running", attempt_count: (existing?.attempt_count ?? 0) + 1, started_at: timestamp() });
    return job.status === "running" ? job : this.repository.updateJobRun(job.id, { status: "running", started_at: timestamp(), attempt_count: job.attempt_count + 1 });
  }

  private resultFromJob(value: Json, jobRunId: string): Json {
    const parsed = z.object({ result: z.unknown() }).safeParse(value);
    if (!parsed.success) throw new Error("Successful job run has no stored result.");
    const result = z.record(z.string(), z.json()).safeParse(parsed.data.result);
    if (!result.success) throw new Error("Successful job result is invalid.");
    return { ...result.data, jobRunId };
  }

  private conversationIdentity(sourceItem: { source_key: string; external_id: string; external_conversation_id: string | null; canonical_url: string | null; content_hash: string }): { key: string; relationType: string; contentHashCandidate: boolean } {
    if (sourceItem.external_conversation_id) return { key: `${sourceItem.source_key}:thread:${sourceItem.external_conversation_id}`, relationType: "provider_thread", contentHashCandidate: false };
    if (sourceItem.canonical_url) return { key: `url:${sha256Json(normalizedUrl(sourceItem.canonical_url))}`, relationType: "canonical_url", contentHashCandidate: true };
    return { key: `${sourceItem.source_key}:item:${sourceItem.external_id}`, relationType: "provider_identity", contentHashCandidate: true };
  }

  private latestTimestamp(previous: string | null | undefined, current: string): string {
    return previous && previous > current ? previous : current;
  }

  private shouldPreferPrimary(
    sourceItem: { source_key: string; external_id: string; external_conversation_id: string | null },
    currentPrimary: { source_key: string; external_id: string; external_conversation_id: string | null } | null,
  ): boolean {
    if (!currentPrimary) return true;
    const isProviderRoot = sourceItem.external_conversation_id === sourceItem.external_id;
    const currentIsProviderRoot = currentPrimary.external_conversation_id === currentPrimary.external_id;
    if (isProviderRoot !== currentIsProviderRoot) return isProviderRoot;
    return `${sourceItem.source_key}:${sourceItem.external_id}` < `${currentPrimary.source_key}:${currentPrimary.external_id}`;
  }

  private successHealth(sourceKey: string, latencyMs: number, rateLimit?: Json): SourceHealthInsert {
    return {
      source_key: sourceKey,
      environment,
      last_success_at: timestamp(),
      last_failure_at: null,
      last_latency_ms: latencyMs,
      rate_limit_state: rateLimit ?? {},
      degradation_state: "healthy",
      latest_error_code: null,
      latest_error_summary: null,
      updated_at: timestamp(),
    };
  }

  private async failureHealth(sourceKey: string, latencyMs: number, failure: { code: string; summary: string; details: Record<string, Json | undefined> }): Promise<SourceHealthInsert> {
    const previous = await this.repository.getSourceHealth(sourceKey, environment);
    return {
      source_key: sourceKey,
      environment,
      last_success_at: previous?.last_success_at ?? null,
      last_failure_at: timestamp(),
      last_latency_ms: latencyMs,
      rate_limit_state: previous?.rate_limit_state ?? {},
      degradation_state: ["RATE_LIMITED", "INSUFFICIENT_CREDITS"].includes(failure.code) ? "blocked" : "degraded",
      latest_error_code: failure.code,
      latest_error_summary: failure.summary,
      updated_at: timestamp(),
    };
  }
}
