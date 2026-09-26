import { z } from "zod";

export const signalQualificationStatusSchema = z.enum(["rejected", "weak_candidate", "qualified", "high_confidence_signal"]);
export type SignalQualificationStatus = z.infer<typeof signalQualificationStatusSchema>;

export const demandDirectionSchema = z.enum(["toward_product", "toward_category", "away_from_product", "contextual", "unknown"]);
export type DemandDirection = z.infer<typeof demandDirectionSchema>;

export const demandTargetTypeSchema = z.enum(["scanned_product", "category", "third_party_product", "implementation", "unknown"]);
export type DemandTargetType = z.infer<typeof demandTargetTypeSchema>;

export const speakerRoleSchema = z.enum(["buyer", "maintainer", "unknown"]);
export type SpeakerRole = z.infer<typeof speakerRoleSchema>;

export const authorialStanceSchema = z.enum(["buyer", "vendor_marketing", "third_party_technical_discussion", "unknown"]);
export type AuthorialStanceValue = z.infer<typeof authorialStanceSchema>;

export const marketRelationshipTypeSchema = z.enum(["direct_competitor", "indirect_competitor", "substitute", "adjacent_product", "integration_complement", "legacy_manual_substitute"]);
export const marketRelationshipSourceSchema = z.enum(["onboarding", "website", "structured_profile", "conversation", "external_evidence"]);
export const marketRelationshipSchema = z.object({
  entity_name: z.string().trim().min(1).max(160),
  relationship_type: marketRelationshipTypeSchema,
  confidence: z.number().min(0).max(1),
  source: marketRelationshipSourceSchema,
  evidence: z.array(z.object({ source_reference: z.string().trim().min(1).max(2_000), excerpt: z.string().trim().max(1_000).nullable(), field_path: z.string().trim().min(1).max(180) })).max(4),
  discovered_at: z.string().datetime().nullable(),
  last_supported_at: z.string().datetime().nullable(),
});
export const marketContextSchema = z.object({
  version: z.string().trim().min(1).max(120),
  product_name: z.string().trim().min(1).max(160),
  categories: z.array(z.string().trim().min(1).max(180)).max(12),
  capabilities: z.array(z.string().trim().min(1).max(180)).max(20),
  jobs_to_be_done: z.array(z.string().trim().min(1).max(500)).max(12),
  pains_solved: z.array(z.string().trim().min(1).max(180)).max(12),
  buyer_roles: z.array(z.string().trim().min(1).max(180)).max(20),
  relationships: z.array(marketRelationshipSchema).max(24),
});
export type MarketContext = z.infer<typeof marketContextSchema>;

export const conversationProductMentionSchema = z.object({
  name: z.string().trim().min(1).max(160),
  role: z.enum(["source", "destination", "host", "competitor_reference", "implementation_context", "mentioned"]),
  confidence: z.number().min(0).max(1),
});
export const conversationMarketReasoningSchema = z.object({
  version: z.string().trim().min(1).max(120),
  actor_type: speakerRoleSchema,
  actor_confidence: z.number().min(0).max(1),
  buyer_context: z.boolean(),
  buyer_context_confidence: z.number().min(0).max(1),
  current_solution: z.string().trim().max(160).nullable(),
  pain_summary: z.string().trim().max(300).nullable(),
  requested_outcome: z.string().trim().max(300).nullable(),
  demand_target_type: demandTargetTypeSchema,
  demand_target: z.string().trim().max(160).nullable(),
  source_products: z.array(z.string().trim().min(1).max(160)).max(20),
  destination_products: z.array(z.string().trim().min(1).max(160)).max(10),
  mentioned_products: z.array(conversationProductMentionSchema).max(24),
  direction_relative_to_scanned_product: demandDirectionSchema,
  category_or_job_demand: z.boolean(),
  commercial_intent: z.boolean(),
  first_party_experience: z.boolean(),
  implementation_only: z.boolean(),
  promotional_content: z.boolean(),
  confidence: z.number().min(0).max(1),
  evidence_spans: z.array(z.object({ text: z.string().trim().min(1).max(500), confidence: z.number().min(0).max(1) })).max(8),
  short_user_facing_summary: z.string().trim().min(1).max(300),
  short_user_facing_why: z.string().trim().min(1).max(300),
  relationship_candidates: z.array(z.object({ entity_name: z.string().trim().min(1).max(160), relationship_type: marketRelationshipTypeSchema, confidence: z.number().min(0).max(1), evidence_count: z.number().int().positive().max(100) })).max(5),
  // Additive (12A.3A.1): distinct from actor_type/speaker_role - whether the
  // author is pitching their own product versus expressing independent buyer
  // demand. Defaults to "unknown" so every pre-existing stored row still parses.
  authorial_stance: authorialStanceSchema.default("unknown"),
});
export type ConversationMarketReasoning = z.infer<typeof conversationMarketReasoningSchema>;

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
  "EVIDENCE_GROUNDING_DOWNGRADED",
  "VENDOR_PITCH_NOT_BUYER_DEMAND",
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
  market_context_version: z.string().trim().min(1).max(120).default("unknown"),
  conversation_reasoning_version: z.string().trim().min(1).max(120).default("unknown"),
  analysis_version: z.string().trim().max(120).nullable(),
  demand_profile_version: z.string().trim().max(120).nullable(),
  profile_confidence: signalQualificationDimensionSchema,
  evidence_validated: z.boolean(),
  gate_failures: z.array(z.string().trim().min(1).max(120)).max(20),
  failed: z.boolean(),
  failure_code: z.string().trim().max(120).nullable(),
  // Additive (12A.3A.1): whether semantic_reasoning_router_v1 flagged this
  // candidate as needing verification, and which claim(s) were downgraded to
  // their safe/unknown default because no verified reasoning was available.
  grounding_version: z.string().trim().min(1).max(120).default("unknown"),
  grounding_verification_required: z.boolean().default(false),
  grounding_downgraded_claims: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
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
  market_context: marketContextSchema.default({ version: "unknown", product_name: "unknown", categories: [], capabilities: [], jobs_to_be_done: [], pains_solved: [], buyer_roles: [], relationships: [] }),
  conversation_reasoning: conversationMarketReasoningSchema.default({ version: "unknown", actor_type: "unknown", actor_confidence: 0, buyer_context: false, buyer_context_confidence: 0, current_solution: null, pain_summary: null, requested_outcome: null, demand_target_type: "unknown", demand_target: null, source_products: [], destination_products: [], mentioned_products: [], direction_relative_to_scanned_product: "unknown", category_or_job_demand: false, commercial_intent: false, first_party_experience: false, implementation_only: false, promotional_content: false, confidence: 0, evidence_spans: [], short_user_facing_summary: "Conversation context is unknown.", short_user_facing_why: "No supported market interpretation is available.", relationship_candidates: [], authorial_stance: "unknown" }),
  demand_direction: demandDirectionSchema.default("unknown"),
  demand_target_type: demandTargetTypeSchema.default("unknown"),
  demand_target_name: z.string().trim().max(160).nullable().default(null),
  source_products: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  speaker_role: speakerRoleSchema.default("unknown"),
  matched_profile_concepts: z.array(z.string().trim().min(1).max(300)).max(50),
  evidence_spans: z.array(signalQualificationEvidenceSpanSchema).max(20),
  reason_codes: z.array(signalQualificationReasonCodeSchema).max(30),
  qualification_reason: z.string().trim().min(1).max(2_000),
  // Additive (12A.3A.1): the evidence's own published date, surfaced separately
  // from discovery/scan time so wording never implies an old conversation is
  // current. Sourced from the same published_at/captured_at precedence
  // freshnessScore already uses; scoring itself is unchanged.
  evidence_published_at: z.string().datetime().nullable().default(null),
  resonance: marketResonanceSchema,
  diagnostics: signalQualificationDiagnosticsSchema,
});
export type SignalQualification = z.infer<typeof signalQualificationSchema>;
