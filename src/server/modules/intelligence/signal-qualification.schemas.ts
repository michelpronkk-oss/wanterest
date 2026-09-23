import { z } from "zod";

export const signalQualificationStatusSchema = z.enum(["rejected", "weak_candidate", "qualified", "high_confidence_signal"]);
export type SignalQualificationStatus = z.infer<typeof signalQualificationStatusSchema>;

export const demandDirectionSchema = z.enum(["toward_product", "toward_category", "away_from_product", "contextual", "unknown"]);
export type DemandDirection = z.infer<typeof demandDirectionSchema>;

export const demandTargetTypeSchema = z.enum(["scanned_product", "category", "third_party_product", "implementation", "unknown"]);
export type DemandTargetType = z.infer<typeof demandTargetTypeSchema>;

export const speakerRoleSchema = z.enum(["buyer", "maintainer", "unknown"]);
export type SpeakerRole = z.infer<typeof speakerRoleSchema>;

export const signalQualificationPrimaryIntentSchema = z.enum([
  "switching_intent",
  "alternative_search",
  "recommendation_request",
  "purchase_research",
  "problem_solution_search",
  "feature_requirement",
  "comparison_intent",
  "vendor_evaluation",
  "renewal_reconsideration",
  "explicit_pain",
  "unmet_need",
  "unknown",
]);
export type SignalQualificationPrimaryIntent = z.infer<typeof signalQualificationPrimaryIntentSchema>;

export const intentTargetSchema = z.enum(["product", "authentication", "implementation", "unknown"]);
export type IntentTarget = z.infer<typeof intentTargetSchema>;

export const signalQualificationReasonCodeSchema = z.enum([
  "STRONG_SWITCHING_INTENT",
  "STRONG_ALTERNATIVE_INTENT",
  "CLEAR_FEATURE_REQUIREMENT",
  "CLEAR_BUYER_CONTEXT",
  "SPECIFIC_PAIN",
  "HIGH_PRODUCT_RELEVANCE",
  "STRONG_EVIDENCE",
  "COMMERCIAL_CONTEXT_PRESENT",
  "RECOMMENDATION_INTENT",
  "COMPARISON_INTENT",
  "EXPLICIT_PAIN",
  "SHORT_EXPLICIT_DEMAND",
  "BUYER_CONTEXT_PRESENT",
  "FEATURE_ADOPTION_BARRIER",
  "GEO_CONTEXT_MATCH",
  "INSUFFICIENT_SPECIFICITY",
  "INSUFFICIENT_INTENT",
  "GENERIC_BRAND_MENTION",
  "GENERIC_COMPLAINT",
  "PROMOTIONAL_CONTENT",
  "SPAM_RISK",
  "NOISE_RISK",
  "MEME_OR_JOKE",
  "NEWS_ONLY",
  "LINK_ONLY",
  "DUPLICATE_CONTENT",
  "LOW_RELEVANCE",
  "GEO_MISMATCH",
  "INSUFFICIENT_EVIDENCE",
  "LOW_PROFILE_CONFIDENCE",
  "ENGAGEMENT_NOT_QUALIFYING",
  "QUALIFICATION_FAILED",
  "NON_POSITIVE_PRODUCT_DIRECTION",
]);
export type SignalQualificationReasonCode = z.infer<typeof signalQualificationReasonCodeSchema>;

export const signalQualificationDimensionSchema = z.number().min(0).max(1);

export const signalQualificationDimensionsSchema = z.object({
  product_relevance: signalQualificationDimensionSchema,
  demand_intent: signalQualificationDimensionSchema,
  specificity: signalQualificationDimensionSchema,
  pain_clarity: signalQualificationDimensionSchema,
  buyer_plausibility: signalQualificationDimensionSchema,
  commercial_relevance: signalQualificationDimensionSchema,
  evidence_quality: signalQualificationDimensionSchema,
  freshness: signalQualificationDimensionSchema,
  source_quality: signalQualificationDimensionSchema,
  noise_risk: signalQualificationDimensionSchema,
  spam_probability: signalQualificationDimensionSchema,
  promotional_probability: signalQualificationDimensionSchema,
});
export type SignalQualificationDimensions = z.infer<typeof signalQualificationDimensionsSchema>;

export const signalQualificationEvidenceSpanSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  source_item_id: z.string().uuid(),
  start_offset: z.number().int().nonnegative().nullable(),
  end_offset: z.number().int().positive().nullable(),
  evidence_type: z.enum(["intent", "pain", "switching", "feature_requirement", "comparison", "recommendation", "commercial_context", "buyer_context"]),
  confidence: signalQualificationDimensionSchema,
});
export type SignalQualificationEvidenceSpan = z.infer<typeof signalQualificationEvidenceSpanSchema>;

export const marketResonanceSchema = z.object({
  available: z.boolean(),
  score: signalQualificationDimensionSchema,
  likes: z.number().nonnegative().nullable(),
  replies: z.number().nonnegative().nullable(),
  reposts: z.number().nonnegative().nullable(),
  upvotes: z.number().nonnegative().nullable(),
  reactions: z.number().nonnegative().nullable(),
  comments: z.number().nonnegative().nullable(),
  source_normalized_metrics: z.record(z.string(), z.number().min(0)),
  reason: z.string().trim().min(1).max(500),
});
export type MarketResonance = z.infer<typeof marketResonanceSchema>;

export const signalQualificationDiagnosticsSchema = z.object({
  qualification_version: z.string().trim().min(1).max(120),
  threshold_version: z.string().trim().min(1).max(120),
  analysis_version: z.string().trim().max(120).nullable(),
  demand_profile_version: z.string().trim().max(120).nullable(),
  profile_confidence: signalQualificationDimensionSchema,
  evidence_validated: z.boolean(),
  gate_failures: z.array(z.string().trim().min(1).max(120)).max(20),
  failed: z.boolean(),
  failure_code: z.string().trim().max(120).nullable(),
});
export type SignalQualificationDiagnostics = z.infer<typeof signalQualificationDiagnosticsSchema>;

export const signalQualificationSchema = z.object({
  // Intentionally a generic version string, not z.literal(CURRENT_VERSION): this schema also
  // parses historical evaluation rows persisted under an older SIGNAL_QUALIFICATION_VERSION
  // (see qualificationFromEvidence). Pinning it to the current literal would make every past
  // qualification version bump retroactively fail to parse old rows — rankEvaluation and
  // materializeSignal would then treat every pre-existing qualified signal as unqualified and
  // archive it the next time it's touched, purely because the version string moved on.
  version: z.string().trim().min(1).max(120),
  candidate_id: z.string().uuid(),
  product_id: z.string().uuid(),
  status: signalQualificationStatusSchema,
  demand_quality_score: signalQualificationDimensionSchema,
  confidence: signalQualificationDimensionSchema,
  dimensions: signalQualificationDimensionsSchema,
  primary_intent: signalQualificationPrimaryIntentSchema,
  intent_target: intentTargetSchema.default("unknown"),
  demand_direction: demandDirectionSchema.default("unknown"),
  demand_target_type: demandTargetTypeSchema.default("unknown"),
  demand_target_name: z.string().trim().max(160).nullable().default(null),
  source_products: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  speaker_role: speakerRoleSchema.default("unknown"),
  matched_profile_concepts: z.array(z.string().trim().min(1).max(300)).max(50),
  evidence_spans: z.array(signalQualificationEvidenceSpanSchema).max(20),
  reason_codes: z.array(signalQualificationReasonCodeSchema).max(30),
  qualification_reason: z.string().trim().min(1).max(2_000),
  resonance: marketResonanceSchema,
  diagnostics: signalQualificationDiagnosticsSchema,
});
export type SignalQualification = z.infer<typeof signalQualificationSchema>;
