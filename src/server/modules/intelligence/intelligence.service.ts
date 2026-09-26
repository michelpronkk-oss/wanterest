import { AppError } from "../../lib/errors";
import { jsonValueSchema, type Json } from "../../db/database.helpers";
import { deterministicUuid, sha256Json, sha256Text } from "../ingestion/hash";
import type { ConversationRow, ProductRow, ProductSnapshotInsert, ProductSnapshotRow, SignalRow, SourceItemRow } from "../../db/database.helpers";
import { conversationAnalysisSchema, demandProfileSchema, feedbackTypeSchema, type FeedbackType } from "./intelligence.schemas";
import type { BusinessClassification } from "./business-classification.schemas";
import { readBusinessClassification } from "./business-classification.service";
import { buildDemandProfileV2, projectDemandProfileV2ForQualification, readDemandProfileV2 } from "./demand-profile-v2.service";
import type { DemandProfileV2 } from "./demand-profile-v2.schemas";
import type { DemandProfileV2Engine, DemandProfileV2Hints } from "./demand-profile-v2.engines";
import { calculateOpportunityScore, freshnessScore, INTENT_STRENGTH, RANKING_FORMULA_VERSION, sourceQuality, type RankingComponents } from "./ranking";
import type { ConversationAnalysisEngine, DemandProfileEngine, ProductMatchingEngine } from "./engines";
import type { IntelligenceRepository } from "./intelligence.repository";
import { canMaterializeQualifiedSignal, failClosedQualification, qualificationFromEvidence, qualifySignal, qualifySignalWithReasoning, serializeQualification, type SignalQualificationProfile } from "./signal-qualification.service";
import { isDuplicateSignalContent, inspectSignalContent } from "./signal-quality";
import type { ConversationMarketReasoning, SignalQualification } from "./signal-qualification.schemas";
import { classifyConversationIntent } from "./intent-semantics";
import { buildMarketContext } from "./market-context";

function json(value: unknown): Json { return jsonValueSchema.parse(value); }
function asStrings(value: Json): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function normalizeText(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function metadataObject(value: Json | undefined): Record<string, Json> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : {}; }
function snapshotClassificationIdentity(value: Json): string {
  const metadata = metadataObject(value);
  const classification = metadata.business_classification;
  if (!classification || typeof classification !== "object" || Array.isArray(classification)) return "none";
  const record = classification as Record<string, Json>;
  return `${typeof record.classification_version === "string" ? record.classification_version : "none"}:${typeof record.engine_version_id === "string" ? record.engine_version_id : "none"}`;
}
function snapshotDemandProfileV2Identity(value: Json): string {
  const profile = metadataObject(value).demand_profile_v2;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return "none";
  const record = profile as Record<string, Json>;
  return `${record.version === "demand_profile_v2" ? record.version : "none"}:${typeof record.engine_version_id === "string" ? record.engine_version_id : "none"}`;
}

export type SignalFilters = {
  minimumScore?: number;
  intentType?: string;
  sourceKey?: string;
  lifecycleStatus?: string;
  from?: string;
  to?: string;
  /** Maximum number of scored signals returned to a consumer. */
  limit?: number;
  /** Offset into the backend-ranked result set. */
  offset?: number;
};
export type SignalReadModel = {
  signalId: string; workspaceId: string; productId: string; productMatchId: string; conversationId: string; source: string;
  canonicalUrl: string | null; publishedAt: string | null; createdAt: string; intentType: string; opportunityScore: number; matchPercent: number;
  excerpt: string; whyItMatters: string; tags: string[]; buyerLanguage: string[]; painThemes: string[]; lifecycleStatus: string;
  feedbackState: { saved: boolean; dismissed: boolean; relevant: boolean | null; opened: boolean; contacted: boolean; converted: boolean };
  evidence: { signalEvidenceNodeId: string; evaluationId: string; rankingId: string; conversationEvidenceNodeId: string; sourceItemId: string; demandProfileEvidenceNodeId: string };
  qualification: SignalQualification | null;
};

export class IntelligenceService {
  constructor(private readonly repository: IntelligenceRepository) {}

  async createSnapshot(product: ProductRow, input: { pageType: "manual" | "homepage" | "pricing" | "features" | "use_cases"; rawText: string; sourceUrl?: string | null; metadata?: Json; captureEngineVersionId?: string | null; businessClassification?: BusinessClassification | null; demandProfileV2?: DemandProfileV2 | null; forceNewSnapshot?: boolean }) {
    const normalizedText = normalizeText(input.rawText);
    if (!normalizedText) throw new AppError("VALIDATION_ERROR", "A product snapshot needs text.");
    const hash = sha256Text(normalizedText);
    const previous = await this.repository.getProductSnapshots(product.id);
    const requestedClassificationIdentity = input.businessClassification ? `${input.businessClassification.classification_version}:${input.businessClassification.engine_version_id ?? "none"}` : null;
    const requestedDemandProfileV2Identity = input.demandProfileV2 ? `${input.demandProfileV2.version}:${input.demandProfileV2.engine_version_id ?? "none"}` : null;
    const existing = previous.find((snapshot) => snapshot.content_hash === hash && snapshot.page_type === input.pageType && (!requestedClassificationIdentity || snapshotClassificationIdentity(snapshot.metadata) === requestedClassificationIdentity) && (!requestedDemandProfileV2Identity || snapshotDemandProfileV2Identity(snapshot.metadata) === requestedDemandProfileV2Identity));
    if (existing && !input.forceNewSnapshot) return existing;
    const snapshotVersion = (previous.at(-1)?.snapshot_version ?? 0) + 1;
    const metadata = { ...metadataObject(input.metadata), ...(input.businessClassification ? { business_classification: input.businessClassification } : {}), ...(input.demandProfileV2 ? { demand_profile_v2: input.demandProfileV2 } : {}) };
    const row: ProductSnapshotInsert = {
      workspace_id: product.workspace_id, product_id: product.id, evidence_node_id: deterministicUuid(`evidence:product-snapshot:${product.id}:${hash}:${snapshotVersion}`), snapshot_version: snapshotVersion,
      page_type: input.pageType, source_url: input.sourceUrl ?? null, raw_text: input.rawText, normalized_text: normalizedText,
      content_hash: hash, metadata: json(metadata), capture_status: "captured", capture_engine_version_id: input.captureEngineVersionId ?? null,
    };
    const snapshot = await this.repository.createProductSnapshot(row);
    await this.repository.setCurrentSnapshot(product.id, snapshot.id);
    return snapshot;
  }

  async generateDemandProfileV2(product: ProductRow, engineVersionId: string, engine: DemandProfileV2Engine, snapshot?: ProductSnapshotRow, hints?: DemandProfileV2Hints, forceRebuild = false) {
    const snapshots = await this.repository.getProductSnapshots(product.id);
    const sourceSnapshot = snapshot ?? snapshots.find((candidate) => candidate.id === product.current_snapshot_id) ?? snapshots.at(-1);
    if (!sourceSnapshot) throw new AppError("VALIDATION_ERROR", "A product snapshot is required before generating Demand Profile v2.");
    const existing = readDemandProfileV2(sourceSnapshot);
    if (!forceRebuild && existing?.version === engine.version && existing.engine_version_id === engineVersionId) return { snapshot: sourceSnapshot, profile: existing };
    const classification = readBusinessClassification(sourceSnapshot);
    const profile = await buildDemandProfileV2({ productName: product.name, websiteUrl: product.website_url, snapshot: sourceSnapshot, sourceReference: sourceSnapshot.source_url ?? `product-snapshot:${sourceSnapshot.id}`, businessClassification: classification, hints }, engine, engineVersionId);
    const pageTypes = ["manual", "homepage", "pricing", "features", "use_cases"] as const;
    const pageType = pageTypes.includes(sourceSnapshot.page_type as (typeof pageTypes)[number]) ? sourceSnapshot.page_type as (typeof pageTypes)[number] : "manual";
    const persistedSnapshot = await this.createSnapshot(product, {
      pageType,
      rawText: sourceSnapshot.raw_text,
      sourceUrl: sourceSnapshot.source_url,
      metadata: sourceSnapshot.metadata,
      captureEngineVersionId: sourceSnapshot.capture_engine_version_id,
      businessClassification: classification,
      demandProfileV2: profile,
      forceNewSnapshot: forceRebuild,
    });
    return { snapshot: persistedSnapshot, profile };
  }

  async generateDemandProfile(product: ProductRow, engineVersionId: string, engine: DemandProfileEngine, snapshotIds?: string[]) {
    const allSnapshots = await this.repository.getProductSnapshots(product.id);
    const snapshots = snapshotIds ? allSnapshots.filter((snapshot) => snapshotIds.includes(snapshot.id)) : allSnapshots.filter((snapshot) => snapshot.id === product.current_snapshot_id || snapshot === allSnapshots.at(-1));
    if (!snapshots.length) throw new AppError("VALIDATION_ERROR", "A product snapshot is required before generating a demand profile.");
    const result = demandProfileSchema.parse(await engine.generate({ snapshots, productName: product.name }));
    const previous = await this.repository.getDemandProfiles(product.id);
    const profile = await this.repository.createDemandProfile({
      workspace_id: product.workspace_id, product_id: product.id, evidence_node_id: deterministicUuid(`evidence:demand-profile:${product.id}:${engineVersionId}:${previous.length + 1}`), profile_version: (previous.at(-1)?.profile_version ?? 0) + 1,
      audience: json(result.audience), jobs: json(result.jobs), problems: json(result.problems), desired_outcomes: json(result.desiredOutcomes),
      capabilities: json(result.capabilities), alternatives: json(result.alternatives), include_terms: json(result.includeTerms), exclude_terms: json(result.excludeTerms),
      languages: json(result.languages), geographies: json(result.geographies), confidence: result.confidence, engine_version_id: engineVersionId,
      model: "fixture", prompt_version: engine.version,
    }, snapshots.map((snapshot) => ({ workspace_id: product.workspace_id, demand_profile_id: "pending", product_snapshot_id: snapshot.id })));
    // The join row receives the generated profile ID in SQL-backed adapters; the in-memory
    // adapter records the same association after creation.
    const inputs = (this.repository as unknown as { profileSnapshotInputs?: Array<{ demand_profile_id: string; product_snapshot_id: string }> }).profileSnapshotInputs;
    if (inputs) for (const input of inputs.filter((row) => row.demand_profile_id === "pending")) input.demand_profile_id = profile.id;
    for (const snapshot of snapshots) await this.repository.linkProvenance({ derivedEvidenceNodeId: profile.evidence_node_id, sourceEvidenceNodeId: snapshot.evidence_node_id, relationType: "derived_from_snapshot", ordinal: snapshots.indexOf(snapshot), engineVersionId });
    await this.repository.setCurrentDemandProfile(product.id, profile.id);
    return profile;
  }

  async analyzeConversation(conversation: ConversationRow, sourceItem: SourceItemRow, engineVersionId: string, engine: ConversationAnalysisEngine) {
    const inputFingerprint = sha256Json({ conversationId: conversation.id, contentHash: conversation.content_hash, engineVersionId });
    const existing = await this.repository.getConversationAnalysis(conversation.id, engineVersionId, inputFingerprint);
    if (existing) return existing;
    const skipped = conversation.body.trim().length < 20 || sourceItem.status !== "active";
    const analyzed = skipped
      ? conversationAnalysisSchema.parse({ intentType: "unknown", painThemes: [], desiredOutcomes: [], alternatives: [], buyerLanguage: [], audienceSignals: [], specificity: 0, urgency: null, confidence: 0, evidenceSpans: [] })
      : conversationAnalysisSchema.parse(await engine.analyze({ conversation, sourceItemId: sourceItem.id }));
    const result = conversationAnalysisSchema.parse({
      ...analyzed,
      intentType: classifyConversationIntent(`${conversation.title ?? ""} ${conversation.body}`, analyzed.intentType),
    });
    const analysis = await this.repository.createConversationAnalysis({
      conversation_id: conversation.id, evidence_node_id: deterministicUuid(`evidence:conversation-analysis:${conversation.id}:${engineVersionId}:${inputFingerprint}`),
      engine_version_id: engineVersionId, input_fingerprint: inputFingerprint, intent_type: result.intentType, pain_themes: json(result.painThemes),
      desired_outcomes: json(result.desiredOutcomes), alternatives: json(result.alternatives), buyer_language: json(result.buyerLanguage), audience_signals: json(result.audienceSignals),
      specificity: result.specificity, urgency: result.urgency, confidence: result.confidence, status: skipped ? "skipped" : "completed", skip_reason: skipped ? "content_unusable" : null,
      evidence_spans: json(result.evidenceSpans), provider: "fixture", model: "deterministic", prompt_version: engine.version, usage_metadata: {},
    }, result.evidenceSpans.map((span) => ({ analysis_id: "pending", conversation_id: conversation.id, source_item_id: span.sourceItemId ?? sourceItem.id, field: span.field, start_offset: span.startOffset, end_offset: span.endOffset, excerpt_hash: span.excerptHash, evidence_type: span.evidenceType, confidence: span.confidence })));
    const spans = (this.repository as unknown as { analysisSpans?: Array<{ analysis_id: string }> }).analysisSpans;
    if (spans) for (const span of spans.filter((row) => row.analysis_id === "pending")) span.analysis_id = analysis.id;
    await this.repository.linkProvenance({ derivedEvidenceNodeId: analysis.evidence_node_id, sourceEvidenceNodeId: conversation.evidence_node_id, relationType: "analyzes_conversation", engineVersionId });
    await this.repository.linkProvenance({ derivedEvidenceNodeId: analysis.evidence_node_id, sourceEvidenceNodeId: sourceItem.evidence_node_id, relationType: "supported_by_source_item", engineVersionId });
    return analysis;
  }

  async matchProduct(product: ProductRow, profileId: string, analysisId: string, engineVersionId: string, engine: ProductMatchingEngine, options: { groundingEnabled?: boolean; reasoningOverride?: ConversationMarketReasoning; overrideDroppedClaims?: string[] } = {}) {
    const profiles = await this.repository.getDemandProfiles(product.id);
    const profile = profiles.find((row) => row.id === profileId);
    if (!profile) throw new AppError("NOT_FOUND", "Demand profile was not found.");
    const analysis = await this.repository.getConversationAnalysisById(analysisId);
    if (!analysis) throw new AppError("NOT_FOUND", "Conversation analysis was not found.");
    const conversation = await this.repository.getConversation(analysis.conversation_id);
    if (!conversation) throw new AppError("NOT_FOUND", "Conversation was not found.");
    const result = await engine.match({ profile, analysis: conversationAnalysisSchema.parse({ intentType: analysis.intent_type, painThemes: asStrings(analysis.pain_themes), desiredOutcomes: asStrings(analysis.desired_outcomes), alternatives: asStrings(analysis.alternatives), buyerLanguage: asStrings(analysis.buyer_language), audienceSignals: asStrings(analysis.audience_signals), specificity: analysis.specificity, urgency: analysis.urgency, confidence: analysis.confidence, evidenceSpans: [] }), productName: product.name, conversation });
    const sourceItem = await this.repository.getSourceItem(conversation.primary_source_item_id);
    if (!sourceItem) throw new AppError("NOT_FOUND", "Conversation source evidence was not found.");
    const match = await this.repository.getMatch(product.workspace_id, product.id, conversation.id) ?? await this.repository.createMatch({ workspace_id: product.workspace_id, product_id: product.id, conversation_id: conversation.id, evidence_node_id: deterministicUuid(`evidence:match:${product.id}:${conversation.id}`) });
    await this.repository.linkProvenance({ derivedEvidenceNodeId: match.evidence_node_id, sourceEvidenceNodeId: conversation.evidence_node_id, relationType: "matches_conversation" });
    const qualificationProfile = await this.qualificationProfile(product, profile);
    const qualificationInput = { candidateId: conversation.id, productId: product.id, productName: product.name, conversation, sourceItem, analysis, match: result, profile: qualificationProfile, groundingEnabled: options.groundingEnabled };
    let qualification: SignalQualification;
    try {
      qualification = options.reasoningOverride
        ? qualifySignalWithReasoning(qualificationInput, options.reasoningOverride, options.overrideDroppedClaims ?? [])
        : qualifySignal(qualificationInput);
    } catch (error) {
      qualification = failClosedQualification({ candidateId: conversation.id, productId: product.id, profile: qualificationProfile, analysis }, error instanceof Error ? error.message.slice(0, 120) : "QUALIFICATION_FAILED");
    }
    // 12A.3A.1: groundingEnabled and any reasoning-override fingerprint are hashed
    // in so flipping the flag, or a fresh verified upgrade, always recomputes
    // instead of silently reusing a cached evaluation computed under different
    // qualification/grounding semantics.
    const inputFingerprint = sha256Json({ matchId: match.id, profileId, analysisId, engineVersionId, qualificationVersion: qualification.version, thresholdVersion: qualification.diagnostics.threshold_version, demandProfileVersion: qualification.diagnostics.demand_profile_version, groundingEnabled: options.groundingEnabled ?? false, reasoningOverrideFingerprint: options.reasoningOverride ? sha256Json(options.reasoningOverride) : null });
    const existing = await this.repository.getEvaluation(match.id, engineVersionId, inputFingerprint);
    if (existing) return existing;
    const evaluation = await this.repository.createEvaluation({ workspace_id: product.workspace_id, product_match_id: match.id, product_id: product.id, conversation_id: conversation.id, demand_profile_id: profile.id, conversation_analysis_id: analysis.id, match_engine_version_id: engineVersionId, evidence_node_id: deterministicUuid(`evidence:evaluation:${match.id}:${engineVersionId}:${inputFingerprint}`), input_fingerprint: inputFingerprint, match_confidence: result.matchConfidence, rationale: `${result.rationale} ${qualification.qualification_reason}`.trim(), evidence: json({ ...result.evidence, qualification: serializeQualification(qualification) }), decision: canMaterializeQualifiedSignal(qualification) ? "qualified" : qualification.status === "weak_candidate" ? "weak" : "rejected" });
    await this.repository.setCurrentEvaluation(match.id, evaluation.id);
    await this.repository.linkProvenance({ derivedEvidenceNodeId: evaluation.evidence_node_id, sourceEvidenceNodeId: analysis.evidence_node_id, relationType: "evaluates_analysis", engineVersionId });
    await this.repository.linkProvenance({ derivedEvidenceNodeId: evaluation.evidence_node_id, sourceEvidenceNodeId: profile.evidence_node_id, relationType: "uses_demand_profile", engineVersionId });
    for (const [ordinal, span] of qualification.evidence_spans.entries()) {
      await this.repository.linkProvenance({ derivedEvidenceNodeId: evaluation.evidence_node_id, sourceEvidenceNodeId: sourceItem.evidence_node_id, relationType: "qualification_evidence", weight: span.confidence, ordinal, span: json({ text: span.text, sourceItemId: span.source_item_id, startOffset: span.start_offset, endOffset: span.end_offset, evidenceType: span.evidence_type }), measurement: json({ qualificationVersion: qualification.version, status: qualification.status }), engineVersionId });
    }
    return evaluation;
  }

  async rankEvaluation(product: ProductRow, evaluationId: string, rankingEngineVersionId: string, now = new Date()) {
    const evaluation = await this.repository.getEvaluationById(evaluationId);
    if (!evaluation) throw new AppError("NOT_FOUND", "Match evaluation was not found.");
    const qualification = qualificationFromEvidence(evaluation.evidence);
    if (!canMaterializeQualifiedSignal(qualification)) {
      const existingSignal = await this.repository.getSignalByMatch(evaluation.product_match_id);
      if (existingSignal?.lifecycle_status === "active") await this.repository.updateSignal(existingSignal.id, { lifecycle_status: "archived" });
      return null;
    }
    const conversation = await this.repository.getConversation(evaluation.conversation_id);
    if (!conversation) throw new AppError("NOT_FOUND", "Conversation was not found.");
    const analysis = await this.repository.getConversationAnalysisById(evaluation.conversation_analysis_id);
    if (!analysis) throw new AppError("NOT_FOUND", "Conversation analysis was not found.");
    const evidence = evaluation.evidence && typeof evaluation.evidence === "object" && !Array.isArray(evaluation.evidence) ? evaluation.evidence as Record<string, Json> : {};
    const listLength = (key: string) => Array.isArray(evidence[key]) ? evidence[key].length : 0;
    const components: RankingComponents = {
      semanticRelevance: evaluation.match_confidence,
      painAlignment: Math.min(1, listLength("painAlignment") / 4),
      buyerAlignment: Math.min(1, listLength("buyerAlignment") / 2),
      intentStrength: INTENT_STRENGTH[analysis.intent_type as keyof typeof INTENT_STRENGTH] ?? INTENT_STRENGTH.unknown,
      specificity: analysis.specificity,
      freshness: freshnessScore(conversation.last_activity_at ?? conversation.published_at, now),
      sourceQuality: sourceQuality((await this.repository.getSourceItem(conversation.primary_source_item_id))?.source_key ?? "unknown"),
    };
    const inputFingerprint = sha256Json({ evaluationId, rankingEngineVersionId, components });
    const existing = await this.repository.getRanking(evaluationId, rankingEngineVersionId, inputFingerprint);
    if (existing) return existing;
    const ranking = await this.repository.createRanking({ workspace_id: product.workspace_id, product_match_evaluation_id: evaluation.id, ranking_engine_version_id: rankingEngineVersionId, evidence_node_id: deterministicUuid(`evidence:ranking:${evaluation.id}:${rankingEngineVersionId}:${inputFingerprint}`), formula_version: RANKING_FORMULA_VERSION, semantic_relevance: components.semanticRelevance, pain_alignment: components.painAlignment, buyer_alignment: components.buyerAlignment, intent_strength: components.intentStrength, specificity: components.specificity, freshness: components.freshness, source_quality: components.sourceQuality, opportunity_score: calculateOpportunityScore(components), input_fingerprint: inputFingerprint });
    await this.repository.linkProvenance({ derivedEvidenceNodeId: ranking.evidence_node_id, sourceEvidenceNodeId: evaluation.evidence_node_id, relationType: "ranks_match_evaluation", engineVersionId: rankingEngineVersionId });
    return ranking;
  }

  async materializeSignal(product: ProductRow, evaluationId: string, rankingId: string) {
    const evaluation = await this.repository.getEvaluationById(evaluationId);
    const ranking = await this.repository.getRankingById(rankingId);
    const qualification = evaluation ? qualificationFromEvidence(evaluation.evidence) : null;
    if (!evaluation || !ranking || evaluation.decision !== "qualified" || !canMaterializeQualifiedSignal(qualification)) return null;
    if (!qualification) return null;
    const conversation = await this.repository.getConversation(evaluation.conversation_id);
    const source = conversation ? await this.repository.getSourceItem(conversation.primary_source_item_id) : null;
    if (!conversation || !source) throw new AppError("NOT_FOUND", "Signal source evidence was not found.");
    const existing = await this.repository.getSignalByMatch(evaluation.product_match_id);
    const analysis = await this.repository.getConversationAnalysisById(evaluation.conversation_analysis_id);
    const duplicate = await this.findDuplicateSignal(product, conversation, source);
    if (duplicate) return null;
    const signalInput = { workspace_id: product.workspace_id, product_id: product.id, product_match_id: evaluation.product_match_id, product_match_evaluation_id: evaluation.id, match_ranking_id: ranking.id, conversation_id: conversation.id, evidence_node_id: deterministicUuid(`evidence:signal:${evaluation.product_match_id}`), lifecycle_status: existing?.lifecycle_status ?? "active", intent_type: analysis?.intent_type ?? "unknown", excerpt: conversation.body.slice(0, 500), why_it_matters: qualification.qualification_reason, tags: json([]), buyer_language: json(analysis ? asStrings(analysis.buyer_language) : []), pain_themes: json(analysis ? asStrings(analysis.pain_themes) : []), source_key: source.source_key, canonical_url: source.canonical_url, published_at: source.published_at };
    if (existing) return this.repository.updateSignal(existing.id, signalInput);
    try { await this.repository.consumeSignalUsage(product.workspace_id, `${evaluation.product_match_id}:${evaluation.id}`); } catch (error) { if (error instanceof Error && error.message.includes("usage_limit_exceeded")) throw new AppError("USAGE_LIMIT_EXCEEDED", "The workspace signal limit was reached."); throw error; }
    const signal = await this.repository.createSignal(signalInput);
    await this.repository.linkProvenance({ derivedEvidenceNodeId: signal.evidence_node_id, sourceEvidenceNodeId: ranking.evidence_node_id, relationType: "surfaces_ranking" });
    await this.repository.linkProvenance({ derivedEvidenceNodeId: signal.evidence_node_id, sourceEvidenceNodeId: evaluation.evidence_node_id, relationType: "surfaces_match_evaluation" });
    const profile = await this.repository.getDemandProfileById(evaluation.demand_profile_id);
    if (profile) await this.repository.linkProvenance({ derivedEvidenceNodeId: signal.evidence_node_id, sourceEvidenceNodeId: profile.evidence_node_id, relationType: "uses_demand_profile" });
    return signal;
  }

  async addFeedback(input: { workspaceId: string; matchId: string; actorUserId: string; type: FeedbackType; signalId?: string; evaluationId?: string; reason?: string; metadata?: Json }) {
    const parsed = feedbackTypeSchema.safeParse(input.type);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid feedback type.");
    const match = await this.repository.getMatchById(input.matchId);
    if (!match || match.workspace_id !== input.workspaceId) throw new AppError("FORBIDDEN", "The match does not belong to this workspace.");
    if (input.signalId) {
      const signal = await this.repository.getSignal(input.signalId);
      if (!signal || signal.workspace_id !== input.workspaceId || signal.product_match_id !== input.matchId) throw new AppError("FORBIDDEN", "The signal does not belong to this workspace.");
    }
    return this.repository.createFeedback({ workspace_id: input.workspaceId, product_match_id: input.matchId, actor_user_id: input.actorUserId, feedback_type: parsed.data, signal_id: input.signalId ?? null, product_match_evaluation_id: input.evaluationId ?? null, reason: input.reason ?? null, metadata: input.metadata ?? {} });
  }

  async listSignals(workspaceId: string, productId?: string, filters: SignalFilters = {}): Promise<SignalReadModel[]> {
    const rows = await this.repository.listSignals(workspaceId, productId);
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 50), 1), 100);
    const offset = Math.max(Math.trunc(filters.offset ?? 0), 0);
    const rankedRows = (await Promise.all(rows.map(async (row) => {
      // ACTIVE and SAVED are both part of the normal active experience; DISMISSED
      // and ARCHIVED are not and must never inflate default counts/feeds. An
      // explicit lifecycleStatus filter (e.g. the Saved page, or ?status=dismissed)
      // is an exact match against the stored status instead of the default set.
      if (filters.lifecycleStatus) {
        if (row.lifecycle_status !== filters.lifecycleStatus) return null;
      } else if (row.lifecycle_status !== "active" && row.lifecycle_status !== "saved") {
        return null;
      }
      if (filters.intentType && row.intent_type !== filters.intentType) return null;
      if (filters.sourceKey && row.source_key !== filters.sourceKey) return null;
      if (filters.from && (row.published_at ?? row.created_at) < filters.from) return null;
      if (filters.to && (row.published_at ?? row.created_at) > filters.to) return null;
      const ranking = await this.repository.getRankingById(row.match_ranking_id);
      if (!ranking || (filters.minimumScore !== undefined && ranking.opportunity_score < filters.minimumScore)) return null;
      return { row, opportunityScore: ranking.opportunity_score };
    }))).filter((value): value is { row: import("../../db/database.helpers").SignalRow; opportunityScore: number } => value !== null)
      .sort((a, b) => b.opportunityScore - a.opportunityScore);
    const page = rankedRows.slice(offset, offset + limit);
    return Promise.all(page.map(({ row, opportunityScore }) => this.signalReadModel(row, opportunityScore)));
  }

  async getSignal(workspaceId: string, signalId: string): Promise<SignalReadModel> {
    const row = await this.repository.getSignal(signalId);
    if (!row || row.workspace_id !== workspaceId) throw new AppError("NOT_FOUND", "Signal was not found.");
    return this.signalReadModel(row);
  }

  private async findDuplicateSignal(product: ProductRow, conversation: ConversationRow, source: SourceItemRow): Promise<SignalRow | null> {
    const candidateIdentity = inspectSignalContent({ conversation, sourceItem: source });
    const existingSignals = await this.repository.listSignals(product.workspace_id, product.id);
    for (const existingSignal of existingSignals) {
      if (existingSignal.lifecycle_status === "archived" || existingSignal.conversation_id === conversation.id) continue;
      const existingConversation = await this.repository.getConversation(existingSignal.conversation_id);
      if (!existingConversation) continue;
      const existingSource = await this.repository.getSourceItem(existingConversation.primary_source_item_id);
      if (!existingSource) continue;
      if (isDuplicateSignalContent(candidateIdentity, inspectSignalContent({ conversation: existingConversation, sourceItem: existingSource }))) return existingSignal;
    }
    return null;
  }

  async replayAnalysis(conversations: Array<{ conversation: ConversationRow; sourceItem: SourceItemRow }>, engineVersionId: string, engine: ConversationAnalysisEngine) {
    const results = [];
    for (const input of conversations) results.push(await this.analyzeConversation(input.conversation, input.sourceItem, engineVersionId, engine));
    return results;
  }

  async replayMatch(product: ProductRow, profileId: string, analyses: string[], engineVersionId: string, engine: ProductMatchingEngine) {
    const results = [];
    for (const analysisId of analyses) results.push(await this.matchProduct(product, profileId, analysisId, engineVersionId, engine));
    return results;
  }

  async replayRanking(product: ProductRow, evaluations: string[], rankingEngineVersionId: string) {
    const results = [];
    for (const evaluationId of evaluations) {
      const ranking = await this.rankEvaluation(product, evaluationId, rankingEngineVersionId);
      results.push(ranking);
    }
    return results;
  }

  private async signalReadModel(row: import("../../db/database.helpers").SignalRow, opportunityScore?: number): Promise<SignalReadModel> {
    const feedback = await this.repository.listFeedback(row.id);
    const latest = (type: string) => [...feedback].reverse().find((event) => event.feedback_type === type);
    const latestState = (types: string[]) => [...feedback].reverse().find((event) => types.includes(event.feedback_type))?.feedback_type;
    const evaluation = await this.repository.getEvaluationById(row.product_match_evaluation_id);
    const conversation = await this.repository.getConversation(row.conversation_id);
    const source = conversation ? await this.repository.getSourceItem(conversation.primary_source_item_id) : null;
    const profile = evaluation ? await this.repository.getDemandProfileById(evaluation.demand_profile_id) : null;
    const qualification = evaluation ? qualificationFromEvidence(evaluation.evidence) : null;
    const savedState = latestState(["saved", "dismissed"]);
    const relevanceState = latestState(["relevant", "not_relevant"]);
    return { signalId: row.id, workspaceId: row.workspace_id, productId: row.product_id, productMatchId: row.product_match_id, conversationId: row.conversation_id, source: row.source_key, canonicalUrl: row.canonical_url, publishedAt: row.published_at, createdAt: row.created_at, intentType: row.intent_type, opportunityScore: opportunityScore ?? (await this.repository.getRankingById(row.match_ranking_id))?.opportunity_score ?? 0, matchPercent: Math.round(((evaluation?.match_confidence ?? 0) * 100)), excerpt: row.excerpt, whyItMatters: row.why_it_matters, tags: asStrings(row.tags), buyerLanguage: asStrings(row.buyer_language), painThemes: asStrings(row.pain_themes), lifecycleStatus: row.lifecycle_status, feedbackState: { saved: savedState === "saved", dismissed: savedState === "dismissed", relevant: relevanceState === "relevant" ? true : relevanceState === "not_relevant" ? false : null, opened: Boolean(latest("opened")), contacted: Boolean(latest("contacted")), converted: Boolean(latest("converted")) }, evidence: { signalEvidenceNodeId: row.evidence_node_id, evaluationId: row.product_match_evaluation_id, rankingId: row.match_ranking_id, conversationEvidenceNodeId: conversation?.evidence_node_id ?? "", sourceItemId: source?.id ?? "", demandProfileEvidenceNodeId: profile?.evidence_node_id ?? "" }, qualification };
  }

  async qualificationProfile(product: ProductRow, profile: import("../../db/database.helpers").DemandProfileRow): Promise<SignalQualificationProfile> {
    const snapshots = await this.repository.getProductSnapshots(product.id);
    const snapshot = snapshots.find((candidate) => candidate.id === product.current_snapshot_id) ?? snapshots.at(-1);
    const demandProfileV2 = snapshot ? readDemandProfileV2(snapshot) : null;
    if (demandProfileV2) {
      const projection = projectDemandProfileV2ForQualification(demandProfileV2);
      return { ...projection, profile_version: demandProfileV2.version, market_context: buildMarketContext(demandProfileV2) };
    }
    return {
      relevant_pains: asStrings(profile.problems),
      relevant_outcomes: asStrings(profile.desired_outcomes),
      relevant_intents: [],
      relevant_jtbd: asStrings(profile.jobs),
      relevant_features: asStrings(profile.capabilities),
      buyer_roles: asStrings(profile.audience),
      competitors: [],
      alternatives: asStrings(profile.alternatives),
      geography: { market_scope: "global", primary_country_code: null, primary_region: null, primary_city: null, location_dependency: 0, demand_geography_terms: [] },
      profile_confidence: profile.confidence,
      primary_category: product.name,
      profile_version: null,
    };
  }
}
