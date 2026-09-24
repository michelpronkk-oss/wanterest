import { githubPainRetrievalVersion, type GithubPainQueryCompilation } from "./github-query-compilation";

export const githubRetrievalQualityReasons = [
  "eligible",
  "job_posting",
  "seo_or_search_dump",
  "external_content_promotion",
  "informational_report",
  "obvious_unrelated_content",
] as const;

export type GithubRetrievalQualityReason = typeof githubRetrievalQualityReasons[number];

export type GithubRetrievalQualityInput = {
  title?: string | null;
  body: string;
  metadata?: Record<string, unknown>;
};

export type GithubRetrievalQualityResult =
  | { eligible: true; reason: "eligible" }
  | { eligible: false; reason: Exclude<GithubRetrievalQualityReason, "eligible"> };

export type GithubRetrievalPrecisionSuppressedCandidate = {
  conversationId: string;
  providerItemId: string;
  queryPlanIds: string[];
  reason: Exclude<GithubRetrievalQualityReason, "eligible">;
};

export type GithubRetrievalPrecisionDiagnostics = {
  inspectedCount: number;
  eligibleCount: number;
  suppressedCount: number;
  suppressedByReason: Record<string, number>;
  suppressedCandidates: GithubRetrievalPrecisionSuppressedCandidate[];
};

export type GithubPainEvidenceAlignmentQuery = Pick<GithubPainQueryCompilation, "templateVersion" | "demandAnchors" | "categoryAnchors">;

export type GithubPainEvidenceAlignmentMismatch = {
  conversationId: string;
  queryPlanId: string;
  demandAnchorMatches: string[];
  categoryAnchorMatches: string[];
  reason: "query_evidence_mismatch";
};

export type GithubPainEvidenceAlignmentDiagnostics = {
  inspectedCount: number;
  alignedCount: number;
  mismatchCount: number;
  mismatches: GithubPainEvidenceAlignmentMismatch[];
};

export type GithubPainEvidenceAlignmentResult = {
  aligned: boolean;
  demandAnchorMatches: string[];
  categoryAnchorMatches: string[];
  mismatches: GithubPainEvidenceAlignmentMismatch[];
};

export const githubFeatureEvidenceOpeningBodyLength = 400 as const;
export const githubFeatureEvidenceMismatchReason = "feature_evidence_mismatch" as const;

export type GithubFeatureEvidenceAlignmentQuery = {
  queryPlanId: string;
  semanticQuery?: string;
  concepts?: string[];
};

export type GithubFeatureEvidenceAlignmentMismatch = {
  conversationId: string;
  queryPlanId: string;
  featureMarkers: string[];
  categoryMatches: string[];
  reason: typeof githubFeatureEvidenceMismatchReason;
};

export type GithubFeatureEvidenceAlignmentDiagnostics = {
  inspectedCount: number;
  alignedCount: number;
  mismatchCount: number;
  mismatches: GithubFeatureEvidenceAlignmentMismatch[];
};

export type GithubFeatureEvidenceAlignmentResult = {
  aligned: boolean;
  featureMarkers: string[];
  categoryMatches: string[];
  mismatches: GithubFeatureEvidenceAlignmentMismatch[];
};

export const githubJobEvidenceOpeningBodyLength = githubFeatureEvidenceOpeningBodyLength;
export const githubJobEvidenceMismatchReason = "github_job_evidence_mismatch" as const;

export const githubJobEvidenceMismatchSubreasons = [
  "employment_mismatch",
  "maintainer_mismatch",
  "sparse_or_generic_mismatch",
  "buyer_context_missing",
  "category_context_missing",
] as const;

export type GithubJobEvidenceMismatchSubreason = typeof githubJobEvidenceMismatchSubreasons[number];

export type GithubJobEvidenceAlignmentQuery = {
  queryPlanId: string;
  semanticQuery?: string;
  concepts?: string[];
};

export type GithubJobEvidenceAlignmentMismatch = {
  conversationId: string;
  queryPlanId: string;
  buyerContextMatched: boolean;
  categoryContextMatched: boolean;
  subreason: GithubJobEvidenceMismatchSubreason;
};

export type GithubJobEvidenceAlignmentDiagnostics = {
  inspectedCount: number;
  alignedCount: number;
  mismatchCount: number;
  missingAlignmentProvenanceCount: number;
  missingAlignmentProvenanceReason?: "missing_alignment_provenance";
  subreasonCounts: Record<GithubJobEvidenceMismatchSubreason, number>;
  mismatches: GithubJobEvidenceAlignmentMismatch[];
};

export type GithubJobEvidenceAlignmentResult = {
  aligned: boolean;
  missingAlignmentProvenance: boolean;
  mismatches: GithubJobEvidenceAlignmentMismatch[];
};

export function emptyGithubJobEvidenceAlignmentDiagnostics(): GithubJobEvidenceAlignmentDiagnostics {
  return {
    inspectedCount: 0,
    alignedCount: 0,
    mismatchCount: 0,
    missingAlignmentProvenanceCount: 0,
    subreasonCounts: {
      employment_mismatch: 0,
      maintainer_mismatch: 0,
      sparse_or_generic_mismatch: 0,
      buyer_context_missing: 0,
      category_context_missing: 0,
    },
    mismatches: [],
  };
}

function normalizeEvidenceText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseMatches(text: string, phrase: string): boolean {
  const normalized = normalizeEvidenceText(phrase);
  if (!normalized) return false;
  const pattern = normalized.split(" ").map(escaped).join("\\s+");
  return new RegExp(`(?:^|\\b)${pattern}(?:\\b|$)`, "i").test(text);
}

export function matchGithubPainAnchors(text: string, anchors: string[]): string[] {
  const normalizedText = normalizeEvidenceText(text);
  return [...new Set(anchors.filter((anchor) => phraseMatches(normalizedText, anchor)))].sort();
}

const githubFeatureMarkerPatterns: Array<[string, RegExp]> = [
  ["looking_for_with", /\blooking\s+for\b[\s\S]{0,120}\bwith\b/i],
  ["looking_for_tool_that", /\blooking\s+for\s+(?:a|an|the)\s+tool\s+that\b/i],
  ["need_software_with", /\bneed(?:s)?\s+(?!(?:to|for)\b)(?:a|an|the|some)?\s*(?:[a-z0-9-]+\s+){0,5}(?:software|tool|platform|system|solution)\b[\s\S]{0,80}\bwith\b/i],
  ["need_software_that", /\bneed(?:s)?\s+(?!(?:to|for)\b)(?:a|an|the|some)?\s*(?:[a-z0-9-]+\s+){0,5}(?:software|tool|platform|system|solution)\b[\s\S]{0,80}\bthat\s+(?:can|support(?:s)?)\b/i],
  ["need_support_for", /\bneed(?:s)?\s+support\s+for\b/i],
  ["need_a_feature", /\bneed(?:s)?\s+(?!(?:to|for)\b)(?:a|an|the|some)?\s*(?:[a-z0-9-]+\s+){0,5}features?\b/i],
  ["feature_request", /\bfeature\s+request\b/i],
  ["would_like_support", /\bwould\s+like\b[\s\S]{0,100}\bsupport\b/i],
  ["software_that_can", /\b(?:software|tool|platform|system|solution)\s+that\s+(?:can|support(?:s)?|handles?)\b/i],
];

function featureEvidenceWindow(title: string | null | undefined, body: string | null | undefined): string {
  const normalizedTitle = normalizeEvidenceText(title);
  const normalizedBody = normalizeEvidenceText(body).slice(0, githubFeatureEvidenceOpeningBodyLength);
  return `${normalizedTitle} ${normalizedBody}`.trim();
}

function jobEvidenceWindow(title: string | null | undefined, body: string | null | undefined): string {
  const normalizedTitle = normalizeEvidenceText(title);
  const normalizedBody = normalizeEvidenceText(body).slice(0, githubJobEvidenceOpeningBodyLength);
  return `${normalizedTitle} ${normalizedBody}`.trim();
}

const githubJobBuyerContextPatterns = [
  /\b(?:we|i|our\s+team|my\s+team|our\s+company|our\s+workflow)\b[\s\S]{0,100}\b(?:need(?:s)?|want(?:s)?|looking\s+for|require(?:s)?|struggl\w*|trying\s+to|missing)\b/i,
  /\b(?:we'?re|we\s+are)\s+looking\s+for\b/i,
  /\bneed\s+(?:a|an|the|some)?\s*(?:better\s+)?(?:tool|software|platform|system)\b/i,
  /\b(?:our\s+workflow|our\s+team)\b[\s\S]{0,100}\b(?:manage|plan|ship|track|coordinate)\b/i,
];

const githubJobCategoryContextTerms = [
  "software",
  "tool",
  "platform",
  "system",
  "workflow",
  "project management",
  "issue tracking",
  "task management",
] as const;

function jobCategoryContextTerms(query: GithubJobEvidenceAlignmentQuery): string[] | null {
  const concepts = Array.isArray(query.concepts)
    ? query.concepts
      .filter((value): value is string => typeof value === "string")
      .map((value) => normalizeEvidenceText(value.replace(/[_-]+/g, " ")))
      .filter((value) => value && value !== "category")
    : [];
  const semanticQuery = typeof query.semanticQuery === "string" ? normalizeEvidenceText(query.semanticQuery) : "";
  if (!query.queryPlanId.trim() || (!concepts.length && !semanticQuery)) return null;
  const semanticTerms = semanticQuery.match(/\b(?:software|tool|platform|system|workflow|project\s+management|issue\s+tracking|task\s+management)\b/g) ?? [];
  return [...new Set([...githubJobCategoryContextTerms, ...concepts, ...semanticTerms])].sort();
}

function jobBuyerContextMatched(text: string): boolean {
  return githubJobBuyerContextPatterns.some((pattern) => pattern.test(text));
}

function jobCategoryContextMatched(text: string, terms: string[]): boolean {
  return terms.some((term) => phraseMatches(text, term));
}

function employmentJobSense(text: string, title: string | null | undefined): boolean {
  const employmentSignals = [
    /\b(?:hiring|job\s+(?:opening|description|posting)|careers?|apply|salary|resume|recruiter|vacancy|employment|full[- ]time|part[- ]time)\b/i,
    /\b(?:responsibilities|qualifications|requirements|experience\s+required)\b/i,
  ].filter((pattern) => pattern.test(text)).length;
  const roleTitle = /\b(?:engineer|developer|designer|manager|analyst|administrator|specialist|intern|director|officer)\b/i.test(title ?? "");
  const roleContext = /\b(?:role|position|job|career|opening|apply|resume|salary|recruiter|vacancy)\b/i.test(text);
  return employmentSignals > 0 && (roleTitle || roleContext);
}

function maintainerJobSense(text: string): boolean {
  const communitySignal = /\b(?:community|contributor|maintainer|governance)\b/i.test(text);
  const planningSignal = /\b(?:roadmap|vision|strategy\s+plan|community\s+plan|release\s+planning|project\s+governance)\b/i.test(text);
  return communitySignal && planningSignal;
}

function sparseOrGenericJobSense(text: string, buyerContextMatched: boolean, categoryContextMatched: boolean): boolean {
  return !buyerContextMatched && !categoryContextMatched && text.split(/\s+/).filter(Boolean).length <= 18;
}

function classifyGithubJobEvidence(input: {
  conversationId: string;
  title?: string | null;
  body?: string | null;
  query: GithubJobEvidenceAlignmentQuery;
}): GithubJobEvidenceAlignmentMismatch | null {
  const evidence = jobEvidenceWindow(input.title, input.body);
  const categoryTerms = jobCategoryContextTerms(input.query);
  if (!categoryTerms) return null;
  const buyerContextMatched = jobBuyerContextMatched(evidence);
  const categoryContextMatched = jobCategoryContextMatched(evidence, categoryTerms);
  let subreason: GithubJobEvidenceMismatchSubreason | null = null;
  if (employmentJobSense(evidence, input.title)) subreason = "employment_mismatch";
  else if (maintainerJobSense(evidence)) subreason = "maintainer_mismatch";
  else if (buyerContextMatched && categoryContextMatched) return null;
  else if (sparseOrGenericJobSense(evidence, buyerContextMatched, categoryContextMatched)) subreason = "sparse_or_generic_mismatch";
  else if (!buyerContextMatched) subreason = "buyer_context_missing";
  else subreason = "category_context_missing";
  return { conversationId: input.conversationId, queryPlanId: input.query.queryPlanId, buyerContextMatched, categoryContextMatched, subreason };
}

/**
 * Reconciles GitHub job-demand retrieval with retained first-party/team and
 * software/workflow evidence. Only the normalized title and bounded opening
 * body are inspected; missing provenance fails open.
 */
export function alignGithubJobEvidence(input: {
  conversationId: string;
  title?: string | null;
  body?: string | null;
  queries: GithubJobEvidenceAlignmentQuery[];
}): GithubJobEvidenceAlignmentResult | null {
  if (!input.queries.length) return null;
  if (input.queries.some((query) => !jobCategoryContextTerms(query))) return { aligned: true, missingAlignmentProvenance: true, mismatches: [] };
  const mismatches = input.queries
    .map((query) => classifyGithubJobEvidence({ ...input, query }))
    .filter((value): value is GithubJobEvidenceAlignmentMismatch => Boolean(value));
  return mismatches.length === input.queries.length
    ? { aligned: false, missingAlignmentProvenance: false, mismatches }
    : { aligned: true, missingAlignmentProvenance: false, mismatches: [] };
}

function matchGithubFeatureMarkers(text: string): string[] {
  return githubFeatureMarkerPatterns.filter(([, pattern]) => pattern.test(text)).map(([marker]) => marker);
}

function featureCategoryAnchors(query: GithubFeatureEvidenceAlignmentQuery): string[] {
  const concepts = (query.concepts ?? [])
    .map((value) => normalizeEvidenceText(value.replace(/[_-]+/g, " ")).replace(/\bfeatures?\b$/i, "").trim())
    .filter((value) => value && value !== "category");
  const productTerms = normalizeEvidenceText(query.semanticQuery)
    .match(/\b(?:software|tool|platform|system|product|app)\b/g) ?? [];
  return [...new Set([...concepts, ...productTerms])].sort();
}

/**
 * Reconciles a GitHub feature-demand provider match with the retained root
 * evidence. Only the normalized title and the first bounded body window are
 * eligible; comments and deep copied/search-result text are intentionally not
 * inspected.
 */
export function alignGithubFeatureEvidence(input: {
  conversationId: string;
  title?: string | null;
  body?: string | null;
  queries: GithubFeatureEvidenceAlignmentQuery[];
}): GithubFeatureEvidenceAlignmentResult | null {
  if (!input.queries.length) return null;
  const evidence = featureEvidenceWindow(input.title, input.body);
  const aligned: Array<{ featureMarkers: string[]; categoryMatches: string[] }> = [];
  const mismatches: GithubFeatureEvidenceAlignmentMismatch[] = [];

  for (const query of input.queries) {
    const featureMarkers = matchGithubFeatureMarkers(evidence);
    const categoryMatches = featureCategoryAnchors(query).filter((anchor) => phraseMatches(evidence, anchor));
    if (featureMarkers.length && categoryMatches.length) {
      aligned.push({ featureMarkers, categoryMatches });
    } else {
      mismatches.push({ conversationId: input.conversationId, queryPlanId: query.queryPlanId, featureMarkers, categoryMatches, reason: githubFeatureEvidenceMismatchReason });
    }
  }

  return {
    aligned: aligned.length > 0,
    featureMarkers: [...new Set(aligned.flatMap((value) => value.featureMarkers))].sort(),
    categoryMatches: [...new Set(aligned.flatMap((value) => value.categoryMatches))].sort(),
    mismatches: aligned.length ? [] : mismatches,
  };
}

/**
 * Reconciles a provider-side GitHub pain match with the normalized evidence
 * retained by Wanterest. Provider-only searchable surfaces are intentionally
 * excluded from this check.
 */
export function alignGithubPainEvidence(input: {
  conversationId: string;
  title?: string | null;
  body?: string | null;
  queries: Array<{ queryPlanId: string; githubPainRetrievalV1?: GithubPainEvidenceAlignmentQuery }>;
}): GithubPainEvidenceAlignmentResult | null {
  if (!input.queries.length) return null;
  const text = `${input.title ?? ""} ${input.body ?? ""}`;
  const aligned: Array<{ demand: string[]; category: string[] }> = [];
  const mismatches: GithubPainEvidenceAlignmentMismatch[] = [];

  for (const query of input.queries) {
    const compilation = query.githubPainRetrievalV1;
    const demandAnchorMatches = compilation?.templateVersion === githubPainRetrievalVersion ? matchGithubPainAnchors(text, compilation.demandAnchors) : [];
    const categoryAnchorMatches = compilation?.templateVersion === githubPainRetrievalVersion ? matchGithubPainAnchors(text, compilation.categoryAnchors) : [];
    if (demandAnchorMatches.length && categoryAnchorMatches.length) {
      aligned.push({ demand: demandAnchorMatches, category: categoryAnchorMatches });
    } else {
      mismatches.push({ conversationId: input.conversationId, queryPlanId: query.queryPlanId, demandAnchorMatches, categoryAnchorMatches, reason: "query_evidence_mismatch" });
    }
  }

  return {
    aligned: aligned.length > 0,
    demandAnchorMatches: [...new Set(aligned.flatMap((value) => value.demand))].sort(),
    categoryAnchorMatches: [...new Set(aligned.flatMap((value) => value.category))].sort(),
    mismatches: aligned.length ? [] : mismatches,
  };
}

const demandLanguage = [
  /\b(?:we|i|our|my|team|company)\b[^.!?\n]{0,80}\b(?:need|want|looking for|struggl|switch|replace|migrat|compar|alternat|recommend|wish|missing|support)\b/i,
  /\b(?:looking for|what do you use|anyone switched|instead of|alternative to|replace|migrat(?:e|ion)|recommend|wish .* support|missing)\b/i,
  /\b(?:what tool|which tool|what software|what platform)\b[\s\S]{0,100}\b(?:use|choose|recommend|support)\b/i,
];

const searchDumpMarkers = [
  /\bAI Mode\b/i,
  /\bAll Images\b/i,
  /\bVideos\b/i,
  /\bShopping\b/i,
  /\bShort videos\b/i,
  /\bForums\b/i,
  /\bNews\b/i,
  /\bMaps\b/i,
  /\bWeb\b/i,
  /\bBooks\b/i,
  /\bFlights\b/i,
  /\bFinance\b/i,
  /\bSearch tools\b/i,
  /\bFeedback\b/i,
];

const jobMarkers = [
  /\bjob details\b/i,
  /\bapply(?: now| here)?\b/i,
  /\b(?:salary|compensation|employment type|full[- ]time|part[- ]time)\b/i,
  /\b(?:responsibilities|qualifications|requirements|experience required)\b/i,
  /\b(?:location|job id|career opportunity|vacancy)\b/i,
];

const articleMarkers = [
  /\b(?:introduction|executive summary|conclusion)\b/i,
  /\b(?:guide|report|roadmap|news|newsletter|case study|health report|what is|how to)\b/i,
  /\b(?:modern businesses|digital transformation|in this article|this report|companies rely)\b/i,
];

const externalPromotionMarkers = [
  /\b(?:learn more|contact us|best for|our solutions|we help|services include|visit our|read more)\b/i,
  /\b(?:businesses|organizations|companies)\b[\s\S]{0,100}\b(?:solutions|services|platforms|technology)\b/i,
];

function links(text: string): number {
  return (text.match(/https?:\/\/|www\./gi) ?? []).length;
}

function hasDemandLanguage(text: string): boolean {
  return demandLanguage.some((pattern) => pattern.test(text));
}

function matchesAtLeast(patterns: RegExp[], text: string, minimum: number): boolean {
  return patterns.filter((pattern) => pattern.test(text)).length >= minimum;
}

function eligible(): GithubRetrievalQualityResult {
  return { eligible: true, reason: "eligible" };
}

/**
 * Conservative GitHub-only retrieval quality gate. This runs after source
 * normalization and before candidate deduplication/selection. It suppresses
 * only high-confidence non-demand shapes; uncertain content fails open.
 */
export function classifyGithubRetrievalQuality(input: GithubRetrievalQualityInput): GithubRetrievalQualityResult {
  const title = (input.title ?? "").replace(/\s+/g, " ").trim();
  const body = input.body.replace(/\s+/g, " ").trim();
  const text = `${title} ${body}`;
  const metadata = input.metadata ?? {};
  const demand = hasDemandLanguage(text);
  const linkCount = links(text);

  const titleLooksLikeRole = /\b(?:engineer|developer|designer|manager|analyst|administrator|specialist|intern|director|officer)\b/i.test(title);
  const jobSignalCount = jobMarkers.filter((pattern) => pattern.test(text)).length;
  if (!demand && titleLooksLikeRole && jobSignalCount >= 2) return { eligible: false, reason: "job_posting" };

  const searchDumpSignalCount = searchDumpMarkers.filter((pattern) => pattern.test(body)).length;
  if (!demand && searchDumpSignalCount >= 4 && linkCount >= 2) return { eligible: false, reason: "seo_or_search_dump" };

  const articleSignalCount = articleMarkers.filter((pattern) => pattern.test(text)).length;
  const promotionSignalCount = externalPromotionMarkers.filter((pattern) => pattern.test(text)).length;
  const issueLike = metadata.itemType === "issue" || metadata.itemType === "discussion";
  if (!demand && linkCount >= 2 && articleSignalCount >= 1 && promotionSignalCount >= 1) {
    return { eligible: false, reason: "external_content_promotion" };
  }

  if (!demand && articleSignalCount >= 2 && (body.length >= 500 || issueLike)) {
    return { eligible: false, reason: "informational_report" };
  }

  const externalNarrative = /\b(?:organization|company|business|enterprise|community|consulting|development)\b/i.test(text);
  if (!demand && issueLike && linkCount >= 1 && externalNarrative && matchesAtLeast(articleMarkers, text, 1)) {
    return { eligible: false, reason: "obvious_unrelated_content" };
  }

  return eligible();
}
