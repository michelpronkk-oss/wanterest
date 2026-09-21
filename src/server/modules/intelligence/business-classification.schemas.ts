import { z } from "zod";

export const businessTypeSchema = z.enum([
  "b2b_saas",
  "developer_tool",
  "consumer_software",
  "ecommerce",
  "marketplace",
  "service_business",
  "local_business",
  "agency",
  "media_content",
  "other",
]);
export type BusinessType = z.infer<typeof businessTypeSchema>;

export const businessModelSchema = z.enum(["b2b", "b2c", "b2b2c", "mixed", "unknown"]);
export type BusinessModel = z.infer<typeof businessModelSchema>;

export const deliveryModelSchema = z.enum(["software", "physical_product", "digital_product", "service", "marketplace", "content", "mixed", "unknown"]);
export type DeliveryModel = z.infer<typeof deliveryModelSchema>;

export const marketScopeSchema = z.enum(["global", "multi_country", "country", "regional", "local", "unknown"]);
export type MarketScope = z.infer<typeof marketScopeSchema>;

export const technicalOrientationSchema = z.enum(["high", "medium", "low", "unknown"]);
export type TechnicalOrientation = z.infer<typeof technicalOrientationSchema>;

export const commerceTypeSchema = z.enum(["subscription", "transactional", "usage_based", "service_fee", "advertising", "mixed", "unknown"]);
export type CommerceType = z.infer<typeof commerceTypeSchema>;

const confidenceSchema = z.number().min(0).max(1);
const boundedLabelArray = z.array(z.string().trim().min(1).max(160)).max(50);

export const classificationFieldConfidencesSchema = z.object({
  business_type_confidence: confidenceSchema,
  business_model_confidence: confidenceSchema,
  market_scope_confidence: confidenceSchema,
  category_confidence: confidenceSchema,
  delivery_model_confidence: confidenceSchema,
  technical_orientation_confidence: confidenceSchema,
  commerce_type_confidence: confidenceSchema,
  audience_confidence: confidenceSchema,
}).strict();
export type ClassificationFieldConfidences = z.infer<typeof classificationFieldConfidencesSchema>;

export const classificationEvidenceSchema = z.object({
  field: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(1).max(1_000),
  source_type: z.enum(["product_snapshot", "website_text", "url_metadata", "user_hint"]),
  source_reference: z.string().trim().min(1).max(2_000),
  source_path: z.string().trim().min(1).max(300).optional(),
  excerpt: z.string().trim().max(1_000).optional(),
}).strict();
export type ClassificationEvidence = z.infer<typeof classificationEvidenceSchema>;

/** Canonical, persisted Business Classification v1 shape. */
export const businessClassificationSchema = z.object({
  business_type: businessTypeSchema,
  business_model: businessModelSchema,
  delivery_model: deliveryModelSchema,
  market_scope: marketScopeSchema,
  technical_orientation: technicalOrientationSchema,
  commerce_type: commerceTypeSchema,
  primary_category: z.string().trim().min(1).max(160),
  secondary_categories: boundedLabelArray,
  target_customer_types: boundedLabelArray,
  buyer_roles: boundedLabelArray,
  end_user_types: boundedLabelArray,
  primary_country_code: z.string().regex(/^[A-Z]{2}$/).nullable(),
  primary_region: z.string().trim().min(1).max(160).nullable(),
  primary_city: z.string().trim().min(1).max(160).nullable(),
  location_dependency: confidenceSchema,
  overall_confidence: confidenceSchema,
  field_confidences: classificationFieldConfidencesSchema,
  evidence: z.array(classificationEvidenceSchema).max(100),
  classification_version: z.string().trim().min(1).max(120),
  engine_version_id: z.string().uuid().nullable().optional(),
  provider: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().max(120).nullable().optional(),
  prompt_version: z.string().trim().max(120).nullable().optional(),
}).strict();
export type BusinessClassification = z.infer<typeof businessClassificationSchema>;

/**
 * LLM-facing data is intentionally permissive. Deterministic normalization below
 * is the authority that turns it into businessClassificationSchema.
 */
export const businessClassificationDraftSchema = z.object({
  business_type: z.unknown().optional(),
  business_model: z.unknown().optional(),
  delivery_model: z.unknown().optional(),
  market_scope: z.unknown().optional(),
  technical_orientation: z.unknown().optional(),
  commerce_type: z.unknown().optional(),
  primary_category: z.unknown().optional(),
  secondary_categories: z.unknown().optional(),
  target_customer_types: z.unknown().optional(),
  buyer_roles: z.unknown().optional(),
  end_user_types: z.unknown().optional(),
  primary_country_code: z.unknown().optional(),
  primary_region: z.unknown().optional(),
  primary_city: z.unknown().optional(),
  location_dependency: z.unknown().optional(),
  overall_confidence: z.unknown().optional(),
  field_confidences: z.unknown().optional(),
  evidence: z.unknown().optional(),
}).passthrough();

export type BusinessClassificationDraft = z.infer<typeof businessClassificationDraftSchema>;

