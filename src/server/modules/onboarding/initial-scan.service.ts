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
import { SupabaseIntelligenceRepository } from "@/server/modules/intelligence/intelligence.repository";
import { IntelligenceService } from "@/server/modules/intelligence/intelligence.service";
import { FixtureConversationAnalysisEngine, FixtureProductMatchingEngine } from "@/server/modules/intelligence/engines";
import { ensureEngineVersion } from "@/server/modules/observability/engine.repository";
import { getTraceId } from "@/server/lib/request-context";

type Client = SupabaseClient<Database>;

const scanResultSchema = z.object({
  state: z.enum(["complete", "complete_no_signals"]),
  rawItems: z.number().int().nonnegative(),
  conversations: z.number().int().nonnegative(),
  analyses: z.number().int().nonnegative(),
  evaluations: z.number().int().nonnegative(),
  rankings: z.number().int().nonnegative(),
  signals: z.number().int().nonnegative(),
  sources: z.array(z.string()),
  diagnostics: z.array(z.object({ sourceKey: z.string(), state: z.string(), message: z.string().optional() })),
});

export type InitialScanResult = z.infer<typeof scanResultSchema>;

export type InitialScanJobState = {
  status: string;
  phase: string;
  result: InitialScanResult | null;
  errorMessage: string | null;
};

function publicFailure(error: unknown): string {
  const appError = toPublicError(error);
  return appError.code === "INTERNAL_ERROR" ? "The first scan could not be completed. Please try again." : appError.message;
}

function safeSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : "Provider request failed.";
  return message.replace(/(authorization|bearer|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 240);
}

function jsonStrings(value: Json): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function scanJobKey(workspaceId: string, productId: string): string {
  return `initial-scan:${workspaceId}:${productId}`;
}

async function loadScanJob(client: Client, workspaceId: string, productId: string) {
  const { data, error } = await client
    .from("job_runs")
    .select("*")
    .eq("job_type", "discover-source")
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .eq("idempotency_key", scanJobKey(workspaceId, productId))
    .maybeSingle();
  if (error) throw new AppError("INTERNAL_ERROR", "The first-scan status could not be loaded.");
  return data;
}

async function setScanJob(client: Client, id: string, input: { status?: string; phase: string; result?: InitialScanResult | null; errorCode?: string | null; errorMessage?: string | null; completed?: boolean }) {
  const reference = jsonObjectSchema.parse({
    workflow: "initial-scan",
    phase: input.phase,
    result: input.result,
    errorMessage: input.errorMessage ?? null,
  });
  const { error } = await client.from("job_runs").update({
    status: input.status,
    input_reference: reference,
    error_code: input.errorCode ?? null,
    error_details: input.errorMessage ? { message: input.errorMessage } : null,
    completed_at: input.completed ? new Date().toISOString() : null,
    terminal_at: input.completed ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) throw new AppError("INTERNAL_ERROR", "The first-scan status could not be saved.");
}

async function createOrResumeScanJob(client: Client, workspaceId: string, productId: string, traceId: string) {
  const existing = await loadScanJob(client, workspaceId, productId);
  if (existing?.status === "succeeded") return { job: existing, alreadyComplete: true };
  if (existing) {
    const { data, error } = await client.from("job_runs").update({ status: "running", attempt_count: existing.attempt_count + 1, started_at: new Date().toISOString(), completed_at: null, terminal_at: null, error_code: null, error_details: null }).eq("id", existing.id).select("*").single();
    if (error || !data) throw new AppError("INTERNAL_ERROR", "The first scan could not be started.");
    await setScanJob(client, data.id, { status: "running", phase: "preparing" });
    return { job: data, alreadyComplete: false };
  }
  const { data, error } = await client.from("job_runs").insert({
    job_type: "discover-source",
    workspace_id: workspaceId,
    product_id: productId,
    idempotency_key: scanJobKey(workspaceId, productId),
    input_reference: jsonObjectSchema.parse({ workflow: "initial-scan", phase: "preparing", result: null }),
    status: "running",
    attempt_count: 1,
    started_at: new Date().toISOString(),
    trace_id: traceId,
  }).select("*").single();
  if (error || !data) throw new AppError("INTERNAL_ERROR", "The first scan could not be started.");
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

export async function getInitialScanState(workspaceId: string, productId: string): Promise<InitialScanJobState | null> {
  const job = await loadScanJob(createSupabaseServiceClient(), workspaceId, productId);
  if (!job) return null;
  const reference = job.input_reference && typeof job.input_reference === "object" && !Array.isArray(job.input_reference) ? job.input_reference : {};
  const resultValue = "result" in reference && reference.result && typeof reference.result === "object" ? scanResultSchema.safeParse(reference.result) : null;
  return {
    status: job.status,
    phase: typeof reference.phase === "string" ? reference.phase : "preparing",
    result: resultValue?.success ? resultValue.data : null,
    errorMessage: typeof reference.errorMessage === "string" ? reference.errorMessage : job.error_code ? "The first scan could not be completed. Please try again." : null,
  };
}

export async function runInitialScan(product: ProductRow, traceId = getTraceId()): Promise<InitialScanResult> {
  const client = createSupabaseServiceClient();
  const { job, alreadyComplete } = await createOrResumeScanJob(client, product.workspace_id, product.id, traceId);
  if (alreadyComplete) {
    const state = await getInitialScanState(product.workspace_id, product.id);
    if (state?.result) return state.result;
  }

  const ingestion = new IngestionService(new SupabaseIngestionRepository(client), undefined, new SourceControlService(new SupabaseSourceControlStore(client)));
  const controls = new SourceControlService(new SupabaseSourceControlStore(client));
  const registry = createSourceRegistry();
  const configuredReddit = getRedditRuntimeConfig();
  const intelligenceRepository = new SupabaseIntelligenceRepository(client);
  const profile = product.current_demand_profile_id ? await intelligenceRepository.getDemandProfileById(product.current_demand_profile_id) : null;
  if (!profile) {
    const message = "A demand profile is required before the first scan.";
    await setScanJob(client, job.id, { status: "failed", phase: "failed", errorCode: "VALIDATION_ERROR", errorMessage: message, completed: true });
    throw new AppError("VALIDATION_ERROR", message);
  }
  const queryTerms = jsonStrings(profile.include_terms);
  const sourceKeys = [...registry.keys()].filter((key) => key !== "fixture");
  const sources: string[] = [];
  const diagnostics: InitialScanResult["diagnostics"] = [];
  const rawSourceItemIds: string[] = [];
  const normalizedSourceItemIds: string[] = [];
  const conversationIds: string[] = [];

  try {
    await setScanJob(client, job.id, { status: "running", phase: "discovering" });
    for (const sourceKey of sourceKeys) {
      const control = await controls.get(sourceKey);
      if (control.state !== "enabled") {
        diagnostics.push({ sourceKey, state: "skipped", message: `Source is ${control.state}.` });
        continue;
      }
      if (sourceKey === "reddit" && (!configuredReddit.clientId || !configuredReddit.clientSecret || !configuredReddit.userAgent)) {
        diagnostics.push({ sourceKey, state: "skipped", message: "Reddit credentials are not configured." });
        continue;
      }
      sources.push(sourceKey);
      try {
        const query = sourceKey === "bluesky" || sourceKey === "reddit"
          ? [product.name, ...queryTerms.slice(0, 5)].join(" ").slice(0, 180)
          : undefined;
        const discovery = await ingestion.discoverSource(sourceKey, { limit: 5, ...(query ? { query } : {}) });
        rawSourceItemIds.push(...discovery.rawSourceItemIds);
        const replay = await ingestion.replayDetailed({ rawSourceItemIds: discovery.rawSourceItemIds, normalizationVersion: `${sourceKey}-v1`, canonicalizationVersion: "canonical-v1", limit: 100 });
        normalizedSourceItemIds.push(...replay.normalizedSourceItemIds);
        conversationIds.push(...replay.canonicalizedConversationIds);
        diagnostics.push({ sourceKey, state: "complete", message: `${discovery.rawInserted} new raw item${discovery.rawInserted === 1 ? "" : "s"}.` });
      } catch (error) {
        diagnostics.push({ sourceKey, state: "failed", message: safeSummary(error) });
      }
      await setScanJob(client, job.id, { status: "running", phase: "discovering" });
    }
    if (!sources.length || !conversationIds.length) throw new AppError("CONFLICT", "No usable source results were available for the first scan.");

    await setScanJob(client, job.id, { status: "running", phase: "analyzing" });
    const rows = await loadRows(client, [...new Set(normalizedSourceItemIds)], [...new Set(conversationIds)]);
    const sourceById = new Map(rows.sourceItems.map((item) => [item.id, item]));
    const intelligence = new IntelligenceService(intelligenceRepository);
    const classifier = new FixtureConversationAnalysisEngine();
    const matcher = new FixtureProductMatchingEngine();
    const classifierVersion = await ensureEngineVersion(client, { engine_type: "classifier", version: classifier.version, model: "deterministic", prompt_version: classifier.version, config_hash: null, metadata: { workflow: "initial-scan" } });
    const matcherVersion = await ensureEngineVersion(client, { engine_type: "matcher", version: matcher.version, model: "deterministic", prompt_version: matcher.version, config_hash: null, metadata: { workflow: "initial-scan" } });
    const rankerVersion = await ensureEngineVersion(client, { engine_type: "ranker", version: "ranking-v1", model: "deterministic", prompt_version: "ranking-v1", config_hash: null, metadata: { workflow: "initial-scan" } });
    const analyses = [];
    for (const conversation of rows.conversations) {
      const sourceItem = sourceById.get(conversation.primary_source_item_id);
      if (!sourceItem) continue;
      try {
        analyses.push(await intelligence.analyzeConversation(conversation, sourceItem, classifierVersion.id, classifier));
      } catch (error) {
        diagnostics.push({ sourceKey: sourceItem.source_key, state: "failed", message: `Analysis skipped: ${safeSummary(error)}` });
      }
    }
    if (!analyses.length) throw new AppError("CONFLICT", "No usable conversations were available for analysis.");

    await setScanJob(client, job.id, { status: "running", phase: "matching" });
    const evaluations = [];
    for (const analysis of analyses) {
      try {
        evaluations.push(await intelligence.matchProduct(product, profile.id, analysis.id, matcherVersion.id, matcher));
      } catch (error) {
        diagnostics.push({ sourceKey: "matching", state: "failed", message: safeSummary(error) });
      }
    }
    await setScanJob(client, job.id, { status: "running", phase: "ranking" });
    const rankings = [];
    const signals = [];
    for (const evaluation of evaluations) {
      try {
        const ranking = await intelligence.rankEvaluation(product, evaluation.id, rankerVersion.id);
        rankings.push(ranking);
        const signal = await intelligence.materializeSignal(product, evaluation.id, ranking.id);
        if (signal) signals.push(signal);
      } catch (error) {
        diagnostics.push({ sourceKey: "signals", state: "failed", message: safeSummary(error) });
      }
    }

    const result: InitialScanResult = {
      state: signals.length ? "complete" : "complete_no_signals",
      rawItems: rawSourceItemIds.length,
      conversations: rows.conversations.length,
      analyses: analyses.length,
      evaluations: evaluations.length,
      rankings: rankings.length,
      signals: signals.length,
      sources,
      diagnostics,
    };
    await setScanJob(client, job.id, { status: "succeeded", phase: result.state, result, completed: true });
    return result;
  } catch (error) {
    const message = publicFailure(error);
    await setScanJob(client, job.id, { status: "failed", phase: "failed", errorCode: error instanceof AppError ? error.code : "INITIAL_SCAN_FAILED", errorMessage: message, completed: true });
    throw error;
  }
}
