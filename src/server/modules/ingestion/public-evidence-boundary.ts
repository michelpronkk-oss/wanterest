/**
 * Keeps retrieval and tenant context out of globally reusable public evidence
 * metadata. Query provenance remains in the private source-execution tables.
 */
const privateContextKeys = new Set([
  "workspaceid",
  "internalworkspaceid",
  "workspacecontext",
  "productcontext",
  "privateproductcontext",
  "tenantid",
  "organizationcontext",
  "buyercontext",
  "profilecontext",
  "productprofile",
  "strategycontext",
  "discourseinstanceselectionscore",
  "scanjobrunid",
  "jobrunid",
  "traceid",
  "q",
  "query",
  "querytext",
  "searchquery",
  "rawquery",
  "semanticquery",
  "providerquery",
  "queryplanid",
  "queryfamily",
  "intentfamily",
  "demandsurface",
  "discoveryintent",
  "competitorspecific",
  "competitor",
  "competitorname",
  "xcompetitorpaincompetitor",
  "xcompetitorpaindisplacementanchors",
  "queryselectionreason",
  "selectionreason",
  "queryvariantversion",
  "noveltystate",
  "retrievalquerypresent",
  "g2scancontext",
  "g2targets",
  "g2productmappings",
  "g2targetkey",
  "targetfingerprint",
  "cursor",
  "nextcursor",
  "providercursor",
  "pagetoken",
  "nextpagetoken",
  "continuationtoken",
  "accesstoken",
  "refreshtoken",
  "authorization",
]);
const queryTextKeys = new Set(["q", "query", "querytext", "searchquery", "searchtext", "searchterm", "searchphrase", "rawquery", "semanticquery", "providerquery"]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isPrivateContextKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (privateContextKeys.has(normalized)) return true;
  if (normalized === "queryplanversion") return false;
  return /(?:workspace|tenant|organizationcontext|private|customercontext|crm|supportcontext|competitor|concept|intent|query|search(?:query|text|term|phrase)|cursor|token)/.test(normalized);
}

function hasQueryText(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 12) return false;
  if (Array.isArray(value)) return value.some((entry) => hasQueryText(entry, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = normalizedKey(key);
    if (queryTextKeys.has(normalized)) {
      return typeof child === "string" ? child.trim().length > 0 : child !== null && child !== undefined;
    }
    return hasQueryText(child, depth + 1);
  });
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 12) return undefined;
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, depth + 1)).filter((entry) => entry !== undefined);
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isPrivateContextKey(key)) continue;
    const sanitized = sanitizeValue(child, depth + 1);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
}

/**
 * Returns safe, JSON-shaped provider metadata. The boolean marker preserves the
 * existing scan candidate selection signal without storing the query itself.
 */
export function publicEvidenceMetadata(
  value: unknown,
  options: { retrievalQueryPresent?: boolean; recordRetrievalQueryPresence?: boolean } = {},
): Record<string, unknown> {
  const retrievalQueryPresent = options.retrievalQueryPresent === true
    || (options.recordRetrievalQueryPresence !== false && hasQueryText(value));
  const sanitized = sanitizeValue(value, 0);
  const result = sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : {};
  if (retrievalQueryPresent) result.retrievalQueryPresent = true;
  return result;
}

export function requestUsedRetrievalQuery(input: { query?: string; requestMetadata?: unknown }): boolean {
  return Boolean(input.query?.trim()) || hasQueryText(input.requestMetadata);
}
