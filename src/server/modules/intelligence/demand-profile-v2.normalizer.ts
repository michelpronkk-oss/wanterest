import type { BusinessClassification } from "./business-classification.schemas";
import { businessModelSchema, businessTypeSchema, deliveryModelSchema, marketScopeSchema, technicalOrientationSchema } from "./business-classification.schemas";
import { demandProfileV2DraftSchema, demandProfileV2Schema, buyingIntentTypeSchema, competitorRelationshipTypeSchema, alternativeTypeSchema, type DemandProfileV2, type DemandProfileV2Evidence } from "./demand-profile-v2.schemas";

const buyingIntentValues = new Set(buyingIntentTypeSchema.options);
const relationshipValues = new Set(competitorRelationshipTypeSchema.options);
const alternativeValues = new Set(alternativeTypeSchema.options);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function key(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120)
    : "";
}

function text(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  return normalized || null;
}

function label(value: unknown, fallback = "unknown"): string {
  return text(value, 180) ?? fallback;
}

function clamp(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Math.max(0, Math.min(1, Number.isFinite(numeric) ? numeric : fallback));
}

function nullableLabel(value: unknown): string | null {
  return text(value, 180);
}

function labels(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = text(item, 180);
    if (!normalized) continue;
    const comparison = normalized.toLowerCase();
    if (seen.has(comparison)) continue;
    seen.add(comparison);
    result.push(normalized);
    if (result.length >= max) break;
  }
  return result;
}

function enumValue<T extends string>(value: unknown, values: Set<T>, fallback: T): T {
  const normalized = key(value) as T;
  return values.has(normalized) ? normalized : fallback;
}

function countryCode(value: unknown): string | null {
  const normalized = text(value, 80)?.toUpperCase() ?? "";
  const aliases: Record<string, string> = {
    NETHERLANDS: "NL", HOLLAND: "NL", "UNITED STATES": "US", USA: "US", "UNITED KINGDOM": "GB", UK: "GB",
  };
  const code = aliases[normalized] ?? normalized;
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function domain(value: unknown): string | null {
  const raw = text(value, 253)?.toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/, 1)[0].replace(/\.$/, "") ?? "";
  if (!raw || raw.includes("@") || raw.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(raw)) return null;
  return raw;
}

function evidenceList(value: unknown): DemandProfileV2Evidence[] {
  if (!Array.isArray(value)) return [];
  const result: DemandProfileV2Evidence[] = [];
  for (const item of value) {
    const candidate = object(item);
    const sourceType = candidate.source_type;
    const sourceReference = text(candidate.source_reference, 2_000);
    const fieldPath = text(candidate.field_path ?? candidate.field, 180);
    const reason = text(candidate.reason, 1_000);
    if (!sourceReference || !fieldPath || !reason || !["product_snapshot", "website_text", "url_metadata", "user_hint"].includes(String(sourceType))) continue;
    result.push({
      source_type: sourceType as DemandProfileV2Evidence["source_type"],
      source_reference: sourceReference,
      field_path: fieldPath,
      excerpt: text(candidate.excerpt, 1_000),
      reason,
      confidence: clamp(candidate.confidence),
    });
    if (result.length >= 8) break;
  }
  return result;
}

function itemKey(value: unknown, fallback: unknown): string {
  return key(value) || key(fallback) || "unknown_item";
}

function normalizePain(value: unknown) {
  const candidate = object(value);
  const itemLabel = label(candidate.label ?? candidate.pain ?? candidate.problem);
  return {
    key: itemKey(candidate.key, itemLabel),
    label: itemLabel,
    description: label(candidate.description, itemLabel),
    severity_hint: candidate.severity_hint === null ? null : clamp(candidate.severity_hint),
    specificity: clamp(candidate.specificity),
    confidence: clamp(candidate.confidence),
    evidence: evidenceList(candidate.evidence),
  };
}

function normalizeOutcome(value: unknown) {
  const candidate = object(value);
  const itemLabel = label(candidate.label ?? candidate.outcome);
  return { key: itemKey(candidate.key, itemLabel), label: itemLabel, description: label(candidate.description, itemLabel), confidence: clamp(candidate.confidence), evidence: evidenceList(candidate.evidence) };
}

function normalizeJtbd(value: unknown) {
  const candidate = object(value);
  const job = label(candidate.job, "Unknown job");
  return { key: itemKey(candidate.key, job), job, actor: label(candidate.actor), desired_result: label(candidate.desired_result), context: nullableLabel(candidate.context), confidence: clamp(candidate.confidence), evidence: evidenceList(candidate.evidence) };
}

function normalizeSwitching(value: unknown) {
  const candidate = object(value);
  const trigger = label(candidate.trigger);
  return { key: itemKey(candidate.key, trigger), trigger, description: label(candidate.description, trigger), confidence: clamp(candidate.confidence), evidence: evidenceList(candidate.evidence) };
}

function normalizeIntent(value: unknown) {
  const candidate = object(value);
  return { intent_type: enumValue(candidate.intent_type, buyingIntentValues, "unknown"), relevance: clamp(candidate.relevance), reason: label(candidate.reason), evidence: evidenceList(candidate.evidence) };
}

function normalizeFeature(value: unknown) {
  const candidate = object(value);
  const feature = label(candidate.feature);
  return { key: itemKey(candidate.key, feature), feature, category: nullableLabel(candidate.category), importance_hint: clamp(candidate.importance_hint), confidence: clamp(candidate.confidence), evidence: evidenceList(candidate.evidence) };
}

function normalizeObjection(value: unknown) {
  const candidate = object(value);
  const objection = label(candidate.objection);
  return { key: itemKey(candidate.key, objection), objection, description: label(candidate.description, objection), confidence: clamp(candidate.confidence), evidence: evidenceList(candidate.evidence) };
}

function normalizeKnownCompetitor(value: unknown) {
  const candidate = object(value);
  const name = label(candidate.name);
  return { key: itemKey(candidate.key, name), name, domain: domain(candidate.domain), relationship_type: enumValue(candidate.relationship_type, relationshipValues, "unknown"), reason: label(candidate.reason), confidence: clamp(candidate.confidence), evidence: evidenceList(candidate.evidence) };
}

function normalizeCandidate(value: unknown) {
  const candidate = object(value);
  const name = label(candidate.name);
  return { key: itemKey(candidate.key, name), name, domain: domain(candidate.domain), reason: label(candidate.reason), confidence: clamp(candidate.confidence), evidence: evidenceList(candidate.evidence) };
}

function normalizeAlternative(value: unknown) {
  const candidate = object(value);
  const alternativeLabel = label(candidate.label ?? candidate.alternative);
  return { key: itemKey(candidate.key, alternativeLabel), label: alternativeLabel, alternative_type: enumValue(candidate.alternative_type, alternativeValues, "other"), reason: label(candidate.reason, alternativeLabel), confidence: clamp(candidate.confidence), evidence: evidenceList(candidate.evidence) };
}

function normalizeComparison(value: unknown) {
  const candidate = object(value);
  const term = label(candidate.term);
  return { key: itemKey(candidate.key, term), term, intent_type: enumValue(candidate.intent_type, buyingIntentValues, "comparison_intent"), confidence: clamp(candidate.confidence), evidence: evidenceList(candidate.evidence) };
}

function uniqueByKey<T extends { key: string }>(values: T[], max: number): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.key)) return false;
    seen.add(value.key);
    return true;
  }).slice(0, max);
}

function classificationIdentity(value: BusinessClassification | null | undefined, draftIdentity: Record<string, unknown>, productName: string, companyName?: string | null) {
  const primaryCategory = value?.primary_category ?? label(draftIdentity.primary_category);
  return {
    product_name: label(productName),
    company_name: companyName ?? nullableLabel(draftIdentity.company_name),
    primary_category: primaryCategory,
    secondary_categories: labels(value?.secondary_categories ?? draftIdentity.secondary_categories, 20),
    business_type: value?.business_type ?? enumValue(draftIdentity.business_type, new Set(businessTypeSchema.options), "other"),
    business_model: value?.business_model ?? enumValue(draftIdentity.business_model, new Set(businessModelSchema.options), "unknown"),
    delivery_model: value?.delivery_model ?? enumValue(draftIdentity.delivery_model, new Set(deliveryModelSchema.options), "unknown"),
    technical_orientation: value?.technical_orientation ?? enumValue(draftIdentity.technical_orientation, new Set(technicalOrientationSchema.options), "unknown"),
    market_scope: value?.market_scope ?? enumValue(draftIdentity.market_scope, new Set(marketScopeSchema.options), "unknown"),
  };
}

export function normalizeDemandProfileV2(value: unknown, options: { version?: string; engineVersionId?: string | null; provider?: string; model?: string | null; promptVersion?: string | null; productName: string; companyName?: string | null; businessClassification?: BusinessClassification | null }): DemandProfileV2 {
  const draft = demandProfileV2DraftSchema.parse(value) as Record<string, unknown>;
  const draftIdentity = object(draft.identity);
  const draftAudience = object(draft.audience);
  const draftLanguage = object(draft.language);
  const draftCompetitors = object(draft.competitors);
  const draftGeography = object(draft.geography);
  const draftConfidence = object(draft.confidence);
  const identity = classificationIdentity(options.businessClassification, draftIdentity, options.productName, options.companyName);
  const geography = {
    market_scope: options.businessClassification?.market_scope ?? enumValue(draftGeography.market_scope, new Set(marketScopeSchema.options), identity.market_scope),
    primary_country_code: countryCode(options.businessClassification?.primary_country_code ?? draftGeography.primary_country_code),
    primary_region: options.businessClassification?.primary_region ?? nullableLabel(draftGeography.primary_region),
    primary_city: options.businessClassification?.primary_city ?? nullableLabel(draftGeography.primary_city),
    location_dependency: clamp(options.businessClassification?.location_dependency ?? draftGeography.location_dependency),
    demand_geography_terms: labels(draftGeography.demand_geography_terms, 20),
  };
  return demandProfileV2Schema.parse({
    identity,
    audience: {
      target_customer_types: labels(options.businessClassification?.target_customer_types ?? draftAudience.target_customer_types, 20),
      buyer_roles: labels(options.businessClassification?.buyer_roles ?? draftAudience.buyer_roles, 20),
      end_user_types: labels(options.businessClassification?.end_user_types ?? draftAudience.end_user_types, 20),
      company_size_segments: labels(draftAudience.company_size_segments, 10),
      industry_segments: labels(draftAudience.industry_segments, 20),
    },
    problems: uniqueByKey((Array.isArray(draft.problems) ? draft.problems : []).map(normalizePain), 12),
    desired_outcomes: uniqueByKey((Array.isArray(draft.desired_outcomes) ? draft.desired_outcomes : []).map(normalizeOutcome), 12),
    jobs_to_be_done: uniqueByKey((Array.isArray(draft.jobs_to_be_done) ? draft.jobs_to_be_done : []).map(normalizeJtbd), 10),
    switching_triggers: uniqueByKey((Array.isArray(draft.switching_triggers) ? draft.switching_triggers : []).map(normalizeSwitching), 10),
    buying_intents: (Array.isArray(draft.buying_intents) ? draft.buying_intents : []).map(normalizeIntent).filter((item, index, all) => all.findIndex((candidate) => candidate.intent_type === item.intent_type) === index).slice(0, 10),
    feature_demands: uniqueByKey((Array.isArray(draft.feature_demands) ? draft.feature_demands : []).map(normalizeFeature), 15),
    objections: uniqueByKey((Array.isArray(draft.objections) ? draft.objections : []).map(normalizeObjection), 10),
    language: {
      category_terms: labels(draftLanguage.category_terms, 20),
      pain_phrases: labels(draftLanguage.pain_phrases, 20),
      outcome_phrases: labels(draftLanguage.outcome_phrases, 20),
      switching_phrases: labels(draftLanguage.switching_phrases, 20),
      comparison_phrases: labels(draftLanguage.comparison_phrases, 20),
      recommendation_phrases: labels(draftLanguage.recommendation_phrases, 20),
      feature_terms: labels(draftLanguage.feature_terms, 20),
    },
    competitors: {
      known_competitors: uniqueByKey((Array.isArray(draftCompetitors.known_competitors) ? draftCompetitors.known_competitors : []).map(normalizeKnownCompetitor), 10),
      detected_competitor_candidates: uniqueByKey((Array.isArray(draftCompetitors.detected_competitor_candidates) ? draftCompetitors.detected_competitor_candidates : []).map(normalizeCandidate), 10),
    },
    alternatives: uniqueByKey((Array.isArray(draft.alternatives) ? draft.alternatives : []).map(normalizeAlternative), 10),
    comparison_terms: uniqueByKey((Array.isArray(draft.comparison_terms) ? draft.comparison_terms : []).map(normalizeComparison), 20),
    geography,
    confidence: {
      overall_profile_confidence: clamp(draftConfidence.overall_profile_confidence),
      audience: clamp(draftConfidence.audience),
      problems: clamp(draftConfidence.problems),
      outcomes: clamp(draftConfidence.outcomes),
      jtbd: clamp(draftConfidence.jtbd),
      switching: clamp(draftConfidence.switching),
      feature_demand: clamp(draftConfidence.feature_demand),
      competitors: clamp(draftConfidence.competitors),
      alternatives: clamp(draftConfidence.alternatives),
      language: clamp(draftConfidence.language),
      geography: clamp(draftConfidence.geography),
    },
    evidence: evidenceList(draft.evidence).slice(0, 50),
    version: options.version === "demand_profile_v2" ? "demand_profile_v2" : "demand_profile_v2",
    engine_version_id: options.engineVersionId ?? null,
    provider: options.provider ?? "unknown",
    model: options.model ?? null,
    prompt_version: options.promptVersion ?? null,
  });
}
