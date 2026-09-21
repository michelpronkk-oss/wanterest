import { z } from "zod";

import { businessModelSchema, businessTypeSchema, deliveryModelSchema, marketScopeSchema, technicalOrientationSchema } from "./business-classification.schemas";

export const demandProfileV2Version = "demand_profile_v2" as const;

export const buyingIntentTypeSchema = z.enum([
  "alternative_search",
  "recommendation_request",
  "switching_intent",
  "purchase_research",
  "problem_solution_search",
  "feature_requirement",
  "comparison_intent",
  "vendor_evaluation",
  "renewal_reconsideration",
  "unknown",
]);
export type BuyingIntentType = z.infer<typeof buyingIntentTypeSchema>;

export const competitorRelationshipTypeSchema = z.enum(["direct_competitor", "adjacent_competitor", "unknown"]);
export type CompetitorRelationshipType = z.infer<typeof competitorRelationshipTypeSchema>;

export const alternativeTypeSchema = z.enum(["competitor_product", "manual_process", "internal_build", "service_provider", "generic_tool", "status_quo", "other"]);
export type AlternativeType = z.infer<typeof alternativeTypeSchema>;

const confidenceSchema = z.number().min(0).max(1);
const keySchema = z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(120);
const shortLabelSchema = z.string().trim().min(1).max(180);
const boundedLabels = (max: number) => z.array(shortLabelSchema).max(max);

export const demandProfileV2EvidenceSchema = z.object({
  source_type: z.enum(["product_snapshot", "website_text", "url_metadata", "user_hint"]),
  source_reference: z.string().trim().min(1).max(2_000),
  field_path: z.string().trim().min(1).max(180),
  excerpt: z.string().trim().max(1_000).nullable(),
  reason: z.string().trim().min(1).max(1_000),
  confidence: confidenceSchema,
}).strict();
export type DemandProfileV2Evidence = z.infer<typeof demandProfileV2EvidenceSchema>;

const evidenceList = z.array(demandProfileV2EvidenceSchema).max(8);

export const demandPainSchema = z.object({
  key: keySchema,
  label: shortLabelSchema,
  description: z.string().trim().min(1).max(500),
  severity_hint: confidenceSchema.nullable(),
  specificity: confidenceSchema,
  confidence: confidenceSchema,
  evidence: evidenceList,
}).strict();
export type DemandPain = z.infer<typeof demandPainSchema>;

export const desiredOutcomeSchema = z.object({
  key: keySchema,
  label: shortLabelSchema,
  description: z.string().trim().min(1).max(500),
  confidence: confidenceSchema,
  evidence: evidenceList,
}).strict();
export type DesiredOutcome = z.infer<typeof desiredOutcomeSchema>;

export const jobToBeDoneSchema = z.object({
  key: keySchema,
  job: z.string().trim().min(1).max(500),
  actor: shortLabelSchema,
  desired_result: z.string().trim().min(1).max(300),
  context: z.string().trim().max(300).nullable(),
  confidence: confidenceSchema,
  evidence: evidenceList,
}).strict();
export type JobToBeDone = z.infer<typeof jobToBeDoneSchema>;

export const switchingTriggerSchema = z.object({
  key: keySchema,
  trigger: shortLabelSchema,
  description: z.string().trim().min(1).max(500),
  confidence: confidenceSchema,
  evidence: evidenceList,
}).strict();
export type SwitchingTrigger = z.infer<typeof switchingTriggerSchema>;

export const buyingIntentSchema = z.object({
  intent_type: buyingIntentTypeSchema,
  relevance: confidenceSchema,
  reason: z.string().trim().min(1).max(500),
  evidence: evidenceList,
}).strict();
export type BuyingIntent = z.infer<typeof buyingIntentSchema>;

export const featureDemandSchema = z.object({
  key: keySchema,
  feature: shortLabelSchema,
  category: shortLabelSchema.nullable(),
  importance_hint: confidenceSchema,
  confidence: confidenceSchema,
  evidence: evidenceList,
}).strict();
export type FeatureDemand = z.infer<typeof featureDemandSchema>;

export const objectionSchema = z.object({
  key: keySchema,
  objection: shortLabelSchema,
  description: z.string().trim().min(1).max(500),
  confidence: confidenceSchema,
  evidence: evidenceList,
}).strict();
export type Objection = z.infer<typeof objectionSchema>;

export const knownCompetitorSchema = z.object({
  key: keySchema,
  name: shortLabelSchema,
  domain: z.string().trim().max(253).nullable(),
  relationship_type: competitorRelationshipTypeSchema,
  reason: z.string().trim().min(1).max(500),
  confidence: confidenceSchema,
  evidence: evidenceList,
}).strict();
export type KnownCompetitor = z.infer<typeof knownCompetitorSchema>;

export const detectedCompetitorCandidateSchema = z.object({
  key: keySchema,
  name: shortLabelSchema,
  domain: z.string().trim().max(253).nullable(),
  reason: z.string().trim().min(1).max(500),
  confidence: confidenceSchema,
  evidence: evidenceList,
}).strict();
export type DetectedCompetitorCandidate = z.infer<typeof detectedCompetitorCandidateSchema>;

export const alternativeSolutionSchema = z.object({
  key: keySchema,
  label: shortLabelSchema,
  alternative_type: alternativeTypeSchema,
  reason: z.string().trim().min(1).max(500),
  confidence: confidenceSchema,
  evidence: evidenceList,
}).strict();
export type AlternativeSolution = z.infer<typeof alternativeSolutionSchema>;

export const comparisonTermSchema = z.object({
  key: keySchema,
  term: shortLabelSchema,
  intent_type: buyingIntentTypeSchema,
  confidence: confidenceSchema,
  evidence: evidenceList,
}).strict();
export type ComparisonTerm = z.infer<typeof comparisonTermSchema>;

export const demandProfileV2IdentitySchema = z.object({
  product_name: shortLabelSchema,
  company_name: shortLabelSchema.nullable(),
  primary_category: shortLabelSchema,
  secondary_categories: boundedLabels(20),
  business_type: businessTypeSchema,
  business_model: businessModelSchema,
  delivery_model: deliveryModelSchema,
  technical_orientation: technicalOrientationSchema,
  market_scope: marketScopeSchema,
}).strict();
export type DemandProfileV2Identity = z.infer<typeof demandProfileV2IdentitySchema>;

export const demandProfileV2AudienceSchema = z.object({
  target_customer_types: boundedLabels(20),
  buyer_roles: boundedLabels(20),
  end_user_types: boundedLabels(20),
  company_size_segments: boundedLabels(10),
  industry_segments: boundedLabels(20),
}).strict();
export type DemandProfileV2Audience = z.infer<typeof demandProfileV2AudienceSchema>;

export const demandProfileV2LanguageSchema = z.object({
  category_terms: boundedLabels(20),
  pain_phrases: boundedLabels(20),
  outcome_phrases: boundedLabels(20),
  switching_phrases: boundedLabels(20),
  comparison_phrases: boundedLabels(20),
  recommendation_phrases: boundedLabels(20),
  feature_terms: boundedLabels(20),
}).strict();
export type DemandProfileV2Language = z.infer<typeof demandProfileV2LanguageSchema>;

export const demandProfileV2GeographySchema = z.object({
  market_scope: marketScopeSchema,
  primary_country_code: z.string().regex(/^[A-Z]{2}$/).nullable(),
  primary_region: shortLabelSchema.nullable(),
  primary_city: shortLabelSchema.nullable(),
  location_dependency: confidenceSchema,
  demand_geography_terms: boundedLabels(20),
}).strict();
export type DemandProfileV2Geography = z.infer<typeof demandProfileV2GeographySchema>;

export const demandProfileV2ConfidenceSchema = z.object({
  overall_profile_confidence: confidenceSchema,
  audience: confidenceSchema,
  problems: confidenceSchema,
  outcomes: confidenceSchema,
  jtbd: confidenceSchema,
  switching: confidenceSchema,
  feature_demand: confidenceSchema,
  competitors: confidenceSchema,
  alternatives: confidenceSchema,
  language: confidenceSchema,
  geography: confidenceSchema,
}).strict();
export type DemandProfileV2Confidence = z.infer<typeof demandProfileV2ConfidenceSchema>;

export const demandProfileV2Schema = z.object({
  identity: demandProfileV2IdentitySchema,
  audience: demandProfileV2AudienceSchema,
  problems: z.array(demandPainSchema).max(12),
  desired_outcomes: z.array(desiredOutcomeSchema).max(12),
  jobs_to_be_done: z.array(jobToBeDoneSchema).max(10),
  switching_triggers: z.array(switchingTriggerSchema).max(10),
  buying_intents: z.array(buyingIntentSchema).max(10),
  feature_demands: z.array(featureDemandSchema).max(15),
  objections: z.array(objectionSchema).max(10),
  language: demandProfileV2LanguageSchema,
  competitors: z.object({
    known_competitors: z.array(knownCompetitorSchema).max(10),
    detected_competitor_candidates: z.array(detectedCompetitorCandidateSchema).max(10),
  }).strict(),
  alternatives: z.array(alternativeSolutionSchema).max(10),
  comparison_terms: z.array(comparisonTermSchema).max(20),
  geography: demandProfileV2GeographySchema,
  confidence: demandProfileV2ConfidenceSchema,
  evidence: z.array(demandProfileV2EvidenceSchema).max(50),
  version: z.literal(demandProfileV2Version),
  engine_version_id: z.string().uuid().nullable(),
  provider: z.string().trim().min(1).max(120),
  model: z.string().trim().max(120).nullable(),
  prompt_version: z.string().trim().max(120).nullable(),
}).strict();
export type DemandProfileV2 = z.infer<typeof demandProfileV2Schema>;

/** Permissive LLM boundary; deterministic normalization is authoritative. */
export const demandProfileV2DraftSchema = z.object({}).passthrough();
export type DemandProfileV2Draft = z.infer<typeof demandProfileV2DraftSchema>;
