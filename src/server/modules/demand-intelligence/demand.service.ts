import { selectComparableDrifts } from "./drift-comparability";
import { AppError } from "../../lib/errors";
import { jsonValueSchema, type Json } from "../../db/database.helpers";
import type {
  DemandDriftRow, DemandGapRow, DemandObservationRow, DemandProfileRow, DemandSnapshotAlternativeRow,
  DemandSnapshotPhraseRow, DemandSnapshotRow, DemandSnapshotThemeRow, DemandThemeRow, ProductRow,
  ProductSnapshotRow,
} from "../../db/database.helpers";
import { deterministicUuid, sha256Json, sha256Text } from "../ingestion/hash";
import type { IntelligenceRepository } from "../intelligence/intelligence.repository";
import { demandWindowSchema, clamp, normalizeFacet, windowStart, type DemandDirection, type DemandMapReadModel, type DemandWindow, type DemandGapReadModel, type DemandDriftReadModel, type ObservationType } from "./demand.schemas";
import { calculateDriftDirection, calculateGapScore, calculateGrowthRate, calculatePositioningWeight, calculateSignificance, DRIFT_FORMULA_VERSION, FixtureDemandThemeEngine, GAP_FORMULA_VERSION, sampleFactor, type DemandThemeEngine } from "./demand.engines";
import type { DemandRepository } from "./demand.repository";

function json(value: unknown): Json { return jsonValueSchema.parse(value); }
function strings(value: Json): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []; }
function object(value: Json): Record<string, Json> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : {}; }
function uuid(seed: string): string { return deterministicUuid(`phase4:${seed}`); }
function avg(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function structuredSpan(text: string, phrase: string, field = "body"): Json {
  const startOffset = text.toLowerCase().indexOf(phrase.toLowerCase());
  return json({ field, startOffset: Math.max(0, startOffset), endOffset: Math.max(0, startOffset) + phrase.length, excerptHash: sha256Text(phrase) });
}

const HIGH_INTENT = new Set(["high_intent", "switching_intent", "alternative_search"]);

type ObservationSeed = {
  observationType: ObservationType;
  facetKey: string;
  facetValue: string;
  weight?: number;
  confidence?: number;
};

export class DemandIntelligenceService {
  constructor(
    private readonly repository: DemandRepository,
    private readonly intelligence: IntelligenceRepository,
  ) {}

  async materializeObservations(product: ProductRow, evaluationId: string, observationEngineVersionId: string, signalId?: string | null): Promise<DemandObservationRow[]> {
    const evaluation = await this.intelligence.getEvaluationById(evaluationId);
    if (!evaluation || evaluation.workspace_id !== product.workspace_id || evaluation.product_id !== product.id || evaluation.decision !== "qualified") return [];
    const analysis = await this.intelligence.getConversationAnalysisById(evaluation.conversation_analysis_id);
    const conversation = await this.intelligence.getConversation(evaluation.conversation_id);
    const source = conversation ? await this.intelligence.getSourceItem(conversation.primary_source_item_id) : null;
    if (!analysis || !conversation || !source) throw new AppError("NOT_FOUND", "Demand observation source evidence was not found.");
    const signal = signalId ? await this.intelligence.getSignal(signalId) : null;
    if (signal && (signal.workspace_id !== product.workspace_id || signal.product_id !== product.id || signal.product_match_evaluation_id !== evaluation.id)) throw new AppError("FORBIDDEN", "The signal does not belong to this workspace.");
    const ranking = signal ? await this.intelligence.getRankingById(signal.match_ranking_id) : null;
    const opportunityScore = ranking?.opportunity_score ?? evaluation.match_confidence;
    const observedAt = source.published_at ?? conversation.last_activity_at ?? conversation.created_at;
    const seeds: ObservationSeed[] = [];
    const add = (observationType: ObservationType, facetKey: string, values: string[], weight = 0.8) => {
      for (const value of values) seeds.push({ observationType, facetKey, facetValue: value, weight, confidence: analysis.confidence });
    };
    add("pain", "pain_theme", strings(analysis.pain_themes), 0.9);
    add("desired_outcome", "desired_outcome", strings(analysis.desired_outcomes), 0.8);
    add("buyer_language", "buyer_language", strings(analysis.buyer_language), 0.85);
    add("alternative", "alternative", strings(analysis.alternatives), 0.8);
    add("problem", "problem", strings(analysis.pain_themes), 0.75);
    add("intent", "intent_type", [analysis.intent_type], 1);
    if (analysis.intent_type === "switching_intent") add("switching_reason", "intent", ["switching intent"], 1);
    const evidence = object(evaluation.evidence);
    add("capability_request", "capability", strings(evidence.capabilityAlignment ?? null), 0.7);
    const seen = new Set<string>();
    const results: DemandObservationRow[] = [];
    for (const seed of seeds) {
      const normalizedValue = normalizeFacet(seed.facetValue);
      const key = `${seed.observationType}:${normalizedValue}:${seed.facetValue}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const inputFingerprint = sha256Json({ evaluationId, observationEngineVersionId, seed, analysisId: analysis.id, sourceHash: source.content_hash });
      const existingObservation = (await this.repository.listObservations(product.workspace_id, product.id)).find((item) => item.input_fingerprint === inputFingerprint);
      const observation = existingObservation ?? await this.repository.createObservation({
        id: uuid(`observation:${product.id}:${evaluation.id}:${observationEngineVersionId}:${key}`),
        workspace_id: product.workspace_id,
        product_id: product.id,
        conversation_id: conversation.id,
        product_match_id: evaluation.product_match_id,
        match_evaluation_id: evaluation.id,
        conversation_analysis_id: analysis.id,
        signal_id: signal?.id ?? null,
        source_key: source.source_key,
        evidence_node_id: uuid(`evidence:observation:${product.id}:${evaluation.id}:${observationEngineVersionId}:${key}`),
        observation_type: seed.observationType,
        facet_key: seed.facetKey,
        facet_value: seed.facetValue.trim(),
        normalized_value: normalizedValue,
        intent_type: analysis.intent_type,
        weight: clamp(seed.weight ?? 0.8),
        opportunity_score: clamp(opportunityScore),
        confidence: clamp(seed.confidence ?? analysis.confidence),
        observed_at: observedAt,
        published_at: source.published_at,
        analysis_engine_version_id: analysis.engine_version_id,
        match_engine_version_id: evaluation.match_engine_version_id,
        observation_engine_version_id: observationEngineVersionId,
        input_fingerprint: inputFingerprint,
      });
      results.push(observation);
      const links = [
        signal?.evidence_node_id ? { id: signal.evidence_node_id, relation: "derived_from_signal" } : null,
        { id: evaluation.evidence_node_id, relation: "derived_from_match_evaluation" },
        { id: analysis.evidence_node_id, relation: "derived_from_conversation_analysis" },
        { id: conversation.evidence_node_id, relation: "derived_from_conversation" },
        { id: source.evidence_node_id, relation: "derived_from_source_item" },
      ];
      for (const [ordinal, link] of links.entries()) if (link) await this.repository.linkProvenance({ derivedEvidenceNodeId: observation.evidence_node_id, sourceEvidenceNodeId: link.id, relationType: link.relation, ordinal, weight: observation.weight, engineVersionId: observationEngineVersionId, span: structuredSpan(conversation.body, seed.facetValue, seed.facetKey) });
    }
    return results;
  }

  async materializeThemes(product: ProductRow, profile: DemandProfileRow, themeEngineVersionId: string, engine: DemandThemeEngine = new FixtureDemandThemeEngine()): Promise<DemandThemeRow[]> {
    const observations = await this.repository.listObservations(product.workspace_id, product.id);
    const definitions = engine.generate({ observations, profile });
    const rows: DemandThemeRow[] = [];
    for (const definition of definitions) {
      const inputFingerprint = sha256Json({ profileId: profile.id, themeEngineVersionId, engine: engine.version, themeKey: definition.themeKey, taxonomy: { label: definition.label, description: definition.description, status: definition.status } });
      const existingTheme = (await this.repository.listThemes(product.workspace_id, product.id, profile.id, themeEngineVersionId)).find((item) => item.input_fingerprint === inputFingerprint);
      const theme = existingTheme ?? await this.repository.createTheme({
        id: uuid(`theme:${product.id}:${profile.id}:${themeEngineVersionId}:${definition.themeKey}`), workspace_id: product.workspace_id, product_id: product.id,
        demand_profile_id: profile.id, evidence_node_id: uuid(`evidence:theme:${product.id}:${profile.id}:${themeEngineVersionId}:${definition.themeKey}`),
        theme_key: definition.themeKey, label: definition.label, description: definition.description, status: definition.status,
        confidence: definition.confidence, theme_engine_version_id: themeEngineVersionId, input_fingerprint: inputFingerprint,
      });
      rows.push(theme);
      for (const observationId of definition.observationIds) {
        const observation = observations.find((item) => item.id === observationId);
        if (!observation) continue;
        const existingMembership = (await this.repository.listMemberships(product.workspace_id, product.id, theme.id)).find((item) => item.observation_id === observation.id && item.theme_engine_version_id === themeEngineVersionId);
        const membership = existingMembership ?? await this.repository.createMembership({
          id: uuid(`membership:${theme.id}:${observation.id}:${themeEngineVersionId}`), workspace_id: product.workspace_id, product_id: product.id,
          theme_id: theme.id, observation_id: observation.id, evidence_node_id: uuid(`evidence:membership:${theme.id}:${observation.id}:${themeEngineVersionId}`),
          membership_weight: definition.membershipWeight, confidence: Math.min(definition.confidence, observation.confidence),
          evidence: json({ facet: observation.facet_key, normalizedValue: observation.normalized_value }), theme_engine_version_id: themeEngineVersionId,
        });
        await this.repository.linkProvenance({ derivedEvidenceNodeId: theme.evidence_node_id, sourceEvidenceNodeId: observation.evidence_node_id, relationType: "groups_observation", ordinal: definition.observationIds.indexOf(observation.id), weight: membership.membership_weight, engineVersionId: themeEngineVersionId });
        await this.repository.linkProvenance({ derivedEvidenceNodeId: membership.evidence_node_id, sourceEvidenceNodeId: theme.evidence_node_id, relationType: "assigns_theme", engineVersionId: themeEngineVersionId });
        await this.repository.linkProvenance({ derivedEvidenceNodeId: membership.evidence_node_id, sourceEvidenceNodeId: observation.evidence_node_id, relationType: "assigns_observation", engineVersionId: themeEngineVersionId });
      }
    }
    return rows;
  }

  async aggregateDemand(input: { product: ProductRow; profile: DemandProfileRow; window: DemandWindow; periodEnd?: string; mapEngineVersionId: string; themeEngineVersionId?: string; themeEngine?: DemandThemeEngine }): Promise<DemandSnapshotRow> {
    const window = demandWindowSchema.parse(input.window);
    const periodEnd = input.periodEnd ?? new Date().toISOString();
    const periodStart = windowStart(periodEnd, window);
    const observations = await this.repository.listObservations(input.product.workspace_id, input.product.id, periodStart, periodEnd);
    const themes = (await this.repository.listThemes(input.product.workspace_id, input.product.id, input.profile.id, input.themeEngineVersionId)).length
      ? await this.repository.listThemes(input.product.workspace_id, input.product.id, input.profile.id, input.themeEngineVersionId)
      : await this.materializeThemes(input.product, input.profile, input.themeEngineVersionId ?? uuid("theme-engine:fixture"), input.themeEngine);
    const memberships = await this.repository.listMemberships(input.product.workspace_id, input.product.id);
    const observationsById = new Map(observations.map((item) => [item.id, item]));
    const membershipByObservation = new Map<string, Array<{ membership: (typeof memberships)[number]; theme: DemandThemeRow }>>();
    for (const membership of memberships) {
      const observation = observationsById.get(membership.observation_id);
      const theme = themes.find((item) => item.id === membership.theme_id);
      if (!observation || !theme) continue;
      const list = membershipByObservation.get(membership.observation_id) ?? [];
      list.push({ membership, theme });
      membershipByObservation.set(membership.observation_id, list);
    }
    const conversationIds = unique(observations.map((item) => item.conversation_id));
    const highIntentConversations = new Set(observations.filter((item) => item.observation_type === "intent" && HIGH_INTENT.has(item.intent_type)).map((item) => item.conversation_id));
    const sampleSize = conversationIds.length;
    const quality = sampleSize < 5 ? "insufficient_data" : sampleSize < 20 ? "low_confidence" : sampleSize < 50 ? "normal" : "high_confidence";
    const confidence = clamp(avg(observations.map((item) => item.confidence)) * Math.min(1, sampleSize / 20));
    const sourceMix: Record<string, number> = {};
    for (const sourceKey of unique(observations.map((item) => item.source_key))) sourceMix[sourceKey] = unique(observations.filter((item) => item.source_key === sourceKey).map((item) => item.conversation_id)).length / Math.max(1, sampleSize);
    const qualifiedSignalCount = unique(observations.map((item) => item.signal_id ?? item.match_evaluation_id)).length;
    const inputFingerprint = sha256Json({ productId: input.product.id, profileId: input.profile.id, window, periodStart, periodEnd, observationIds: observations.map((item) => item.id).sort(), mapEngineVersionId: input.mapEngineVersionId });
    const existing = await this.repository.findSnapshotByFingerprint(input.product.workspace_id, input.product.id, inputFingerprint);
    if (existing) return existing;
    const snapshotId = uuid(`snapshot:${input.product.id}:${input.profile.id}:${window}:${periodStart}:${periodEnd}:${input.mapEngineVersionId}:${inputFingerprint}`);
    const themeAggregates: Array<{ theme: DemandThemeRow; themeObservations: DemandObservationRow[]; themeConversations: string[]; share: number; highIntentCount: number; highIntentShare: number; averageOpportunityScore: number; confidence: number }> = [];
    const themeDistribution: Record<string, number> = {};
    for (const theme of themes) {
      const themeObservations = observations.filter((item) => membershipByObservation.get(item.id)?.some((entry) => entry.theme.id === theme.id && entry.membership.membership_weight >= 0.5));
      const themeConversations = unique(themeObservations.map((item) => item.conversation_id));
      if (!themeConversations.length) continue;
      const share = themeConversations.length / Math.max(1, sampleSize);
      const highIntentCount = themeConversations.filter((id) => highIntentConversations.has(id)).length;
      const highIntentShare = highIntentCount / Math.max(1, themeConversations.length);
      const confidenceForTheme = clamp(avg(themeObservations.map((item) => item.confidence)));
      themeAggregates.push({ theme, themeObservations, themeConversations, share, highIntentCount, highIntentShare, averageOpportunityScore: avg(themeObservations.map((item) => item.opportunity_score)), confidence: confidenceForTheme });
      themeDistribution[theme.theme_key] = share;
    }
    const phraseGroups = new Map<string, { type: "buyer_language" | "desired_outcome" | "pain"; phrase: string; observations: DemandObservationRow[] }>();
    for (const observation of observations) {
      const type = observation.observation_type === "buyer_language" ? "buyer_language" : observation.observation_type === "desired_outcome" ? "desired_outcome" : observation.observation_type === "pain" || observation.observation_type === "problem" ? "pain" : null;
      if (!type) continue;
      const key = `${type}:${normalizeFacet(observation.facet_value)}:${observation.facet_value}`;
      const group = phraseGroups.get(key) ?? { type, phrase: observation.facet_value, observations: [] };
      group.observations.push(observation); phraseGroups.set(key, group);
    }
    const phraseAggregates: Array<{ key: string; type: "buyer_language" | "desired_outcome" | "pain"; phrase: string; normalizedValue: string; mentionCount: number; share: number; confidence: number; observations: DemandObservationRow[] }> = [];
    for (const [key, group] of phraseGroups) {
      const mentionCount = unique(group.observations.map((item) => item.conversation_id)).length;
      const normalizedValue = normalizeFacet(group.phrase);
      phraseAggregates.push({ key, type: group.type, phrase: group.phrase, normalizedValue, mentionCount, share: mentionCount / Math.max(1, sampleSize), confidence: clamp(avg(group.observations.map((item) => item.confidence))), observations: group.observations });
    }
    const alternatives = this.aggregateText(observations.filter((item) => item.observation_type === "alternative"), sampleSize);
    const alternativeDistribution: Record<string, number> = {};
    for (const item of alternatives) alternativeDistribution[item.normalizedValue] = item.mentionCount / Math.max(1, sampleSize);
    const intents = this.aggregateText(observations.filter((item) => item.observation_type === "intent"), sampleSize);
    const intentMix: Record<string, number> = {};
    for (const item of intents) intentMix[item.normalizedValue] = item.mentionCount / Math.max(1, sampleSize);
    const snapshot = await this.repository.createSnapshot({ id: snapshotId, workspace_id: input.product.workspace_id, product_id: input.product.id, demand_profile_id: input.profile.id, evidence_node_id: uuid(`evidence:${snapshotId}`), window_type: window, period_start: periodStart, period_end: periodEnd, sample_size: sampleSize, qualified_signal_count: qualifiedSignalCount, conversation_count: sampleSize, theme_distribution: json(themeDistribution), pain_distribution: json(Object.fromEntries(phraseAggregates.filter((row) => row.type === "pain").map((row) => [row.normalizedValue, row.share]))), desired_outcomes: json(Object.fromEntries(phraseAggregates.filter((row) => row.type === "desired_outcome").map((row) => [row.normalizedValue, row.share]))), buyer_language: json(Object.fromEntries(phraseAggregates.filter((row) => row.type === "buyer_language").map((row) => [row.normalizedValue, row.share]))), alternatives: json(alternativeDistribution), intent_mix: json(intentMix), source_mix: json(sourceMix), confidence, measurement_quality: quality, warnings: json(sampleSize < 5 ? ["Sample is too small for a reliable market estimate or drift label."] : []), map_engine_version_id: input.mapEngineVersionId, input_fingerprint: inputFingerprint });
    const themeRows: DemandSnapshotThemeRow[] = [];
    for (const aggregate of themeAggregates) {
      const row = await this.repository.createSnapshotTheme({ id: uuid(`snapshot-theme:${snapshot.id}:${aggregate.theme.theme_key}`), workspace_id: input.product.workspace_id, demand_snapshot_id: snapshot.id, theme_id: aggregate.theme.id, theme_key: aggregate.theme.theme_key, evidence_node_id: uuid(`evidence:snapshot-theme:${snapshot.id}:${aggregate.theme.theme_key}`), mention_count: aggregate.themeConversations.length, weighted_mentions: aggregate.themeObservations.reduce((sum, item) => sum + item.weight, 0), share_of_demand: aggregate.share, high_intent_count: aggregate.highIntentCount, high_intent_share: aggregate.highIntentShare, average_opportunity_score: aggregate.averageOpportunityScore, unique_conversations: aggregate.themeConversations.length, confidence: aggregate.confidence });
      themeRows.push(row);
      for (const observation of aggregate.themeObservations) await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: observation.evidence_node_id, relationType: "aggregates_theme_observation", ordinal: aggregate.themeObservations.indexOf(observation), engineVersionId: input.mapEngineVersionId });
    }
    const phraseRows: DemandSnapshotPhraseRow[] = [];
    for (const aggregate of phraseAggregates) { const row = await this.repository.createSnapshotPhrase({ id: uuid(`snapshot-phrase:${snapshot.id}:${aggregate.key}`), workspace_id: input.product.workspace_id, demand_snapshot_id: snapshot.id, phrase_type: aggregate.type, phrase: aggregate.phrase, normalized_value: aggregate.normalizedValue, evidence_node_id: uuid(`evidence:snapshot-phrase:${snapshot.id}:${aggregate.key}`), mention_count: aggregate.mentionCount, share_of_demand: aggregate.share, confidence: aggregate.confidence }); phraseRows.push(row); }
    const alternativeRows: DemandSnapshotAlternativeRow[] = [];
    for (const item of alternatives) {
      const row = await this.repository.createSnapshotAlternative({ id: uuid(`snapshot-alternative:${snapshot.id}:${item.normalizedValue}`), workspace_id: input.product.workspace_id, demand_snapshot_id: snapshot.id, alternative: item.phrase, normalized_value: item.normalizedValue, evidence_node_id: uuid(`evidence:snapshot-alternative:${snapshot.id}:${item.normalizedValue}`), mention_count: item.mentionCount, share_of_demand: item.mentionCount / Math.max(1, sampleSize), confidence: item.confidence });
      alternativeRows.push(row);
      for (const observation of observations.filter((candidate) => candidate.observation_type === "alternative" && normalizeFacet(candidate.facet_value) === item.normalizedValue)) await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: observation.evidence_node_id, relationType: "aggregates_alternative_observation", engineVersionId: input.mapEngineVersionId });
    }
    const intentRows: Array<{ id: string; evidence_node_id: string }> = [];
    for (const item of intents) { const row = await this.repository.createSnapshotIntent({ id: uuid(`snapshot-intent:${snapshot.id}:${item.normalizedValue}`), workspace_id: input.product.workspace_id, demand_snapshot_id: snapshot.id, intent_type: item.normalizedValue, evidence_node_id: uuid(`evidence:snapshot-intent:${snapshot.id}:${item.normalizedValue}`), mention_count: item.mentionCount, share_of_demand: item.mentionCount / Math.max(1, sampleSize), confidence: item.confidence }); intentRows.push(row); for (const observation of observations.filter((candidate) => candidate.observation_type === "intent" && normalizeFacet(candidate.facet_value) === item.normalizedValue)) await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: observation.evidence_node_id, relationType: "aggregates_intent_observation", engineVersionId: input.mapEngineVersionId }); }
    for (const aggregate of phraseAggregates) { const row = phraseRows.find((item) => item.normalized_value === aggregate.normalizedValue && item.phrase_type === aggregate.type); if (row) for (const observation of aggregate.observations) await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: observation.evidence_node_id, relationType: "aggregates_phrase_observation", engineVersionId: input.mapEngineVersionId }); }
    for (const observation of observations) await this.repository.linkProvenance({ derivedEvidenceNodeId: snapshot.evidence_node_id, sourceEvidenceNodeId: observation.evidence_node_id, relationType: "aggregates_observation", ordinal: observations.indexOf(observation), weight: observation.weight, engineVersionId: input.mapEngineVersionId });
    for (const theme of themes) await this.repository.linkProvenance({ derivedEvidenceNodeId: snapshot.evidence_node_id, sourceEvidenceNodeId: theme.evidence_node_id, relationType: "aggregates_theme", engineVersionId: input.mapEngineVersionId });
    return snapshot;
  }

  private aggregateText(observations: DemandObservationRow[], sampleSize: number) {
    const groups = new Map<string, DemandObservationRow[]>();
    for (const observation of observations) { const key = normalizeFacet(observation.facet_value); groups.set(key, [...(groups.get(key) ?? []), observation]); }
    return [...groups.entries()].map(([normalizedValue, items]) => ({ normalizedValue, phrase: items[0].facet_value, mentionCount: unique(items.map((item) => item.conversation_id)).length, confidence: clamp(avg(items.map((item) => item.confidence))), sampleSize })).sort((a, b) => b.mentionCount - a.mentionCount);
  }

  async calculateDemandGap(product: ProductRow, productSnapshot: ProductSnapshotRow, snapshot: DemandSnapshotRow, gapEngineVersionId: string): Promise<DemandGapRow[]> {
    const themeRows = await this.repository.listSnapshotThemes(snapshot.id);
    const themes = await this.repository.listThemes(product.workspace_id, product.id, snapshot.demand_profile_id);
    const result: DemandGapRow[] = [];
    const existingGaps = await this.repository.listGaps(product.workspace_id, product.id, snapshot.id);
    for (const snapshotTheme of themeRows) {
      const positioningWeight = calculatePositioningWeight(productSnapshot, snapshotTheme.theme_key, themes.find((item) => item.theme_key === snapshotTheme.theme_key)?.label);
      const score = calculateGapScore(snapshotTheme.share_of_demand, positioningWeight, snapshotTheme.high_intent_share, sampleFactor(snapshot.measurement_quality));
      const fingerprint = sha256Json({ snapshotId: snapshot.id, productSnapshotId: productSnapshot.id, themeKey: snapshotTheme.theme_key, positioningWeight, gapEngineVersionId });
      const gap = existingGaps.find((item) => item.input_fingerprint === fingerprint) ?? await this.repository.createGap({ id: uuid(`gap:${snapshot.id}:${snapshotTheme.theme_key}:${gapEngineVersionId}`), workspace_id: product.workspace_id, product_id: product.id, demand_snapshot_id: snapshot.id, product_snapshot_id: productSnapshot.id, demand_profile_id: snapshot.demand_profile_id, theme_id: snapshotTheme.theme_id, evidence_node_id: uuid(`evidence:gap:${snapshot.id}:${snapshotTheme.theme_key}:${gapEngineVersionId}`), concept_key: snapshotTheme.theme_key, market_weight: snapshotTheme.share_of_demand, positioning_weight: positioningWeight, gap_score: score, market_mentions: snapshotTheme.mention_count, market_share: snapshotTheme.share_of_demand, high_intent_share: snapshotTheme.high_intent_share, interpretation: score >= 0.65 ? "Demand is strong while current positioning gives limited emphasis." : score >= 0.35 ? "Demand is present and positioning could make the need more explicit." : "Current evidence does not show a material positioning gap.", confidence: clamp(Math.min(snapshot.confidence, snapshotTheme.confidence)), measurement_metadata: json({ formula: GAP_FORMULA_VERSION, sampleQuality: snapshot.measurement_quality, sampleFactor: sampleFactor(snapshot.measurement_quality) }), gap_engine_version_id: gapEngineVersionId, input_fingerprint: fingerprint });
      result.push(gap);
      await this.repository.linkProvenance({ derivedEvidenceNodeId: gap.evidence_node_id, sourceEvidenceNodeId: snapshot.evidence_node_id, relationType: "compares_demand_snapshot", engineVersionId: gapEngineVersionId });
      await this.repository.linkProvenance({ derivedEvidenceNodeId: gap.evidence_node_id, sourceEvidenceNodeId: productSnapshot.evidence_node_id, relationType: "compares_product_snapshot", engineVersionId: gapEngineVersionId });
      const demandTheme = themes.find((item) => item.theme_key === gap.concept_key); if (demandTheme) await this.repository.linkProvenance({ derivedEvidenceNodeId: gap.evidence_node_id, sourceEvidenceNodeId: demandTheme.evidence_node_id, relationType: "uses_demand_theme", engineVersionId: gapEngineVersionId });
      const profile = await this.intelligence.getDemandProfileById(snapshot.demand_profile_id); if (profile) await this.repository.linkProvenance({ derivedEvidenceNodeId: gap.evidence_node_id, sourceEvidenceNodeId: profile.evidence_node_id, relationType: "uses_demand_profile", engineVersionId: gapEngineVersionId });
    }
    return result;
  }

  async calculateDemandDrift(current: DemandSnapshotRow, previous: DemandSnapshotRow, driftEngineVersionId: string): Promise<DemandDriftRow[]> {
    if (current.workspace_id !== previous.workspace_id || current.product_id !== previous.product_id || current.window_type !== previous.window_type) throw new AppError("VALIDATION_ERROR", "Drift requires comparable snapshots for the same product and window.");
    const currentEnd = new Date(current.period_end).getTime(); const currentStart = new Date(current.period_start).getTime(); const previousEnd = new Date(previous.period_end).getTime(); const previousStart = new Date(previous.period_start).getTime();
    if (Math.abs((currentEnd - currentStart) - (previousEnd - previousStart)) > 60_000) throw new AppError("VALIDATION_ERROR", "Drift requires equal-length time windows.");
    const currentThemes = await this.repository.listSnapshotThemes(current.id); const previousThemes = await this.repository.listSnapshotThemes(previous.id);
    const concepts = unique([...currentThemes.map((item) => item.theme_key), ...previousThemes.map((item) => item.theme_key)]).sort();
    const enoughSample = Math.min(current.sample_size, previous.sample_size) >= 5;
    const result: DemandDriftRow[] = [];
    const existingDrifts = await this.repository.listDrifts(current.workspace_id, current.product_id, current.id);
    for (const conceptKey of concepts) {
      const now = currentThemes.find((item) => item.theme_key === conceptKey); const before = previousThemes.find((item) => item.theme_key === conceptKey);
      const currentMentions = now?.mention_count ?? 0; const previousMentions = before?.mention_count ?? 0; const currentShare = now?.share_of_demand ?? 0; const previousShare = before?.share_of_demand ?? 0; const shareDelta = currentShare - previousShare; const currentHighIntentShare = now?.high_intent_share ?? 0; const previousHighIntentShare = before?.high_intent_share ?? 0;
      const direction: DemandDirection = calculateDriftDirection(currentShare, previousShare, currentMentions, previousMentions, enoughSample); const significance = calculateSignificance(shareDelta, enoughSample); const confidence = clamp(Math.min(current.confidence, previous.confidence) * Math.min(1, Math.min(current.sample_size, previous.sample_size) / 20));
      const fingerprint = sha256Json({ currentId: current.id, previousId: previous.id, conceptKey, driftEngineVersionId, currentMentions, previousMentions });
      const drift = existingDrifts.find((item) => item.input_fingerprint === fingerprint) ?? await this.repository.createDrift({ id: uuid(`drift:${current.id}:${previous.id}:${conceptKey}:${driftEngineVersionId}`), workspace_id: current.workspace_id, product_id: current.product_id, current_snapshot_id: current.id, previous_snapshot_id: previous.id, theme_id: now?.theme_id ?? null, evidence_node_id: uuid(`evidence:drift:${current.id}:${previous.id}:${conceptKey}:${driftEngineVersionId}`), concept_key: conceptKey, current_mentions: currentMentions, previous_mentions: previousMentions, current_share: currentShare, previous_share: previousShare, share_delta: shareDelta, current_high_intent_share: currentHighIntentShare, previous_high_intent_share: previousHighIntentShare, high_intent_delta: currentHighIntentShare - previousHighIntentShare, growth_rate: calculateGrowthRate(currentMentions, previousMentions), drift_direction: direction, significance, confidence, measurement_metadata: json({ formula: DRIFT_FORMULA_VERSION, minimumSample: 5, sampleSize: { current: current.sample_size, previous: previous.sample_size } }), drift_engine_version_id: driftEngineVersionId, input_fingerprint: fingerprint });
      result.push(drift);
      await this.repository.linkProvenance({ derivedEvidenceNodeId: drift.evidence_node_id, sourceEvidenceNodeId: current.evidence_node_id, relationType: "compares_current_snapshot", engineVersionId: driftEngineVersionId });
      await this.repository.linkProvenance({ derivedEvidenceNodeId: drift.evidence_node_id, sourceEvidenceNodeId: previous.evidence_node_id, relationType: "compares_previous_snapshot", engineVersionId: driftEngineVersionId });
    }
    await this.materializePhraseDrift(current, previous, driftEngineVersionId, false);
    await this.materializePhraseDrift(current, previous, driftEngineVersionId, true);
    return result;
  }

  private async materializePhraseDrift(current: DemandSnapshotRow, previous: DemandSnapshotRow, engineVersionId: string, alternatives: boolean) {
    const currentRows = alternatives ? await this.repository.listSnapshotAlternatives(current.id) : await this.repository.listSnapshotPhrases(current.id);
    const previousRows = alternatives ? await this.repository.listSnapshotAlternatives(previous.id) : await this.repository.listSnapshotPhrases(previous.id);
    const existingRows = alternatives ? await this.repository.listDriftAlternatives(current.id, previous.id) : await this.repository.listDriftPhrases(current.id, previous.id);
    const values = unique([...currentRows.map((item) => item.normalized_value), ...previousRows.map((item) => item.normalized_value)]).sort();
    const enoughSample = Math.min(current.sample_size, previous.sample_size) >= 5;
    for (const normalizedValue of values) {
      const now = currentRows.find((item) => item.normalized_value === normalizedValue); const before = previousRows.find((item) => item.normalized_value === normalizedValue); const currentMentions = now?.mention_count ?? 0; const previousMentions = before?.mention_count ?? 0; const direction = calculateDriftDirection(currentMentions / Math.max(1, current.sample_size), previousMentions / Math.max(1, previous.sample_size), currentMentions, previousMentions, enoughSample); const common = { workspace_id: current.workspace_id, current_snapshot_id: current.id, previous_snapshot_id: previous.id, normalized_value: normalizedValue, current_mentions: currentMentions, previous_mentions: previousMentions, growth_rate: calculateGrowthRate(currentMentions, previousMentions), drift_direction: direction, confidence: clamp(Math.min(current.confidence, previous.confidence) * Math.min(1, Math.min(current.sample_size, previous.sample_size) / 20)), evidence_node_id: uuid(`evidence:${alternatives ? "alternative" : "phrase"}-drift:${current.id}:${previous.id}:${normalizedValue}:${engineVersionId}`), drift_engine_version_id: engineVersionId };
      if (!existingRows.some((item) => item.normalized_value === normalizedValue)) {
        if (alternatives) {
          await this.repository.createDriftAlternative({ ...common, alternative: (now as DemandSnapshotAlternativeRow | undefined)?.alternative ?? (before as DemandSnapshotAlternativeRow | undefined)?.alternative ?? normalizedValue });
        } else {
          await this.repository.createDriftPhrase({ ...common, phrase: (now as DemandSnapshotPhraseRow | undefined)?.phrase ?? (before as DemandSnapshotPhraseRow | undefined)?.phrase ?? normalizedValue });
        }
      }
    }
  }

  async getDemandMap(workspaceId: string, productId: string, window: DemandWindow): Promise<DemandMapReadModel> {
    const snapshot = (await this.repository.listSnapshots(workspaceId, productId, window))[0];
    if (!snapshot) throw new AppError("NOT_FOUND", "Demand map snapshot was not found.");
    const [themes, phrases, alternatives, intents] = await Promise.all([this.repository.listSnapshotThemes(snapshot.id), this.repository.listSnapshotPhrases(snapshot.id), this.repository.listSnapshotAlternatives(snapshot.id), this.repository.listSnapshotIntents(snapshot.id)]);
    return { snapshot, themes, phrases, alternatives, intents, provenance: { evidenceNodeId: snapshot.evidence_node_id, sourceIds: [...themes, ...phrases, ...alternatives, ...intents].map((item) => item.evidence_node_id) } };
  }

  async getDemandGap(workspaceId: string, productId: string, snapshotId?: string): Promise<DemandGapReadModel> {
    const snapshot = snapshotId ? (await this.repository.listSnapshots(workspaceId, productId)).find((item) => item.id === snapshotId) : (await this.repository.listSnapshots(workspaceId, productId))[0];
    if (!snapshot) throw new AppError("NOT_FOUND", "Demand map snapshot was not found.");
    return { gaps: await this.repository.listGaps(workspaceId, productId, snapshot.id), snapshotId: snapshot.id };
  }

  async getDemandDrift(workspaceId: string, productId: string, window: DemandWindow): Promise<DemandDriftReadModel> {
    // Drift comparability v1: only adjacent, equal-length windows are a trend.
    const comparable = selectComparableDrifts(await this.repository.listSnapshots(workspaceId, productId, window), await this.repository.listDrifts(workspaceId, productId), window);
    if (!comparable) throw new AppError("NOT_FOUND", "Two comparable demand snapshots are required for drift.");
    const { current, previous } = comparable;
    return { drifts: [...comparable.drifts].sort((a, b) => b.share_delta - a.share_delta), phraseDrifts: await this.repository.listDriftPhrases(current.id, previous.id), alternativeDrifts: await this.repository.listDriftAlternatives(current.id, previous.id), currentSnapshotId: current.id, previousSnapshotId: previous.id };
  }

  async replayDemandSnapshots(input: { product: ProductRow; profile: DemandProfileRow; periods: Array<{ window: DemandWindow; periodEnd: string }>; mapEngineVersionId: string; themeEngineVersionId?: string }): Promise<DemandSnapshotRow[]> {
    const results: DemandSnapshotRow[] = [];
    for (const period of input.periods) results.push(await this.aggregateDemand({ ...input, ...period }));
    return results;
  }

  async backfillDemandSnapshots(input: { product: ProductRow; profile: DemandProfileRow; windows: DemandWindow[]; periodEnds: string[]; mapEngineVersionId: string; themeEngineVersionId?: string }): Promise<DemandSnapshotRow[]> {
    return this.replayDemandSnapshots({ ...input, periods: input.periodEnds.flatMap((periodEnd) => input.windows.map((window) => ({ window, periodEnd }))) });
  }
}
