import type { QueryFamily } from "../../../modules/operations/query-planning.schemas";

export type XQueryContext = {
  product_name?: string | null;
  category?: string | null;
  audience?: string | null;
  competitors?: string[];
  alternatives?: string[];
  pains?: string[];
  switching_triggers?: string[];
  comparison_terms?: string[];
  feature_terms?: string[];
};

export type XQueryCompilation = {
  query: string;
  usedFallback: boolean;
  diagnostic?: string;
  templateVersion?: typeof X_PAIN_RETRIEVAL_TEMPLATE_VERSION;
  requestAnchors?: string[];
};

export const X_PAIN_RETRIEVAL_TEMPLATE_VERSION = "x_pain_retrieval_v1" as const;
export const X_PAIN_REQUEST_ANCHORS = ["I need", "we need", "looking for", "anyone recommend", "our team"] as const;

const MAX_QUERY_LENGTH = 512;
const allowedOperators = new Set(["lang", "from", "to", "has", "is"]);
const genericTerms = new Set([
  "a", "an", "and", "because", "better", "for", "from", "how", "in", "looking", "need", "of", "on", "or", "the", "to", "versus", "vs", "with",
]);

const internalTaxonomy = /\b(?:b2b_saas|consumer_software|developer_tool|productivity_software|software_development_tools|service_business|local_business|media_content|problem_solution_search|recommendation_request|switching_intent|alternative_search|comparison_intent|feature_requirement)\b/i;

function clean(value: string | null | undefined, max = 120): string {
  return (value ?? "").replace(/\s+/g, " ").replace(/["'`]/g, "").trim().slice(0, max);
}

function contextValue(value: string | null | undefined): string {
  return clean(value).replace(/[_-]+/g, " ");
}

function firstValue(values: string[] | undefined): string | undefined {
  return values?.map((value) => clean(value)).find(Boolean);
}

function hasBalancedQuotes(value: string): boolean {
  return (value.match(/"/g) ?? []).length % 2 === 0 && (value.match(/'/g) ?? []).length % 2 === 0;
}

function hasUsefulTerms(value: string): boolean {
  const terms = value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((term) => term.length >= 3 && !genericTerms.has(term));
  return terms.length > 0;
}

export function validateXQuery(value: string): { valid: true } | { valid: false; reason: string } {
  const query = clean(value, MAX_QUERY_LENGTH + 1);
  if (!query) return { valid: false, reason: "query is empty" };
  if (query.length > MAX_QUERY_LENGTH) return { valid: false, reason: "query exceeds the provider length limit" };
  if (!hasBalancedQuotes(query)) return { valid: false, reason: "query contains unbalanced quotes" };
  if (internalTaxonomy.test(query)) return { valid: false, reason: "query contains an internal taxonomy value" };
  const operators = [...query.matchAll(/(?:^|\s)-?([a-z][a-z0-9_-]*):/gi)].map((match) => match[1]?.toLowerCase()).filter(Boolean);
  if (operators.some((operator) => !allowedOperators.has(operator!))) return { valid: false, reason: "query contains unsupported provider syntax" };
  if (!hasUsefulTerms(query)) return { valid: false, reason: "query has no useful lexical terms" };
  return { valid: true };
}

function fallbackQuery(context: XQueryContext): string {
  const competitor = firstValue(context.competitors);
  const product = contextValue(context.product_name);
  const category = contextValue(context.category);
  return competitor ? `${competitor} alternative` : product ? `${product} alternative` : category ? `${category} alternative` : "looking for better software";
}

function preferredQuery(family: QueryFamily | undefined, context: XQueryContext): string {
  const competitor = firstValue(context.competitors) ?? firstValue(context.alternatives);
  const product = contextValue(context.product_name);
  const category = contextValue(context.category);
  const pain = firstValue(context.pains);
  const feature = firstValue(context.feature_terms);
  const comparison = firstValue(context.comparison_terms);

  switch (family) {
    case "switching": return competitor ? `switching from ${competitor}` : product ? `${product} alternative` : `${category} alternative`;
    case "alternative_search": return competitor ? `${competitor} alternative` : product ? `${product} alternative` : `${category} alternative`;
    case "comparison": return product && competitor ? `${product} vs ${competitor}` : comparison ?? (competitor ? `${competitor} vs alternatives` : `${category} comparison`);
    case "pain": return pain ? `${category} ${pain}` : `${category} problems`;
    case "feature_requirement": return feature ? `${category} ${feature}` : `${category} features`;
    case "recommendation": return context.audience ? `best ${category} for ${contextValue(context.audience)}` : `best ${category}`;
    case "jtbd": return `${category} workflow`;
    default: return category || product || "software alternatives";
  }
}

/**
 * Compile planner language to a conservative X lexical query. The planner may
 * retain richer semantic text for diagnostics, but X receives only a bounded
 * human query with no internal taxonomy identifiers or synthetic explanation.
 */
export function compileXQuery(input: { semanticQuery: string; family?: QueryFamily; demandSurface?: string; context?: XQueryContext }): XQueryCompilation {
  const context = input.context ?? {};
  const painFirst = input.family === "pain" && input.demandSurface === "pain_first";
  if (painFirst && (!contextValue(context.category) || !firstValue(context.pains))) {
    throw new Error("Unable to compile a safe X pain_first query: category/pain context is unavailable or invalid.");
  }
  const preferredContext = clean(preferredQuery(input.family, context), MAX_QUERY_LENGTH);
  if (painFirst && !validateXQuery(preferredContext).valid) {
    throw new Error("Unable to compile a safe X pain_first query: category/pain context is unavailable or invalid.");
  }
  const requestAnchors = painFirst ? [...X_PAIN_REQUEST_ANCHORS] : undefined;
  const requestAnchorGroup = requestAnchors ? `(${requestAnchors.map((anchor) => `\"${anchor}\"`).join(" OR ")})` : "";
  const preferred = [requestAnchorGroup, preferredContext].filter(Boolean).join(" ").slice(0, MAX_QUERY_LENGTH);
  const preferredValidation = validateXQuery(preferred);
  if (preferredValidation.valid && painFirst) {
    return {
      query: preferred,
      usedFallback: true,
      diagnostic: "provider query compiled with bounded first-person/request anchors",
      templateVersion: X_PAIN_RETRIEVAL_TEMPLATE_VERSION,
      requestAnchors,
    };
  }
  if (preferredValidation.valid) {
    const semanticValidation = validateXQuery(input.semanticQuery);
    return semanticValidation.valid && clean(input.semanticQuery) === preferred
      ? { query: preferred, usedFallback: false }
      : { query: preferred, usedFallback: true, diagnostic: semanticValidation.valid ? "provider query compiled from source-specific context" : `semantic query rejected: ${semanticValidation.reason}` };
  }
  if (painFirst) throw new Error(`Unable to compile a safe X pain_first query: ${preferredValidation.reason}`);

  const fallback = fallbackQuery(context);
  const fallbackValidation = validateXQuery(fallback);
  if (!fallbackValidation.valid) throw new Error(`Unable to compile a safe X query: ${fallbackValidation.reason}`);
  return { query: fallback, usedFallback: true, diagnostic: `preferred query rejected: ${preferredValidation.reason}` };
}
