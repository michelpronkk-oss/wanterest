import { businessClassificationDraftSchema, businessClassificationSchema, type BusinessClassification, type BusinessClassificationDraft } from "./business-classification.schemas";

const BUSINESS_TYPE_ALIASES: Record<string, BusinessClassification["business_type"]> = {
  saas: "b2b_saas",
  b2b_saas: "b2b_saas",
  "b2b saas": "b2b_saas",
  developer: "developer_tool",
  developers: "developer_tool",
  "developer tools": "developer_tool",
  app: "consumer_software",
  software: "consumer_software",
  shop: "ecommerce",
  webshop: "ecommerce",
  marketplace: "marketplace",
  agency: "agency",
  media: "media_content",
  publisher: "media_content",
  local: "local_business",
  service: "service_business",
};

const BUSINESS_MODEL_VALUES = new Set<BusinessClassification["business_model"]>(["b2b", "b2c", "b2b2c", "mixed", "unknown"]);
const DELIVERY_MODEL_VALUES = new Set<BusinessClassification["delivery_model"]>(["software", "physical_product", "digital_product", "service", "marketplace", "content", "mixed", "unknown"]);
const MARKET_SCOPE_VALUES = new Set<BusinessClassification["market_scope"]>(["global", "multi_country", "country", "regional", "local", "unknown"]);
const TECHNICAL_VALUES = new Set<BusinessClassification["technical_orientation"]>(["high", "medium", "low", "unknown"]);
const COMMERCE_VALUES = new Set<BusinessClassification["commerce_type"]>(["subscription", "transactional", "usage_based", "service_fee", "advertising", "mixed", "unknown"]);

function key(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
}

function enumValue<T extends string>(value: unknown, values: Set<T>, fallback: T): T {
  const normalized = key(value) as T;
  return values.has(normalized) ? normalized : fallback;
}

function businessType(value: unknown): BusinessClassification["business_type"] {
  const normalized = key(value);
  return BUSINESS_TYPE_ALIASES[normalized] ?? (Object.values(BUSINESS_TYPE_ALIASES).includes(normalized as BusinessClassification["business_type"]) ? normalized as BusinessClassification["business_type"] : "other");
}

function clamp(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Math.max(0, Math.min(1, Number.isFinite(numeric) ? numeric : fallback));
}

function label(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim().replace(/[\u0000-\u001f]/g, "").slice(0, 160);
  return normalized || null;
}

function labels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = label(item);
    if (!normalized) continue;
    const comparison = normalized.toLowerCase();
    if (seen.has(comparison)) continue;
    seen.add(comparison);
    result.push(normalized);
    if (result.length >= 50) break;
  }
  return result;
}

function nullableLabel(value: unknown): string | null {
  return label(value);
}

function countryCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  const aliases: Record<string, string> = { NETHERLANDS: "NL", HOLLAND: "NL", "UNITED STATES": "US", USA: "US", "UNITED KINGDOM": "GB", UK: "GB" };
  const code = aliases[normalized] ?? normalized;
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function evidence(value: unknown): BusinessClassification["evidence"] {
  if (!Array.isArray(value)) return [];
  const result: BusinessClassification["evidence"] = [];
  for (const item of value) {
    const candidate = object(item);
    const field = label(candidate.field);
    const evidenceValue = label(candidate.value);
    const reason = label(candidate.reason);
    const sourceType = candidate.source_type;
    const sourceReference = label(candidate.source_reference);
    if (!field || !evidenceValue || !reason || !sourceReference || !["product_snapshot", "website_text", "url_metadata", "user_hint"].includes(String(sourceType))) continue;
    const sourcePath = label(candidate.source_path);
    const excerpt = label(candidate.excerpt);
    result.push({
      field,
      value: evidenceValue,
      reason,
      source_type: sourceType as "product_snapshot" | "website_text" | "url_metadata" | "user_hint",
      source_reference: sourceReference,
      ...(sourcePath ? { source_path: sourcePath } : {}),
      ...(excerpt ? { excerpt } : {}),
    });
    if (result.length >= 100) break;
  }
  return result;
}

function confidenceFields(value: unknown): BusinessClassification["field_confidences"] {
  const fields = object(value);
  return {
    business_type_confidence: clamp(fields.business_type_confidence),
    business_model_confidence: clamp(fields.business_model_confidence),
    market_scope_confidence: clamp(fields.market_scope_confidence),
    category_confidence: clamp(fields.category_confidence),
    delivery_model_confidence: clamp(fields.delivery_model_confidence),
    technical_orientation_confidence: clamp(fields.technical_orientation_confidence),
    commerce_type_confidence: clamp(fields.commerce_type_confidence),
    audience_confidence: clamp(fields.audience_confidence),
  };
}

export function normalizeBusinessClassification(value: unknown, options: { version: string; engineVersionId?: string | null; provider?: string; model?: string | null; promptVersion?: string | null }): BusinessClassification {
  const draft: BusinessClassificationDraft = businessClassificationDraftSchema.parse(value);
  const primaryCategory = label(draft.primary_category) ?? "unknown";
  return businessClassificationSchema.parse({
    business_type: businessType(draft.business_type),
    business_model: enumValue(draft.business_model, BUSINESS_MODEL_VALUES, "unknown"),
    delivery_model: enumValue(draft.delivery_model, DELIVERY_MODEL_VALUES, "unknown"),
    market_scope: enumValue(draft.market_scope, MARKET_SCOPE_VALUES, "unknown"),
    technical_orientation: enumValue(draft.technical_orientation, TECHNICAL_VALUES, "unknown"),
    commerce_type: enumValue(draft.commerce_type, COMMERCE_VALUES, "unknown"),
    primary_category: primaryCategory,
    secondary_categories: labels(draft.secondary_categories),
    target_customer_types: labels(draft.target_customer_types),
    buyer_roles: labels(draft.buyer_roles),
    end_user_types: labels(draft.end_user_types),
    primary_country_code: countryCode(draft.primary_country_code),
    primary_region: nullableLabel(draft.primary_region),
    primary_city: nullableLabel(draft.primary_city),
    location_dependency: clamp(draft.location_dependency),
    overall_confidence: clamp(draft.overall_confidence),
    field_confidences: confidenceFields(draft.field_confidences),
    evidence: evidence(draft.evidence),
    classification_version: options.version,
    engine_version_id: options.engineVersionId ?? null,
    ...(options.provider ? { provider: options.provider } : {}),
    model: options.model ?? null,
    prompt_version: options.promptVersion ?? null,
  });
}
