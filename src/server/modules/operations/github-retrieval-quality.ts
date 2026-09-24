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
