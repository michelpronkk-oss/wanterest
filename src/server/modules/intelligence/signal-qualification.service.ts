import { sha256Text } from "../ingestion/hash";
import { inspectSignalContent } from "./signal-quality";
import { freshnessScore, sourceQuality } from "./ranking";
import {
  SIGNAL_QUALIFICATION_PENALTIES,
  SIGNAL_QUALIFICATION_THRESHOLDS,
  SIGNAL_QUALIFICATION_VERSION,
  SIGNAL_QUALIFICATION_THRESHOLD_VERSION,
  SIGNAL_QUALIFICATION_WEIGHTS,
  STRONG_COMMERCIAL_INTENTS,
} from "./signal-qualification.config";
import {
  signalQualificationSchema,
  type MarketResonance,
  type SignalQualification,
  type SignalQualificationDimensions,
  type SignalQualificationEvidenceSpan,
  type SignalQualificationPrimaryIntent,
  type SignalQualificationReasonCode,
  type SignalQualificationStatus,
} from "./signal-qualification.schemas";
import type { Json, ConversationRow, ConversationAnalysisRow, ProductMatchResult, SourceItemRow } from "./signal-qualification.types";
import { detectIntentTarget } from "./intent-semantics";
import { deriveDirectionalDemand, type DirectionalDemand } from "./directional-demand";

export type SignalQualificationProfile = {
  relevant_pains: Array<{ key?: string; label?: string; description?: string; confidence?: number; specificity?: number } | string>;
  relevant_outcomes: Array<{ key?: string; label?: string; confidence?: number } | string>;
  relevant_intents: Array<{ intent_type?: string; relevance?: number } | string>;
  relevant_jtbd: Array<{ key?: string; job?: string; desired_result?: string; confidence?: number } | string>;
  relevant_features: Array<{ key?: string; feature?: string; confidence?: number } | string>;
  buyer_roles: string[];
  competitors: Array<{ key?: string; name?: string; confidence?: number } | string>;
  alternatives: Array<{ key?: string; label?: string; alternative_type?: string; confidence?: number } | string>;
  geography: {
    market_scope?: string;
    primary_country_code?: string | null;
    primary_region?: string | null;
    primary_city?: string | null;
    location_dependency?: number;
    demand_geography_terms?: string[];
  };
  profile_confidence: number;
  primary_category?: string;
  profile_version?: string | null;
};

export type SignalQualificationInput = {
  candidateId: string;
  productId: string;
  productName: string;
  conversation: ConversationRow;
  sourceItem: SourceItemRow;
  analysis: ConversationAnalysisRow | {
    intent_type: string;
    pain_themes: Json;
    desired_outcomes: Json;
    alternatives: Json;
    buyer_language: Json;
    audience_signals: Json;
    specificity: number;
    confidence: number;
    status?: string;
    engine_version_id?: string;
    evidence_spans?: Json;
  };
  match: ProductMatchResult;
  profile: SignalQualificationProfile;
  now?: Date;
};

type JsonRecord = Record<string, Json>;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function text(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function lower(value: string): string {
  return text(value).toLowerCase();
}

function jsonRecord(value: Json | undefined): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function strings(value: Json | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => text(item)) : [];
}

function firstLabel(value: Record<string, unknown> | string): string {
  if (typeof value === "string") return text(value);
  for (const key of ["label", "name", "feature", "trigger", "job", "desired_result", "description"]) {
    if (typeof value[key] === "string" && text(value[key] as string)) return text(value[key] as string);
  }
  return "";
}

function keyOf(value: Record<string, unknown> | string): string {
  if (typeof value === "string") return text(value).toLowerCase().replace(/\s+/g, "_");
  if (typeof value.key === "string" && text(value.key)) return text(value.key);
  return firstLabel(value).toLowerCase().replace(/\s+/g, "_");
}

function confidenceOf(value: Record<string, unknown> | string): number {
  if (typeof value === "string") return 0.55;
  return clamp(typeof value.confidence === "number" ? value.confidence : typeof value.relevance === "number" ? value.relevance : 0.55);
}

function profileLabels(values: SignalQualificationProfile["relevant_pains"] | SignalQualificationProfile["relevant_outcomes"] | SignalQualificationProfile["relevant_jtbd"] | SignalQualificationProfile["relevant_features"] | SignalQualificationProfile["competitors"] | SignalQualificationProfile["alternatives"]): Array<{ key: string; label: string; confidence: number }> {
  return values.map((value) => {
    const record = typeof value === "string" ? value : value as Record<string, unknown>;
    return { key: keyOf(record), label: firstLabel(record), confidence: confidenceOf(record) };
  }).filter((value) => value.label.length > 0);
}

function sourceText(input: SignalQualificationInput): string {
  return text(`${input.conversation.title ?? input.sourceItem.title ?? ""} ${input.conversation.body || input.sourceItem.body}`);
}

function bodyText(input: SignalQualificationInput): string {
  return input.sourceItem.body || input.conversation.body;
}

function hasAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function intentFromText(input: SignalQualificationInput): SignalQualificationPrimaryIntent {
  const value = lower(sourceText(input));
  const intentTarget = detectIntentTarget(value);
  if (intentTarget === "authentication" || intentTarget === "implementation") return "problem_solution_search";
  if (hasAny(value, [/\bswitch(?:ing|ed)?\b/, /\breplac(?:e|ing|ed)\b/, /\bleaving\b/, /\bmigrat(?:e|ing|ed)\b/, /\bmove away\b/, /\bstopped using\b/, /\brenew(?:al|ing)\b/])) return "switching_intent";
  if (hasAny(value, [/\balternative(?:s)?\b/, /\binstead of\b/, /\bwhat else\b/, /\bother options?\b/])) return "alternative_search";
  if (hasAny(value, [/\b(?:best|recommend|recommendation)\b/, /\bdoes anyone know\b/, /\bwhat should i use\b/, /\blooking for\b/])) return "recommendation_request";
  if (hasAny(value, [/\b(?:compare|comparison|versus|vs\.)\b/])) return "comparison_intent";
  if (hasAny(value, [/\b(?:evaluate|evaluating|vendor|trial|quote|adopt|buy|pricing)\b/])) return "vendor_evaluation";
  if (hasAny(value, [/\b(?:need|needs|require|requires|support|supports)\b[^.!?]{0,120}\b(?:api|sso|integration|export|automation|feature|workflow|security)\b/])) return "feature_requirement";
  if (hasAny(value, [/\b(?:need|looking for|buy|pricing|how can i solve|any tool)\b/])) return "purchase_research";
  if (hasAny(value, [/\b(?:too expensive|frustrat|pain|problem|slow|manual|complex|hard|difficult|broken|missing|struggl|wish)\b/])) return "explicit_pain";
  if (input.analysis.intent_type === "switching_intent") return "switching_intent";
  if (input.analysis.intent_type === "alternative_search") return "alternative_search";
  if (input.analysis.intent_type === "problem_signal") return "problem_solution_search";
  if (input.analysis.intent_type === "high_intent") return "purchase_research";
  return "unknown";
}

function verifiedEvidence(input: SignalQualificationInput, primaryIntent: SignalQualificationPrimaryIntent): SignalQualificationEvidenceSpan[] {
  const sourceFields: Record<string, string> = {
    title: input.sourceItem.title ?? "",
    body: bodyText(input),
    author: input.sourceItem.author_display_name ?? "",
    metadata: JSON.stringify(input.sourceItem.metadata),
  };
  const analysisSpans = Array.isArray(input.analysis.evidence_spans) ? input.analysis.evidence_spans : [];
  const result: SignalQualificationEvidenceSpan[] = [];
  for (const item of analysisSpans) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const span = item as Record<string, Json>;
    const field = typeof span.field === "string" ? span.field : "body";
    const value = sourceFields[field] ?? sourceFields.body;
    const start = typeof span.startOffset === "number" ? span.startOffset : typeof span.start_offset === "number" ? span.start_offset : -1;
    const end = typeof span.endOffset === "number" ? span.endOffset : typeof span.end_offset === "number" ? span.end_offset : -1;
    const excerpt = start >= 0 && end > start ? value.slice(start, end) : "";
    const hash = typeof span.excerptHash === "string" ? span.excerptHash : typeof span.excerpt_hash === "string" ? span.excerpt_hash : "";
    if (!excerpt || !hash || sha256Text(excerpt) !== hash) continue;
    const rawType = typeof span.evidenceType === "string" ? span.evidenceType : typeof span.evidence_type === "string" ? span.evidence_type : "";
    const evidenceType = rawType.includes("switch") || primaryIntent === "switching_intent" ? "switching" : rawType.includes("feature") || primaryIntent === "feature_requirement" ? "feature_requirement" : rawType.includes("pain") || primaryIntent === "explicit_pain" || primaryIntent === "problem_solution_search" ? "pain" : rawType.includes("recommend") || primaryIntent === "recommendation_request" ? "recommendation" : rawType.includes("comparison") || primaryIntent === "comparison_intent" ? "comparison" : rawType.includes("buyer") ? "buyer_context" : "intent";
    result.push({ text: excerpt.slice(0, 2_000), source_item_id: input.sourceItem.id, start_offset: start, end_offset: end, evidence_type: evidenceType, confidence: clamp(typeof span.confidence === "number" ? span.confidence : input.analysis.confidence) });
  }
  const patterns: Array<{ pattern: RegExp; type: SignalQualificationEvidenceSpan["evidence_type"] }> = [
    { pattern: /\b(?:we|our team|our company|i|my team)\b[^.!?]{0,140}\b(?:need|looking for|switching|replacing|alternative|wish|struggling|problem|evaluating|pricing|vendor)\b[^.!?]{0,180}/i, type: "commercial_context" },
    { pattern: /\b(?:alternative to|switching from|replacing|leaving|looking for|need|wish(?: this supported)?|best|evaluating|pricing|vendor)\b[^.!?]{0,180}/i, type: primaryIntent === "switching_intent" ? "switching" : primaryIntent === "recommendation_request" ? "recommendation" : primaryIntent === "feature_requirement" ? "feature_requirement" : "intent" },
    { pattern: /\b(?:too expensive|too complex|manual(?:ly)?|slow|frustrat\w*|difficult|hard|problem|missing|broken|pain|spends?)\b[^.!?]{0,160}/i, type: "pain" },
  ];
  const body = bodyText(input);
  for (const candidate of patterns) {
    const match = candidate.pattern.exec(body);
    if (!match || result.some((span) => span.start_offset === match.index && span.end_offset === match.index + match[0].length)) continue;
    result.push({ text: match[0].trim().slice(0, 2_000), source_item_id: input.sourceItem.id, start_offset: match.index, end_offset: match.index + match[0].length, evidence_type: candidate.type, confidence: clamp(input.analysis.confidence) });
  }
  return result.slice(0, 20);
}

function matchedConcepts(input: SignalQualificationInput, value: string): string[] {
  const groups = [
    ...profileLabels(input.profile.relevant_pains),
    ...profileLabels(input.profile.relevant_outcomes),
    ...profileLabels(input.profile.relevant_jtbd),
    ...profileLabels(input.profile.relevant_features),
    ...profileLabels(input.profile.competitors),
    ...profileLabels(input.profile.alternatives),
  ];
  const lowerValue = lower(value);
  return [...new Map(groups.filter((concept) => concept.label && lowerValue.includes(lower(concept.label))).map((concept) => [concept.key, concept])).values()]
    .sort((left, right) => right.confidence - left.confidence || left.key.localeCompare(right.key))
    .slice(0, 20)
    .map((concept) => concept.key);
}

/**
 * Whether any of the product's own known competitors (from structured product understanding)
 * is named in the conversation. Demand Profile v2's own schema (alternativeTypeSchema)
 * distinguishes a competitor-type alternative (alternative_type: "competitor_product") from
 * other alternative types (manual_process, internal_build, generic_tool, ...) — and the
 * profiling engine sometimes classifies a well-known competitor there instead of under
 * competitors.known_competitors (the two concepts genuinely overlap for an LLM). Checking
 * only `profile.competitors` silently missed those, even though matchedConcepts() (which
 * aggregates all six profile groups, alternatives included) already found the same name.
 */
function competitorMatched(input: SignalQualificationInput, value: string): boolean {
  const competitorAlternatives = input.profile.alternatives.filter((entry) => typeof entry !== "string" && entry.alternative_type === "competitor_product");
  const candidates = [...profileLabels(input.profile.competitors), ...profileLabels(competitorAlternatives)];
  return candidates.some((concept) => concept.label && value.includes(lower(concept.label)));
}

function geographicAdjustment(input: SignalQualificationInput, value: string, reasonCodes: SignalQualificationReasonCode[]): number {
  const geography = input.profile.geography;
  const dependency = clamp(geography.location_dependency ?? 0);
  if (dependency < 0.6) return 1;
  const expected = [geography.primary_city, geography.primary_region, geography.primary_country_code, ...(geography.demand_geography_terms ?? [])].filter((item): item is string => Boolean(item)).map(lower);
  if (!expected.length) return 1;
  if (expected.some((term) => value.includes(term))) {
    reasonCodes.push("GEO_CONTEXT_MATCH");
    return 1;
  }
  const hasLocationPhrase = /\b(?:in|near|around|at)\s+[a-z][a-z -]{2,40}\b/i.test(value);
  if (hasLocationPhrase) {
    reasonCodes.push("GEO_MISMATCH");
    return 0.55;
  }
  return 1;
}

function metric(value: JsonRecord, key: string): number | null {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
}

function resonanceFor(input: SignalQualificationInput): MarketResonance {
  const metadata = jsonRecord(input.sourceItem.metadata);
  const publicMetrics = jsonRecord(metadata.publicMetrics);
  const source = input.sourceItem.source_key;
  const likes = source === "x" ? metric(publicMetrics, "like_count") : source === "bluesky" ? metric(metadata, "likeCount") : null;
  const replies = source === "x" ? metric(publicMetrics, "reply_count") : source === "bluesky" ? metric(metadata, "replyCount") : null;
  const reposts = source === "x" ? metric(publicMetrics, "retweet_count") : source === "bluesky" ? metric(metadata, "repostCount") : null;
  const upvotes = source === "reddit" ? metric(metadata, "score") : source === "hacker-news" ? metric(metadata, "points") : null;
  const reactions = source === "github" ? metric(jsonRecord(metadata.reactions), "total_count") : source === "bluesky" ? metric(metadata, "quoteCount") : null;
  const comments = source === "reddit" ? metric(metadata, "numComments") : source === "github" ? metric(metadata, "comments") : source === "hacker-news" ? metric(metadata, "childCount") : null;
  const values = [likes, replies, reposts, upvotes, reactions, comments].filter((value): value is number => value !== null);
  const total = values.reduce((sum, value) => sum + value, 0);
  const score = values.length ? clamp(1 - Math.exp(-Math.log1p(total) / Math.log1p(1_000))) : 0;
  const normalized = (value: number | null) => value === null ? undefined : clamp(1 - Math.exp(-Math.log1p(value) / Math.log1p(1_000)));
  return marketResonance({
    available: values.length > 0,
    score,
    likes,
    replies,
    reposts,
    upvotes,
    reactions,
    comments,
    source_normalized_metrics: Object.fromEntries(Object.entries({ likes: normalized(likes), replies: normalized(replies), reposts: normalized(reposts), upvotes: normalized(upvotes), reactions: normalized(reactions), comments: normalized(comments) }).filter((entry): entry is [string, number] => typeof entry[1] === "number")),
    reason: values.length ? `Normalized provider metrics independently for ${source}. Engagement is contextual only.` : "The provider did not supply usable engagement metrics.",
  });
}

function marketResonance(value: MarketResonance): MarketResonance {
  return value;
}

function dimensionsFor(input: SignalQualificationInput, profileMatches: string[], evidence: SignalQualificationEvidenceSpan[], primaryIntent: SignalQualificationPrimaryIntent, demand: DirectionalDemand, reasonCodes: SignalQualificationReasonCode[]): SignalQualificationDimensions {
  const value = lower(sourceText(input));
  const strongIntent = STRONG_COMMERCIAL_INTENTS.includes(primaryIntent);
  const profileAlignment = profileMatches.length ? Math.min(1, 0.55 + profileMatches.length * 0.22) : 0;
  // A literal category-name mention ("issue tracking software") is the strongest, most
  // explicit category signal, but real conversations express category relevance through
  // competitor names and pain language far more often than the category's own taxonomy
  // label. A matched competitor (from the product's own structured competitor list) paired
  // with genuine commercial intent (switching, alternative-seeking, purchase research, ...)
  // is itself strong evidence of category-relevant demand — not merely incidental keyword
  // overlap — so it must not be scored as though no category context were present. A
  // matched pain/feature/JTBD concept without a named competitor is weaker evidence on its
  // own, so it earns a smaller boost, still gated on genuine commercial intent so an
  // isolated, out-of-context concept match (no buying signal at all) doesn't count.
  const hasCompetitorMatch = competitorMatched(input, value);
  // A named competitor plus genuine commercial intent is at least as strong a category
  // signal as the category's own taxonomy label (often stronger — a competitor name is
  // unambiguous, a category label can be generic), so it earns the same top tier.
  const categoryAlignment = (input.profile.primary_category && value.includes(lower(input.profile.primary_category))) || (hasCompetitorMatch && strongIntent)
    ? 0.95
    : profileMatches.length && strongIntent
      ? 0.65
      : 0.35;
  // Relevance must answer "how strongly does this conversation represent demand that could
  // materially matter to this product", not "how explicitly does it name this product".
  // matchConfidence (a keyword/token-overlap score against the product's own vocabulary)
  // previously carried 65% of the weight, which structurally capped competitor/category
  // demand below the qualification threshold: such conversations rarely share much literal
  // vocabulary with the product's own profile, no matter how clearly they match the
  // product's own structured competitors/pains/category. profileAlignment and
  // categoryAlignment's combined weight is raised (28%/20%, from 25%/10%) so a genuine
  // competitor/category match — which categoryAlignment above now recognizes even without a
  // literal category-name mention — can meaningfully close that gap instead of being nearly
  // powerless against matchConfidence.
  const rawProductRelevance = clamp(input.match.matchConfidence * 0.47 + profileAlignment * 0.28 + categoryAlignment * 0.2 + (input.match.decision === "qualified" ? 0.05 : 0)) * geographicAdjustment(input, value, reasonCodes);
  const productRelevance = demand.positive_for_product === false ? Math.min(rawProductRelevance, 0.45) : rawProductRelevance;
  const demandIntent = clamp(({ switching_intent: 0.95, alternative_search: 0.9, recommendation_request: 0.82, purchase_research: 0.82, comparison_intent: 0.8, vendor_evaluation: 0.82, renewal_reconsideration: 0.78, feature_requirement: 0.8, explicit_pain: 0.68, problem_solution_search: 0.68, unmet_need: 0.72, unknown: 0.12 } satisfies Record<SignalQualificationPrimaryIntent, number>)[primaryIntent] + (hasAny(value, [/\bneed\b/, /\blooking for\b/, /\bwhat are alternatives\b/, /\bwe(?:'re| are) replacing\b/, /\bdoes anyone know\b/, /\bwish this supported\b/]) ? 0.05 : 0));
  const concreteSignals = [
    /\b(?:our team|we use|for our company|for a \d+[- ]?person team)\b/i.test(value),
    profileMatches.length > 0,
    /\b(?:because|so that|before|after|due to)\b/i.test(value),
    /\b(?:with|supports?|requires?|need(?:s)?|must have)\b/i.test(value),
  ].filter(Boolean).length;
  const specificity = clamp(Math.max(input.analysis.specificity, 0.25 + concreteSignals * 0.16 + (profileMatches.length ? 0.08 : 0)));
  const painCount = strings(input.analysis.pain_themes).length;
  const buyerLanguageCount = strings(input.analysis.buyer_language).length;
  const audienceSignalCount = strings(input.analysis.audience_signals).length;
  const painClarity = clamp(painCount ? 0.48 + Math.min(0.3, painCount * 0.06) + (hasAny(value, [/\btoo expensive\b/, /\bmanual(?:ly)?\b/, /\bslow\b/, /\bfrustrat\w*\b/, /\bcomplex\b/, /\bmissing\b/, /\bproblem\b/, /\bspends?\b/]) ? 0.16 : 0) : hasAny(value, [/\btoo expensive\b/, /\bmanual(?:ly)?\b/, /\bslow\b/, /\bfrustrat\w*\b/, /\bcomplex\b/, /\bmissing\b/, /\bproblem\b/, /\bspends?\b/]) ? 0.78 : 0.15);
  const buyerPlausibilityCap = demand.speaker_role === "maintainer" ? 0.5 : demand.speaker_role === "unknown" && demand.demand_target_type === "third_party_product" ? 0.45 : 1;
  const buyerPlausibility = clamp(Math.min(buyerPlausibilityCap, (buyerLanguageCount || audienceSignalCount ? 0.68 : 0.25) + (hasAny(value, [/\b(?:our team|we need|we use|for our company|i need|my team)\b/]) ? 0.2 : 0)));
  const commercialRelevance = clamp((strongIntent ? 0.72 : 0.3) + (buyerPlausibility >= 0.7 ? 0.12 : 0) + (painClarity >= 0.7 ? 0.08 : 0) + (profileMatches.length ? 0.08 : 0));
  const evidenceQuality = evidence.length ? clamp(0.68 + Math.min(0.2, evidence.length * 0.04) + (input.analysis.confidence * 0.12)) : 0.12;
  const freshness = freshnessScore(input.sourceItem.published_at ?? input.sourceItem.captured_at, input.now ?? new Date());
  const source = sourceQuality(input.sourceItem.source_key);
  const isMeme = hasAny(value, [/\bmeme\b/, /\blol\b/, /\blmao\b/, /😂|🤣|😭/]) && !strongIntent;
  const isNews = Boolean(input.sourceItem.title && hasAny(value, [/\bnews\b/, /\bannounc(?:e|es|ed)\b/, /\breports?\b/, /\blaunched\b/])) && !strongIntent;
  const isLinkOnly = Boolean(input.sourceItem.canonical_url && bodyText(input).trim().length < 40 && !strongIntent);
  const isGenericMention = value.split(/\s+/).length <= 8 && !strongIntent && !hasAny(value, [/\b(?:need|looking for|problem|pain|alternative|switch|replace|wish)\b/]);
  const isRetweet = jsonRecord(input.sourceItem.metadata).isRetweet === true;
  const noiseRisk = clamp((isMeme ? 0.9 : 0) + (isNews ? 0.72 : 0) + (isLinkOnly ? 0.72 : 0) + (isGenericMention ? 0.68 : 0) + (isRetweet ? 0.85 : 0) + (!strongIntent && input.analysis.intent_type === "informational" ? 0.28 : 0));
  const contentQuality = inspectSignalContent({ conversation: input.conversation, sourceItem: input.sourceItem });
  const promotionalProbability = clamp(Math.max(contentQuality.promotionalProbability, hasAny(value, [/\bwe launched\b/, /\bsign up\b/, /\btry it free\b/, /\bget \d+% off\b/, /\buse code\b/, /\baffiliate\b/, /\breferral\b/, /\bbuy now\b/, /\bbook a demo\b/]) ? 0.85 : 0));
  const repetitive = jsonRecord(input.sourceItem.metadata).bot === true || jsonRecord(input.sourceItem.metadata).isBot === true || jsonRecord(input.sourceItem.metadata).repetitive === true;
  const spamProbability = clamp((repetitive ? 0.85 : 0) + (hasAny(value, [/\bgiveaway\b/, /\bcoupon\b/, /\bfree money\b/, /\bcrypto\b/]) ? 0.8 : 0) + (promotionalProbability > 0.7 ? 0.25 : 0));
  if (productRelevance >= 0.65) reasonCodes.push("HIGH_PRODUCT_RELEVANCE"); else reasonCodes.push("LOW_RELEVANCE");
  if (demand.positive_for_product === false) reasonCodes.push("NON_POSITIVE_PRODUCT_DIRECTION");
  if (strongIntent) reasonCodes.push(primaryIntent === "switching_intent" ? "STRONG_SWITCHING_INTENT" : primaryIntent === "alternative_search" ? "STRONG_ALTERNATIVE_INTENT" : primaryIntent === "recommendation_request" ? "RECOMMENDATION_INTENT" : primaryIntent === "comparison_intent" ? "COMPARISON_INTENT" : primaryIntent === "feature_requirement" ? "CLEAR_FEATURE_REQUIREMENT" : "COMMERCIAL_CONTEXT_PRESENT");
  if (painClarity >= 0.7) reasonCodes.push("SPECIFIC_PAIN", "EXPLICIT_PAIN");
  if (buyerPlausibility >= 0.7) reasonCodes.push("CLEAR_BUYER_CONTEXT", "BUYER_CONTEXT_PRESENT");
  if (evidence.length) reasonCodes.push("STRONG_EVIDENCE"); else reasonCodes.push("INSUFFICIENT_EVIDENCE");
  if (specificity < SIGNAL_QUALIFICATION_THRESHOLDS.qualified.specificity) reasonCodes.push("INSUFFICIENT_SPECIFICITY");
  if (demandIntent < SIGNAL_QUALIFICATION_THRESHOLDS.qualified.demandIntent && painClarity < SIGNAL_QUALIFICATION_THRESHOLDS.qualified.painClarity) reasonCodes.push("INSUFFICIENT_INTENT");
  if (isMeme) reasonCodes.push("MEME_OR_JOKE", "NOISE_RISK");
  if (isNews) reasonCodes.push("NEWS_ONLY", "NOISE_RISK");
  if (isLinkOnly) reasonCodes.push("LINK_ONLY", "NOISE_RISK");
  if (isGenericMention) reasonCodes.push("GENERIC_BRAND_MENTION");
  if (isRetweet) reasonCodes.push("DUPLICATE_CONTENT");
  if (promotionalProbability >= 0.7) reasonCodes.push("PROMOTIONAL_CONTENT");
  if (spamProbability >= 0.5) reasonCodes.push("SPAM_RISK");
  if (noiseRisk >= 0.5) reasonCodes.push("NOISE_RISK");
  if (input.profile.profile_confidence < 0.55) reasonCodes.push("LOW_PROFILE_CONFIDENCE");
  if (bodyText(input).trim().length < 40 && strongIntent) reasonCodes.push("SHORT_EXPLICIT_DEMAND");
  if (jsonRecord(input.sourceItem.metadata).isReply === true && !strongIntent && evidence.length === 0) reasonCodes.push("INSUFFICIENT_INTENT");
  return { product_relevance: clamp(productRelevance), demand_intent: demandIntent, specificity, pain_clarity: painClarity, buyer_plausibility: buyerPlausibility, commercial_relevance: commercialRelevance, evidence_quality: evidenceQuality, freshness, source_quality: source, noise_risk: noiseRisk, spam_probability: spamProbability, promotional_probability: promotionalProbability };
}

function uniqueCodes(codes: SignalQualificationReasonCode[]): SignalQualificationReasonCode[] {
  return [...new Set(codes)];
}

function scoreDemandQuality(dimensions: SignalQualificationDimensions): number {
  const base = dimensions.product_relevance * SIGNAL_QUALIFICATION_WEIGHTS.productRelevance + dimensions.demand_intent * SIGNAL_QUALIFICATION_WEIGHTS.demandIntent + dimensions.specificity * SIGNAL_QUALIFICATION_WEIGHTS.specificity + dimensions.pain_clarity * SIGNAL_QUALIFICATION_WEIGHTS.painClarity + dimensions.buyer_plausibility * SIGNAL_QUALIFICATION_WEIGHTS.buyerPlausibility + dimensions.commercial_relevance * SIGNAL_QUALIFICATION_WEIGHTS.commercialRelevance + dimensions.evidence_quality * SIGNAL_QUALIFICATION_WEIGHTS.evidenceQuality + dimensions.freshness * SIGNAL_QUALIFICATION_WEIGHTS.freshness + dimensions.source_quality * SIGNAL_QUALIFICATION_WEIGHTS.sourceQuality;
  return clamp(base - dimensions.noise_risk * SIGNAL_QUALIFICATION_PENALTIES.noiseRisk - dimensions.spam_probability * SIGNAL_QUALIFICATION_PENALTIES.spamProbability - dimensions.promotional_probability * SIGNAL_QUALIFICATION_PENALTIES.promotionalProbability);
}

function confidenceFor(input: SignalQualificationInput, dimensions: SignalQualificationDimensions, evidence: SignalQualificationEvidenceSpan[]): number {
  return clamp(input.analysis.confidence * 0.35 + input.match.matchConfidence * 0.25 + dimensions.evidence_quality * 0.2 + input.profile.profile_confidence * 0.1 + dimensions.source_quality * 0.1 + (evidence.length ? 0.03 : 0));
}

function actorLabel(demand: DirectionalDemand): string {
  return demand.speaker_role === "buyer" ? "User" : demand.speaker_role === "maintainer" ? "Maintainer" : "Conversation";
}

function nameList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "another system";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function reasonText(status: SignalQualificationStatus, intent: SignalQualificationPrimaryIntent, target: ReturnType<typeof detectIntentTarget>, concepts: string[], evidence: SignalQualificationEvidenceSpan[], demand: DirectionalDemand): string {
  const actor = actorLabel(demand);
  const targetName = demand.demand_target_name ?? "another product";
  const sources = nameList(demand.source_products);
  if (demand.demand_target_type === "implementation") return `${actor} is asking for an implementation or authentication change${demand.demand_target_name ? ` related to ${demand.demand_target_name}` : ""}.`;
  if (demand.host_product_context && demand.source_products.length) return `${actor} is evaluating ${targetName} as a ${sources} alternative and asking for ${sources}-like features.`;
  if (demand.demand_direction === "away_from_product" && demand.source_products.length) return `${actor} is moving from ${sources} to ${targetName}.`;
  if (demand.demand_target_type === "third_party_product") return `${actor} wants to move or migrate existing work into ${targetName}${demand.source_products.length ? ` from ${sources}` : ""}.`;
  if (demand.demand_target_type === "category" && demand.source_products.length) return `${actor} is looking for an alternative to ${sources}${demand.demand_target_name ? ` for ${demand.demand_target_name}` : ""}.`;
  if (demand.demand_direction === "toward_product" && demand.demand_target_name && demand.source_products.length) return `${actor} is moving from ${sources} to ${demand.demand_target_name}.`;
  if (demand.demand_target_type === "scanned_product" && demand.demand_target_name) return `${actor} is looking for or requesting a capability from ${demand.demand_target_name}.`;
  if (target === "authentication" || target === "implementation") {
    const technicalObject = target === "authentication" ? "an authentication method" : "an implementation detail";
    const technicalReason = `Technical request about ${technicalObject}${concepts.length ? ` related to ${concepts.slice(0, 2).join(", ")}` : ""}.`;
    return `${technicalReason}${evidence[0] ? ` Evidence: “${evidence[0].text.slice(0, 240)}”` : ""}`.slice(0, 2_000);
  }
  const verb = intent === "switching_intent" ? "actively considering a switch" : intent === "alternative_search" ? "looking for an alternative" : intent === "recommendation_request" ? "requesting a recommendation" : intent === "feature_requirement" ? "describing a required capability" : intent === "comparison_intent" ? "comparing solutions" : intent === "explicit_pain" || intent === "problem_solution_search" ? "describing a concrete problem" : "showing possible solution interest";
  const conceptText = concepts.length ? ` related to ${concepts.slice(0, 3).join(", ")}` : "";
  const evidenceText = evidence[0] ? ` Evidence: “${evidence[0].text.slice(0, 240)}”` : "";
  const reason = status === "high_confidence_signal" ? `High-confidence demand: ${verb}${conceptText}, with specific, traceable evidence.` : status === "qualified" ? `${verb.charAt(0).toUpperCase()}${verb.slice(1)}${conceptText}, supported by specific evidence.` : status === "weak_candidate" ? `${verb.charAt(0).toUpperCase()}${verb.slice(1)}${conceptText}, but the available evidence is limited.` : "No clear product-relevant demand was found in this conversation.";
  return `${reason}${evidenceText}`.slice(0, 2_000);
}

function buildQualification(input: SignalQualificationInput): SignalQualification {
  if (input.analysis.status === "failed" || input.analysis.status === "skipped") throw new Error("qualification_analysis_unavailable");
  const primaryIntent = intentFromText(input);
  const value = sourceText(input);
  const intentTarget = detectIntentTarget(value);
  const concepts = matchedConcepts(input, value);
  const demand = deriveDirectionalDemand({ productName: input.productName, title: input.conversation.title ?? input.sourceItem.title, body: bodyText(input), sourceKey: input.sourceItem.source_key, sourceMetadata: input.sourceItem.metadata, knownProducts: [...profileLabels(input.profile.competitors), ...profileLabels(input.profile.alternatives.filter((entry) => typeof entry !== "string" && entry.alternative_type === "competitor_product"))].map((item) => item.label), category: input.profile.primary_category });
  const reasonCodes: SignalQualificationReasonCode[] = [];
  const evidence = verifiedEvidence(input, primaryIntent);
  const dimensions = dimensionsFor(input, concepts, evidence, primaryIntent, demand, reasonCodes);
  const confidence = confidenceFor(input, dimensions, evidence) * (input.profile.profile_confidence < 0.55 ? 0.9 : 1);
  const strongIntent = STRONG_COMMERCIAL_INTENTS.includes(primaryIntent);
  const qualified = demand.positive_for_product !== false && dimensions.product_relevance >= SIGNAL_QUALIFICATION_THRESHOLDS.qualified.productRelevance && (dimensions.demand_intent >= SIGNAL_QUALIFICATION_THRESHOLDS.qualified.demandIntent || dimensions.pain_clarity >= SIGNAL_QUALIFICATION_THRESHOLDS.qualified.painClarity || strongIntent) && dimensions.specificity >= SIGNAL_QUALIFICATION_THRESHOLDS.qualified.specificity && dimensions.evidence_quality >= SIGNAL_QUALIFICATION_THRESHOLDS.qualified.evidenceQuality && dimensions.noise_risk < 0.5 && dimensions.spam_probability < SIGNAL_QUALIFICATION_THRESHOLDS.qualified.spamProbabilityMaxExclusive && dimensions.promotional_probability < SIGNAL_QUALIFICATION_THRESHOLDS.qualified.promotionalProbabilityMaxExclusive && evidence.length > 0;
  const highConfidence = qualified && dimensions.product_relevance >= SIGNAL_QUALIFICATION_THRESHOLDS.highConfidence.productRelevance && dimensions.demand_intent >= SIGNAL_QUALIFICATION_THRESHOLDS.highConfidence.demandIntent && dimensions.specificity >= SIGNAL_QUALIFICATION_THRESHOLDS.highConfidence.specificity && dimensions.evidence_quality >= SIGNAL_QUALIFICATION_THRESHOLDS.highConfidence.evidenceQuality && dimensions.commercial_relevance >= SIGNAL_QUALIFICATION_THRESHOLDS.highConfidence.commercialRelevance && confidence >= SIGNAL_QUALIFICATION_THRESHOLDS.highConfidence.confidence && dimensions.noise_risk < SIGNAL_QUALIFICATION_THRESHOLDS.highConfidence.noiseRiskMaxExclusive && strongIntent;
  const status: SignalQualificationStatus = highConfidence ? "high_confidence_signal" : qualified ? "qualified" : dimensions.product_relevance >= 0.4 || dimensions.demand_intent >= 0.35 || dimensions.pain_clarity >= 0.4 ? "weak_candidate" : "rejected";
  const resonance = resonanceFor(input);
  if (resonance.available) reasonCodes.push("ENGAGEMENT_NOT_QUALIFYING");
  const uniqueReasonCodes = uniqueCodes(reasonCodes);
  const gateFailures = [
    ...(dimensions.product_relevance < SIGNAL_QUALIFICATION_THRESHOLDS.qualified.productRelevance ? ["product_relevance"] : []),
    ...(dimensions.demand_intent < SIGNAL_QUALIFICATION_THRESHOLDS.qualified.demandIntent && dimensions.pain_clarity < SIGNAL_QUALIFICATION_THRESHOLDS.qualified.painClarity && !strongIntent ? ["demand_intent"] : []),
    ...(dimensions.specificity < SIGNAL_QUALIFICATION_THRESHOLDS.qualified.specificity ? ["specificity"] : []),
    ...(dimensions.evidence_quality < SIGNAL_QUALIFICATION_THRESHOLDS.qualified.evidenceQuality || evidence.length === 0 ? ["evidence_quality"] : []),
    ...(dimensions.spam_probability >= SIGNAL_QUALIFICATION_THRESHOLDS.qualified.spamProbabilityMaxExclusive ? ["spam_probability"] : []),
    ...(dimensions.promotional_probability >= SIGNAL_QUALIFICATION_THRESHOLDS.qualified.promotionalProbabilityMaxExclusive ? ["promotional_probability"] : []),
  ];
  return signalQualificationSchema.parse({
    version: SIGNAL_QUALIFICATION_VERSION,
    candidate_id: input.candidateId,
    product_id: input.productId,
    status,
    demand_quality_score: scoreDemandQuality(dimensions),
    confidence,
    dimensions,
    primary_intent: primaryIntent,
    intent_target: intentTarget,
    demand_direction: demand.demand_direction,
    demand_target_type: demand.demand_target_type,
    demand_target_name: demand.demand_target_name,
    source_products: demand.source_products,
    speaker_role: demand.speaker_role,
    matched_profile_concepts: concepts,
    evidence_spans: evidence,
    reason_codes: uniqueReasonCodes,
    qualification_reason: reasonText(status, primaryIntent, intentTarget, concepts, evidence, demand),
    resonance,
    diagnostics: {
      qualification_version: SIGNAL_QUALIFICATION_VERSION,
      threshold_version: SIGNAL_QUALIFICATION_THRESHOLD_VERSION,
      analysis_version: input.analysis.engine_version_id ?? null,
      demand_profile_version: input.profile.profile_version ?? null,
      profile_confidence: clamp(input.profile.profile_confidence),
      evidence_validated: evidence.length > 0,
      gate_failures: gateFailures,
      failed: false,
      failure_code: null,
    },
  });
}

export function qualifySignal(input: SignalQualificationInput): SignalQualification {
  return buildQualification(input);
}

export function failClosedQualification(input: Pick<SignalQualificationInput, "candidateId" | "productId" | "profile" | "analysis">, failureCode = "QUALIFICATION_FAILED"): SignalQualification {
  return signalQualificationSchema.parse({
    version: SIGNAL_QUALIFICATION_VERSION,
    candidate_id: input.candidateId,
    product_id: input.productId,
    status: "rejected",
    demand_quality_score: 0,
    confidence: 0,
    dimensions: { product_relevance: 0, demand_intent: 0, specificity: 0, pain_clarity: 0, buyer_plausibility: 0, commercial_relevance: 0, evidence_quality: 0, freshness: 0, source_quality: 0, noise_risk: 1, spam_probability: 1, promotional_probability: 1 },
    primary_intent: "unknown",
    intent_target: "unknown",
    matched_profile_concepts: [],
    evidence_spans: [],
    reason_codes: ["QUALIFICATION_FAILED", "INSUFFICIENT_EVIDENCE"],
    qualification_reason: "Rejected because Signal Qualification failed closed and did not produce a trustworthy result.",
    resonance: { available: false, score: 0, likes: null, replies: null, reposts: null, upvotes: null, reactions: null, comments: null, source_normalized_metrics: {}, reason: "Resonance was not evaluated after qualification failure." },
    diagnostics: { qualification_version: SIGNAL_QUALIFICATION_VERSION, threshold_version: SIGNAL_QUALIFICATION_THRESHOLD_VERSION, analysis_version: input.analysis.engine_version_id ?? null, demand_profile_version: input.profile.profile_version ?? null, profile_confidence: clamp(input.profile.profile_confidence), evidence_validated: false, gate_failures: [failureCode], failed: true, failure_code: failureCode },
  });
}

export function canMaterializeQualifiedSignal(value: SignalQualification | null | undefined): boolean {
  return value?.status === "qualified" || value?.status === "high_confidence_signal";
}

export function qualificationFromEvidence(value: Json | null | undefined): SignalQualification | null {
  const record = jsonRecord(value ?? null);
  const parsed = signalQualificationSchema.safeParse(record.qualification);
  return parsed.success ? parsed.data : null;
}

export function serializeQualification(value: SignalQualification): Json {
  return value as unknown as Json;
}

export function formatSignalQualificationCalibration(input: { source: string; text: string; qualification: SignalQualification }): string {
  const { qualification } = input;
  return [
    `Signal Qualification ${qualification.version}`,
    `source: ${input.source}`,
    `text: ${text(input.text).slice(0, 500)}`,
    `status: ${qualification.status}`,
    `demand_quality_score: ${qualification.demand_quality_score.toFixed(3)}`,
    `confidence: ${qualification.confidence.toFixed(3)}`,
    `dimensions: ${JSON.stringify(qualification.dimensions)}`,
    `primary_intent: ${qualification.primary_intent}`,
    `intent_target: ${qualification.intent_target}`,
    `demand_direction: ${qualification.demand_direction}`,
    `demand_target_type: ${qualification.demand_target_type}`,
    `demand_target_name: ${qualification.demand_target_name ?? "none"}`,
    `source_products: ${qualification.source_products.join(", ") || "none"}`,
    `speaker_role: ${qualification.speaker_role}`,
    `matched_profile_concepts: ${qualification.matched_profile_concepts.join(", ") || "none"}`,
    `reason_codes: ${qualification.reason_codes.join(", ") || "none"}`,
    `evidence_spans: ${JSON.stringify(qualification.evidence_spans)}`,
    `resonance: ${JSON.stringify(qualification.resonance)}`,
    `reason: ${qualification.qualification_reason}`,
  ].join("\n");
}
