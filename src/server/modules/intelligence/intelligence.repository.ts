import type {
  ConversationAnalysisEvidenceInsert,
  ConversationAnalysisEvidenceRow,
  ConversationAnalysisInsert,
  ConversationAnalysisRow,
  ConversationRow,
  DemandProfileInsert,
  DemandProfileRow,
  DemandProfileSnapshotInputInsert,
  MatchFeedbackInsert,
  MatchFeedbackRow,
  MatchRankingInsert,
  MatchRankingRow,
  ProductMatchEvaluationInsert,
  ProductMatchEvaluationRow,
  ProductMatchInsert,
  ProductMatchRow,
  ProductRow,
  ProductSnapshotInsert,
  ProductSnapshotRow,
  SignalInsert,
  SignalRow,
  SignalUpdate,
  SourceItemRow,
  Json,
} from "../../db/database.helpers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/database.types";
import { AppError } from "../../lib/errors";

export interface IntelligenceRepository {
  getProduct(productId: string): Promise<ProductRow | null>;
  getProductSnapshots(productId: string): Promise<ProductSnapshotRow[]>;
  createProductSnapshot(input: ProductSnapshotInsert): Promise<ProductSnapshotRow>;
  setCurrentSnapshot(productId: string, snapshotId: string): Promise<void>;
  getDemandProfiles(productId: string): Promise<DemandProfileRow[]>;
  getDemandProfileById(profileId: string): Promise<DemandProfileRow | null>;
  createDemandProfile(input: DemandProfileInsert, snapshotInputs: DemandProfileSnapshotInputInsert[]): Promise<DemandProfileRow>;
  setCurrentDemandProfile(productId: string, profileId: string): Promise<void>;
  getConversation(conversationId: string): Promise<ConversationRow | null>;
  getSourceItem(sourceItemId: string): Promise<SourceItemRow | null>;
  getConversationAnalysis(conversationId: string, engineVersionId: string, inputFingerprint: string): Promise<ConversationAnalysisRow | null>;
  getConversationAnalysisById(analysisId: string): Promise<ConversationAnalysisRow | null>;
  createConversationAnalysis(input: ConversationAnalysisInsert, spans: ConversationAnalysisEvidenceInsert[]): Promise<ConversationAnalysisRow>;
  getMatch(workspaceId: string, productId: string, conversationId: string): Promise<ProductMatchRow | null>;
  getMatchById(matchId: string): Promise<ProductMatchRow | null>;
  createMatch(input: ProductMatchInsert): Promise<ProductMatchRow>;
  getEvaluation(productMatchId: string, engineVersionId: string, inputFingerprint: string): Promise<ProductMatchEvaluationRow | null>;
  createEvaluation(input: ProductMatchEvaluationInsert): Promise<ProductMatchEvaluationRow>;
  setCurrentEvaluation(matchId: string, evaluationId: string): Promise<void>;
  getRanking(evaluationId: string, engineVersionId: string, inputFingerprint: string): Promise<MatchRankingRow | null>;
  createRanking(input: MatchRankingInsert): Promise<MatchRankingRow>;
  getSignalByMatch(matchId: string): Promise<SignalRow | null>;
  listSignals(workspaceId: string, productId?: string): Promise<SignalRow[]>;
  getSignal(signalId: string): Promise<SignalRow | null>;
  getEvaluationById(evaluationId: string): Promise<ProductMatchEvaluationRow | null>;
  getRankingById(rankingId: string): Promise<MatchRankingRow | null>;
  createSignal(input: SignalInsert): Promise<SignalRow>;
  updateSignal(signalId: string, input: SignalUpdate): Promise<SignalRow>;
  createFeedback(input: MatchFeedbackInsert): Promise<MatchFeedbackRow>;
  listFeedback(signalId: string): Promise<MatchFeedbackRow[]>;
  consumeSignalUsage(workspaceId: string, idempotencyKey: string): Promise<void>;
  linkProvenance(input: { derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; weight?: number; ordinal?: number; span?: Json | null; measurement?: Json | null; engineVersionId?: string | null }): Promise<void>;
}

type SupabaseIntelligenceClient = SupabaseClient<Database>;

function dbError(error: { code?: string; message: string }, message: string): AppError {
  if (error.code === "23505") return new AppError("CONFLICT", message);
  if (error.code === "42501" || error.message.includes("workspace_access_denied")) return new AppError("FORBIDDEN", "You cannot use this workspace.");
  if (error.code === "22003" || error.message.includes("usage_limit_exceeded")) return new AppError("USAGE_LIMIT_EXCEEDED", "The workspace signal limit was reached.");
  return new AppError("INTERNAL_ERROR", message, 500, { providerMessage: error.message });
}

export class SupabaseIntelligenceRepository implements IntelligenceRepository {
  constructor(private readonly client: SupabaseIntelligenceClient) {}

  private async evidence(id: string, nodeType: string, workspaceId: string | null, entityTable: string, entityId: string, contentHash?: string | null) {
    const { error } = await this.client.from("evidence_nodes").upsert({ id, node_type: nodeType, workspace_id: workspaceId, entity_table: entityTable, entity_id: entityId, content_hash: contentHash ?? null }, { onConflict: "entity_table,entity_id", ignoreDuplicates: true });
    if (error) throw dbError(error, "Evidence anchor could not be stored.");
  }

  async getProduct(productId: string) { const { data, error } = await this.client.from("products").select("*").eq("id", productId).maybeSingle(); if (error) throw dbError(error, "Product could not be loaded."); return data; }
  async getProductSnapshots(productId: string) { const { data, error } = await this.client.from("product_snapshots").select("*").eq("product_id", productId).order("snapshot_version", { ascending: true }); if (error) throw dbError(error, "Product snapshots could not be loaded."); return data ?? []; }
  async createProductSnapshot(input: ProductSnapshotInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(input.evidence_node_id, "product_snapshot", input.workspace_id, "product_snapshots", id, input.content_hash); const { data, error } = await this.client.from("product_snapshots").insert({ ...input, id }).select("*").single(); if (error || !data) throw dbError(error ?? { message: "No snapshot returned." }, "Product snapshot could not be stored."); return data; }
  async setCurrentSnapshot(productId: string, snapshotId: string) { const { error } = await this.client.from("products").update({ current_snapshot_id: snapshotId }).eq("id", productId); if (error) throw dbError(error, "Current product snapshot could not be updated."); }
  async getDemandProfiles(productId: string) { const { data, error } = await this.client.from("demand_profiles").select("*").eq("product_id", productId).order("profile_version", { ascending: true }); if (error) throw dbError(error, "Demand profiles could not be loaded."); return data ?? []; }
  async getDemandProfileById(profileId: string) { const { data, error } = await this.client.from("demand_profiles").select("*").eq("id", profileId).maybeSingle(); if (error) throw dbError(error, "Demand profile could not be loaded."); return data; }
  async createDemandProfile(input: DemandProfileInsert, snapshotInputs: DemandProfileSnapshotInputInsert[]) { const id = input.id ?? crypto.randomUUID(); await this.evidence(input.evidence_node_id, "demand_profile", input.workspace_id, "demand_profiles", id); const { data, error } = await this.client.from("demand_profiles").insert({ ...input, id }).select("*").single(); if (error || !data) throw dbError(error ?? { message: "No profile returned." }, "Demand profile could not be stored."); if (snapshotInputs.length) { const { error: inputError } = await this.client.from("demand_profile_snapshot_inputs").insert(snapshotInputs.map((item) => ({ ...item, demand_profile_id: data.id }))); if (inputError) throw dbError(inputError, "Demand profile inputs could not be stored."); } return data; }
  async setCurrentDemandProfile(productId: string, profileId: string) { const { error } = await this.client.from("products").update({ current_demand_profile_id: profileId }).eq("id", productId); if (error) throw dbError(error, "Current demand profile could not be updated."); }
  async getConversation(conversationId: string) { const { data, error } = await this.client.from("conversations").select("*").eq("id", conversationId).maybeSingle(); if (error) throw dbError(error, "Conversation could not be loaded."); return data; }
  async getSourceItem(sourceItemId: string) { const { data, error } = await this.client.from("source_items").select("*").eq("id", sourceItemId).maybeSingle(); if (error) throw dbError(error, "Source item could not be loaded."); return data; }
  async getConversationAnalysis(conversationId: string, engineVersionId: string, inputFingerprint: string) { const { data, error } = await this.client.from("conversation_analysis").select("*").eq("conversation_id", conversationId).eq("engine_version_id", engineVersionId).eq("input_fingerprint", inputFingerprint).maybeSingle(); if (error) throw dbError(error, "Conversation analysis could not be loaded."); return data; }
  async getConversationAnalysisById(analysisId: string) { const { data, error } = await this.client.from("conversation_analysis").select("*").eq("id", analysisId).maybeSingle(); if (error) throw dbError(error, "Conversation analysis could not be loaded."); return data; }
  async createConversationAnalysis(input: ConversationAnalysisInsert, spans: ConversationAnalysisEvidenceInsert[]) { const id = input.id ?? crypto.randomUUID(); await this.evidence(input.evidence_node_id, "conversation_analysis", null, "conversation_analysis", id); const { data, error } = await this.client.from("conversation_analysis").insert({ ...input, id }).select("*").single(); if (error || !data) throw dbError(error ?? { message: "No analysis returned." }, "Conversation analysis could not be stored."); if (spans.length) { const { error: spanError } = await this.client.from("conversation_analysis_evidence").insert(spans.map((span) => ({ ...span, analysis_id: data.id }))); if (spanError) throw dbError(spanError, "Analysis evidence could not be stored."); } return data; }
  async getMatch(workspaceId: string, productId: string, conversationId: string) { const { data, error } = await this.client.from("product_matches").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("conversation_id", conversationId).maybeSingle(); if (error) throw dbError(error, "Product match could not be loaded."); return data; }
  async getMatchById(matchId: string) { const { data, error } = await this.client.from("product_matches").select("*").eq("id", matchId).maybeSingle(); if (error) throw dbError(error, "Product match could not be loaded."); return data; }
  async createMatch(input: ProductMatchInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(input.evidence_node_id, "match", input.workspace_id, "product_matches", id); const { data, error } = await this.client.from("product_matches").insert({ ...input, id }).select("*").single(); if (error) { if (error.code === "23505") { const existing = await this.getMatch(input.workspace_id, input.product_id, input.conversation_id); if (existing) return existing; } throw dbError(error, "Product match could not be stored."); } if (!data) throw dbError({ message: "No match returned." }, "Product match could not be stored."); return data; }
  async getEvaluation(productMatchId: string, engineVersionId: string, inputFingerprint: string) { const { data, error } = await this.client.from("product_match_evaluations").select("*").eq("product_match_id", productMatchId).eq("match_engine_version_id", engineVersionId).eq("input_fingerprint", inputFingerprint).maybeSingle(); if (error) throw dbError(error, "Match evaluation could not be loaded."); return data; }
  async getEvaluationById(evaluationId: string) { const { data, error } = await this.client.from("product_match_evaluations").select("*").eq("id", evaluationId).maybeSingle(); if (error) throw dbError(error, "Match evaluation could not be loaded."); return data; }
  async createEvaluation(input: ProductMatchEvaluationInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(input.evidence_node_id, "match_evaluation", input.workspace_id, "product_match_evaluations", id); const { data, error } = await this.client.from("product_match_evaluations").insert({ ...input, id }).select("*").single(); if (error) { if (error.code === "23505") { const existing = await this.getEvaluation(input.product_match_id, input.match_engine_version_id, input.input_fingerprint); if (existing) return existing; } throw dbError(error, "Match evaluation could not be stored."); } if (!data) throw dbError({ message: "No evaluation returned." }, "Match evaluation could not be stored."); return data; }
  async setCurrentEvaluation(matchId: string, evaluationId: string) { const { error } = await this.client.from("product_matches").update({ current_match_evaluation_id: evaluationId }).eq("id", matchId); if (error) throw dbError(error, "Current match evaluation could not be updated."); }
  async getRanking(evaluationId: string, engineVersionId: string, inputFingerprint: string) { const { data, error } = await this.client.from("match_rankings").select("*").eq("product_match_evaluation_id", evaluationId).eq("ranking_engine_version_id", engineVersionId).eq("input_fingerprint", inputFingerprint).maybeSingle(); if (error) throw dbError(error, "Ranking could not be loaded."); return data; }
  async getRankingById(rankingId: string) { const { data, error } = await this.client.from("match_rankings").select("*").eq("id", rankingId).maybeSingle(); if (error) throw dbError(error, "Ranking could not be loaded."); return data; }
  async createRanking(input: MatchRankingInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(input.evidence_node_id, "ranking", input.workspace_id, "match_rankings", id); const { data, error } = await this.client.from("match_rankings").insert({ ...input, id }).select("*").single(); if (error) { if (error.code === "23505") { const existing = await this.getRanking(input.product_match_evaluation_id, input.ranking_engine_version_id, input.input_fingerprint); if (existing) return existing; } throw dbError(error, "Ranking could not be stored."); } if (!data) throw dbError({ message: "No ranking returned." }, "Ranking could not be stored."); return data; }
  async getSignalByMatch(matchId: string) { const { data, error } = await this.client.from("signals").select("*").eq("product_match_id", matchId).maybeSingle(); if (error) throw dbError(error, "Signal could not be loaded."); return data; }
  async listSignals(workspaceId: string, productId?: string) { let query = this.client.from("signals").select("*").eq("workspace_id", workspaceId); if (productId) query = query.eq("product_id", productId); const { data, error } = await query; if (error) throw dbError(error, "Signals could not be loaded."); return data ?? []; }
  async getSignal(signalId: string) { const { data, error } = await this.client.from("signals").select("*").eq("id", signalId).maybeSingle(); if (error) throw dbError(error, "Signal could not be loaded."); return data; }
  async createSignal(input: SignalInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(input.evidence_node_id, "signal", input.workspace_id, "signals", id); const { data, error } = await this.client.from("signals").insert({ ...input, id }).select("*").single(); if (error || !data) throw dbError(error ?? { message: "No signal returned." }, "Signal could not be stored."); return data; }
  async updateSignal(signalId: string, input: SignalUpdate) { const { data, error } = await this.client.from("signals").update(input).eq("id", signalId).select("*").single(); if (error || !data) throw dbError(error ?? { message: "No signal returned." }, "Signal could not be updated."); return data; }
  async createFeedback(input: MatchFeedbackInsert) { const { data, error } = await this.client.from("match_feedback").insert(input).select("*").single(); if (error || !data) throw dbError(error ?? { message: "No feedback returned." }, "Feedback could not be stored."); return data; }
  async listFeedback(signalId: string) { const { data, error } = await this.client.from("match_feedback").select("*").eq("signal_id", signalId).order("created_at", { ascending: true }); if (error) throw dbError(error, "Feedback could not be loaded."); return data ?? []; }
  async consumeSignalUsage(workspaceId: string, idempotencyKey: string) { const { error } = await this.client.rpc("consume_usage", { p_workspace_id: workspaceId, p_usage_type: "qualified_signal", p_amount: 1, p_idempotency_key: idempotencyKey, p_source_metadata: { phase: "phase3", event: "signal.created" } }); if (error) throw dbError(error, "Signal usage could not be recorded."); }
  async linkProvenance(input: { derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; weight?: number; ordinal?: number; span?: Json | null; measurement?: Json | null; engineVersionId?: string | null }) { const { error } = await this.client.from("evidence_provenance").upsert({ derived_evidence_node_id: input.derivedEvidenceNodeId, source_evidence_node_id: input.sourceEvidenceNodeId, relation_type: input.relationType, weight: input.weight, ordinal: input.ordinal, span: input.span ?? null, measurement: input.measurement ?? null, engine_version_id: input.engineVersionId ?? null }, { onConflict: "derived_evidence_node_id,source_evidence_node_id,relation_type,ordinal", ignoreDuplicates: true }); if (error) throw dbError(error, "Evidence provenance could not be stored."); }
}

function uuid(): string {
  return crypto.randomUUID();
}
function now(): string { return new Date().toISOString(); }

export class InMemoryIntelligenceRepository implements IntelligenceRepository {
  readonly products = new Map<string, ProductRow>();
  readonly snapshots = new Map<string, ProductSnapshotRow>();
  readonly profiles = new Map<string, DemandProfileRow>();
  readonly profileSnapshotInputs: DemandProfileSnapshotInputInsert[] = [];
  readonly conversations = new Map<string, ConversationRow>();
  readonly sourceItems = new Map<string, SourceItemRow>();
  readonly analyses = new Map<string, ConversationAnalysisRow>();
  readonly analysisSpans: ConversationAnalysisEvidenceRow[] = [];
  readonly matches = new Map<string, ProductMatchRow>();
  readonly evaluations = new Map<string, ProductMatchEvaluationRow>();
  readonly rankings = new Map<string, MatchRankingRow>();
  readonly signals = new Map<string, SignalRow>();
  readonly feedback: MatchFeedbackRow[] = [];
  readonly consumedUsage = new Set<string>();
  signalsMonthlyLimit = 5;

  async getProduct(productId: string) { return this.products.get(productId) ?? null; }
  async getProductSnapshots(productId: string) { return [...this.snapshots.values()].filter((row) => row.product_id === productId).sort((a, b) => a.snapshot_version - b.snapshot_version); }
  async createProductSnapshot(input: ProductSnapshotInsert) {
    const timestamp = now();
    const row = { ...input, id: input.id ?? uuid(), source_url: input.source_url ?? null, metadata: input.metadata ?? {}, capture_status: input.capture_status ?? "captured", capture_engine_version_id: input.capture_engine_version_id ?? null, captured_at: input.captured_at ?? timestamp, created_at: input.created_at ?? timestamp } as ProductSnapshotRow;
    this.snapshots.set(row.id, row); return row;
  }
  async setCurrentSnapshot(productId: string, snapshotId: string) { const product = this.products.get(productId); if (product) this.products.set(productId, { ...product, current_snapshot_id: snapshotId, updated_at: now() }); }
  async getDemandProfiles(productId: string) { return [...this.profiles.values()].filter((row) => row.product_id === productId).sort((a, b) => a.profile_version - b.profile_version); }
  async getDemandProfileById(profileId: string) { return this.profiles.get(profileId) ?? null; }
  async createDemandProfile(input: DemandProfileInsert, snapshotInputs: DemandProfileSnapshotInputInsert[]) { const row = { ...input, id: input.id ?? uuid(), model: input.model ?? null, prompt_version: input.prompt_version ?? null, created_at: input.created_at ?? now() } as DemandProfileRow; this.profiles.set(row.id, row); this.profileSnapshotInputs.push(...snapshotInputs); return row; }
  async setCurrentDemandProfile(productId: string, profileId: string) { const product = this.products.get(productId); if (product) this.products.set(productId, { ...product, current_demand_profile_id: profileId, updated_at: now() }); }
  async getConversation(conversationId: string) { return this.conversations.get(conversationId) ?? null; }
  async getSourceItem(sourceItemId: string) { return this.sourceItems.get(sourceItemId) ?? null; }
  async getConversationAnalysis(conversationId: string, engineVersionId: string, inputFingerprint: string) { return [...this.analyses.values()].find((row) => row.conversation_id === conversationId && row.engine_version_id === engineVersionId && row.input_fingerprint === inputFingerprint) ?? null; }
  async getConversationAnalysisById(analysisId: string) { return this.analyses.get(analysisId) ?? null; }
  async createConversationAnalysis(input: ConversationAnalysisInsert, spans: ConversationAnalysisEvidenceInsert[]) { const row = { ...input, id: input.id ?? uuid(), pain_themes: input.pain_themes ?? [], desired_outcomes: input.desired_outcomes ?? [], alternatives: input.alternatives ?? [], buyer_language: input.buyer_language ?? [], audience_signals: input.audience_signals ?? [], urgency: input.urgency ?? null, status: input.status ?? "completed", skip_reason: input.skip_reason ?? null, evidence_spans: input.evidence_spans ?? [], provider: input.provider ?? null, model: input.model ?? null, prompt_version: input.prompt_version ?? null, usage_metadata: input.usage_metadata ?? {}, created_at: input.created_at ?? now() } as ConversationAnalysisRow; this.analyses.set(row.id, row); for (const span of spans) this.analysisSpans.push({ ...span, id: span.id ?? uuid(), created_at: span.created_at ?? now() }); return row; }
  async getMatch(workspaceId: string, productId: string, conversationId: string) { return [...this.matches.values()].find((row) => row.workspace_id === workspaceId && row.product_id === productId && row.conversation_id === conversationId) ?? null; }
  async getMatchById(matchId: string) { return this.matches.get(matchId) ?? null; }
  async createMatch(input: ProductMatchInsert) { const row = { ...input, id: input.id ?? uuid(), lifecycle_status: input.lifecycle_status ?? "active", current_match_evaluation_id: input.current_match_evaluation_id ?? null, created_at: input.created_at ?? now(), updated_at: input.updated_at ?? now() } as ProductMatchRow; this.matches.set(row.id, row); return row; }
  async getEvaluation(productMatchId: string, engineVersionId: string, inputFingerprint: string) { return [...this.evaluations.values()].find((row) => row.product_match_id === productMatchId && row.match_engine_version_id === engineVersionId && row.input_fingerprint === inputFingerprint) ?? null; }
  async createEvaluation(input: ProductMatchEvaluationInsert) { const row = { ...input, id: input.id ?? uuid(), evidence: input.evidence ?? {}, created_at: input.created_at ?? now() } as ProductMatchEvaluationRow; this.evaluations.set(row.id, row); return row; }
  async setCurrentEvaluation(matchId: string, evaluationId: string) { const match = this.matches.get(matchId); if (match) this.matches.set(matchId, { ...match, current_match_evaluation_id: evaluationId, updated_at: now() }); }
  async getRanking(evaluationId: string, engineVersionId: string, inputFingerprint: string) { return [...this.rankings.values()].find((row) => row.product_match_evaluation_id === evaluationId && row.ranking_engine_version_id === engineVersionId && row.input_fingerprint === inputFingerprint) ?? null; }
  async createRanking(input: MatchRankingInsert) { const timestamp = now(); const row = { ...input, id: input.id ?? uuid(), calculated_at: input.calculated_at ?? timestamp, created_at: input.created_at ?? timestamp } as MatchRankingRow; this.rankings.set(row.id, row); return row; }
  async getSignalByMatch(matchId: string) { return [...this.signals.values()].find((row) => row.product_match_id === matchId) ?? null; }
  async listSignals(workspaceId: string, productId?: string) { return [...this.signals.values()].filter((row) => row.workspace_id === workspaceId && (!productId || row.product_id === productId)); }
  async getSignal(signalId: string) { return this.signals.get(signalId) ?? null; }
  async getEvaluationById(evaluationId: string) { return this.evaluations.get(evaluationId) ?? null; }
  async getRankingById(rankingId: string) { return this.rankings.get(rankingId) ?? null; }
  async createSignal(input: SignalInsert) { const row = { ...input, id: input.id ?? uuid(), lifecycle_status: input.lifecycle_status ?? "active", tags: input.tags ?? [], buyer_language: input.buyer_language ?? [], pain_themes: input.pain_themes ?? [], created_at: input.created_at ?? now(), updated_at: input.updated_at ?? now() } as SignalRow; this.signals.set(row.id, row); return row; }
  async updateSignal(signalId: string, input: SignalUpdate) { const old = this.signals.get(signalId); if (!old) throw new Error("Signal not found."); const row = { ...old, ...input, updated_at: now() }; this.signals.set(signalId, row); return row; }
  async createFeedback(input: MatchFeedbackInsert) { const row = { ...input, id: input.id ?? uuid(), signal_id: input.signal_id ?? null, product_match_evaluation_id: input.product_match_evaluation_id ?? null, reason: input.reason ?? null, metadata: input.metadata ?? {}, created_at: input.created_at ?? now() } as MatchFeedbackRow; this.feedback.push(row); return row; }
  async listFeedback(signalId: string) { return this.feedback.filter((row) => row.signal_id === signalId).sort((a, b) => a.created_at.localeCompare(b.created_at)); }
  async consumeSignalUsage(workspaceId: string, idempotencyKey: string) { const key = `${workspaceId}:${idempotencyKey}`; if (this.consumedUsage.has(key)) return; if ([...this.consumedUsage].filter((value) => value.startsWith(`${workspaceId}:`)).length >= this.signalsMonthlyLimit) throw new Error("usage_limit_exceeded"); this.consumedUsage.add(key); }
  readonly provenance: Array<{ derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; weight?: number; ordinal?: number; span?: Json | null; measurement?: Json | null; engineVersionId?: string | null }> = [];
  async linkProvenance(input: { derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; weight?: number; ordinal?: number; span?: Json | null; measurement?: Json | null; engineVersionId?: string | null }) { if (!this.provenance.some((edge) => edge.derivedEvidenceNodeId === input.derivedEvidenceNodeId && edge.sourceEvidenceNodeId === input.sourceEvidenceNodeId && edge.relationType === input.relationType && edge.ordinal === input.ordinal)) this.provenance.push(input); }
}
