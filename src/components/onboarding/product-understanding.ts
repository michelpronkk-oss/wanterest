import type { ProductSnapshotRow } from "@/server/db/database.helpers";
import type { BusinessClassification, DemandProfileV2 } from "@/server/modules/intelligence";

type SnapshotMetadata = {
  business_classification?: BusinessClassification;
  demand_profile_v2?: DemandProfileV2;
};

export type DerivedProductUnderstanding = {
  /** True when whatYouDo was built from real classification/profile fields, not the raw Step 2 text. */
  isDerived: boolean;
  whatYouDo: string | null;
  whoItsFor: string[];
  watchingFor: string[];
};

function readMetadata(snapshot: ProductSnapshotRow | null): SnapshotMetadata {
  return (snapshot?.metadata ?? {}) as SnapshotMetadata;
}

function summarizeWhatYouDo(profile: DemandProfileV2 | undefined, classification: BusinessClassification | undefined): string | null {
  const topJob = profile?.jobs_to_be_done?.[0];
  if (topJob?.actor && topJob.job) {
    const job = humanizeValue(topJob.job) ?? topJob.job;
    const outcomeValue = topJob.desired_result ? humanizeValue(topJob.desired_result) : null;
    const outcome = outcomeValue ? ` so they can ${lowercaseFirst(outcomeValue)}` : "";
    const actor = humanizeValue(topJob.actor) ?? topJob.actor;
    return `Helps ${lowercaseFirst(actor)} ${lowercaseFirst(job)}${outcome}.`;
  }
  const topProblem = profile?.problems?.[0];
  if (topProblem?.description) {
    return `Solves: ${topProblem.description}`;
  }
  const topOutcome = profile?.desired_outcomes?.[0];
  if (topOutcome?.description) {
    return `Helps customers ${lowercaseFirst(topOutcome.description)}`;
  }
  if (classification?.primary_category) {
    const category = humanizeValue(classification.primary_category) ?? classification.primary_category;
    return `A ${category} product.`;
  }
  return null;
}

function lowercaseFirst(value: string): string {
  return value.length ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

const HUMAN_LABELS: Record<string, string> = {
  b2b: "B2B",
  b2b_saas: "B2B SaaS",
  b2c: "B2C",
  b2b2c: "B2B2C",
  product_manager: "Product managers",
  product_managers: "Product managers",
  engineering_leader: "Engineering leaders",
  engineering_leaders: "Engineering leaders",
  software_development_team: "Software development teams",
  software_development_teams: "Software development teams",
  team_lead: "Team leads",
  developer: "Developers",
  developers: "Developers",
  founder: "Founders",
  founders: "Founders",
  store_operator: "Store operators",
  store_operators: "Store operators",
};

const GENERIC_AUDIENCE_VALUES = new Set(["business", "businesses", "customer", "customers", "user", "users", "people"]);

function valueKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function humanizeValue(value: string): string | null {
  const normalized = value.replace(/[\s_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const override = HUMAN_LABELS[valueKey(value)];
  if (override) return override;
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function dedupeHumanValues(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const label = humanizeValue(value);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(label);
    if (result.length >= limit) break;
  }
  return result;
}

type WatchingSource = "switching" | "buying" | "pain" | "competitor" | "comparison" | "alternative" | "feature" | "jtbd" | "category";
type WatchingCandidate = {
  label: string;
  source: WatchingSource;
  confidence: number;
  order: number;
  score: number;
};

const WATCHING_SOURCE_PRIORITY: Record<WatchingSource, number> = {
  switching: 100,
  buying: 92,
  pain: 84,
  comparison: 74,
  competitor: 68,
  alternative: 60,
  feature: 52,
  jtbd: 42,
  category: 20,
};

const GENERIC_CONCEPT_KEYS = new Set([
  "business_software",
  "productivity_software",
  "workflow_tools",
  "project_management",
  "better_productivity",
  "solutions_to_current_problems",
  "product_comparisons",
  "purchase_research",
  "vendor_evaluation",
  "renewal_alternatives",
  "alternatives_to_existing_tools",
  "product_recommendations",
  "switching_from_current_tools",
  "must_have_features",
]);

const GENERIC_WORDS = new Set(["business", "software", "productivity", "workflow", "workflows", "tool", "tools", "solution", "solutions", "problem", "problems", "project", "management"]);
const SEMANTIC_STOP_WORDS = new Set(["a", "an", "and", "for", "from", "with", "to", "of", "the", "need", "needs", "better", "current", "software", "tool", "tools", "workflow", "workflows"]);

const BUYING_INTENT_LABELS: Record<string, string | null> = {
  alternative_search: "Alternatives to existing tools",
  recommendation_request: "Product recommendations",
  switching_intent: "Switching from current tools",
  purchase_research: "Purchase research",
  problem_solution_search: "Solutions to current problems",
  feature_requirement: "Must-have features",
  comparison_intent: "Product comparisons",
  vendor_evaluation: "Vendor evaluation",
  renewal_reconsideration: "Renewal alternatives",
  unknown: null,
};

function conceptTokens(value: string): string[] {
  return valueKey(value).split("_").filter((token) => token.length > 1 && !SEMANTIC_STOP_WORDS.has(token));
}

function isGenericConcept(value: string, source: WatchingSource): boolean {
  const key = valueKey(value);
  if (GENERIC_CONCEPT_KEYS.has(key)) return true;
  if (source === "buying" && /^(?:problem|intent|evidence|signal|language)\b.*\b(?:explicit|present|found|detected|identified)\b/i.test(value)) return true;
  if (/^(?:users?|teams?|people)\s+(?:seek|need|want|look(?:ing)?\s+for)\s+(?:a\s+)?(?:solutions?|tools?|ways?)\s+to\s+(?:improve|better|manage|help)\b/i.test(value)) return true;
  if (source === "jtbd" && /^(?:plan|build|ship|manage|improve)\b.*\b(?:efficiently|effectively|collaboratively|productively|better|faster)\b/i.test(value)) return true;
  if (/^(?:need|needs)\s+for\s+(?:better\s+)?(?:productivity|collaboration|workflow|project management)\b/i.test(value)) return true;
  if (/^(?:solutions?|answers?)\s+to\s+(?:current|common|general)\s+(?:problems?|needs?)\b/i.test(value)) return true;
  const tokens = conceptTokens(value);
  if (!tokens.length) return true;
  if (tokens.length === 1 && GENERIC_WORDS.has(tokens[0])) return true;
  return source === "category" && tokens.length < 2;
}

function humanizeConcept(value: string): string | null {
  const label = humanizeValue(value);
  if (!label) return null;
  return label.replace(/\b(from|to|vs|versus)\s+([a-z][a-z0-9.-]*)/gi, (_match, pre: string, name: string) => `${pre} ${name.charAt(0).toUpperCase()}${name.slice(1)}`);
}

function conceptConfidence(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

function addWatchingCandidate(candidates: WatchingCandidate[], rawValue: string | null | undefined, source: WatchingSource, confidence: number | undefined, order: number): void {
  if (!rawValue) return;
  const label = humanizeConcept(rawValue);
  if (!label || isGenericConcept(label, source)) return;
  const tokens = conceptTokens(label);
  const comparisonBonus = /\b(?:vs|versus|alternative|replace|switch|migrat|outgrow)\b/i.test(label) ? 22 : 0;
  const namedValueBonus = source === "competitor" || source === "comparison" ? 16 : 0;
  const specificityBonus = Math.min(20, tokens.length * 4);
  const score = WATCHING_SOURCE_PRIORITY[source] + specificityBonus + comparisonBonus + namedValueBonus + conceptConfidence(confidence) * 8;
  candidates.push({ label, source, confidence: conceptConfidence(confidence), order, score });
}

function semanticallyOverlaps(first: string, second: string): boolean {
  const firstTokens = new Set(conceptTokens(first));
  const secondTokens = new Set(conceptTokens(second));
  if (!firstTokens.size || !secondTokens.size) return false;
  const shared = [...firstTokens].filter((token) => secondTokens.has(token)).length;
  return shared / Math.min(firstTokens.size, secondTokens.size) >= 0.75;
}

function selectWatchingCandidates(candidates: WatchingCandidate[]): string[] {
  const selected: WatchingCandidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => WATCHING_SOURCE_PRIORITY[b.source] - WATCHING_SOURCE_PRIORITY[a.source] || b.score - a.score || a.order - b.order)) {
    const duplicateIndex = selected.findIndex((existing) => semanticallyOverlaps(existing.label, candidate.label));
    if (duplicateIndex >= 0) {
      const existing = selected[duplicateIndex];
      const existingTokenCount = conceptTokens(existing.label).length;
      const candidateTokenCount = conceptTokens(candidate.label).length;
      if (candidateTokenCount > existingTokenCount && candidate.score > existing.score) selected[duplicateIndex] = candidate;
      continue;
    }
    selected.push(candidate);
    if (selected.length >= 6) break;
  }
  return selected.sort((a, b) => WATCHING_SOURCE_PRIORITY[b.source] - WATCHING_SOURCE_PRIORITY[a.source] || b.score - a.score || a.order - b.order).map((candidate) => candidate.label);
}

function summarizeAudience(profile: DemandProfileV2 | undefined): string[] {
  const audience = profile?.audience;
  if (!audience) return [];
  const candidates = [
    ...(audience.target_customer_types ?? []),
    ...(audience.buyer_roles ?? []),
    ...(audience.end_user_types ?? []),
    ...(audience.company_size_segments ?? []),
    ...(audience.industry_segments ?? []),
  ].filter(Boolean);
  if (candidates.length === 0) return [];
  const specificCandidates = candidates.filter((value) => !GENERIC_AUDIENCE_VALUES.has(valueKey(value)));
  return dedupeHumanValues(specificCandidates.length ? specificCandidates : candidates, 3);
}

function buildWatchingFor(profile: DemandProfileV2 | undefined): string[] {
  if (!profile) return [];
  const candidates: WatchingCandidate[] = [];
  let order = 0;
  for (const item of profile.switching_triggers ?? []) addWatchingCandidate(candidates, item.trigger, "switching", item.confidence, order++);
  for (const item of profile.buying_intents ?? []) {
    const reason = humanizeConcept(item.reason);
    const intentLabel = BUYING_INTENT_LABELS[item.intent_type] ?? null;
    addWatchingCandidate(candidates, reason && !isGenericConcept(reason, "buying") ? reason : intentLabel, "buying", item.relevance, order++);
  }
  for (const item of profile.problems ?? []) addWatchingCandidate(candidates, item.label, "pain", item.confidence, order++);
  for (const item of profile.comparison_terms ?? []) addWatchingCandidate(candidates, item.term, "comparison", item.confidence, order++);
  for (const item of profile.competitors?.known_competitors ?? []) addWatchingCandidate(candidates, item.name, "competitor", item.confidence, order++);
  for (const item of profile.competitors?.detected_competitor_candidates ?? []) addWatchingCandidate(candidates, item.name, "competitor", item.confidence, order++);
  for (const item of profile.alternatives ?? []) addWatchingCandidate(candidates, item.label, "alternative", item.confidence, order++);
  for (const item of profile.feature_demands ?? []) addWatchingCandidate(candidates, item.feature, "feature", item.confidence, order++);
  for (const item of profile.jobs_to_be_done ?? []) addWatchingCandidate(candidates, item.desired_result || item.job, "jtbd", item.confidence, order++);
  for (const item of profile.language?.category_terms ?? []) addWatchingCandidate(candidates, item, "category", 0.5, order++);
  return selectWatchingCandidates(candidates);
}

/**
 * Prefers a concise summary derived from real Business Classification v1 / Demand Profile v2
 * fields over the raw text captured in Step 2. Falls back to that raw text only when no
 * richer structured understanding exists yet. Never fabricates data — every value here is
 * either a stored structured field or a light template around one.
 */
export function deriveProductUnderstanding(snapshot: ProductSnapshotRow | null): DerivedProductUnderstanding {
  const metadata = readMetadata(snapshot);
  const profile = metadata.demand_profile_v2;
  const classification = metadata.business_classification;

  const derivedSummary = summarizeWhatYouDo(profile, classification);
  const rawFallback = snapshot?.normalized_text || snapshot?.raw_text || null;

  return {
    isDerived: derivedSummary !== null,
    whatYouDo: derivedSummary ?? rawFallback,
    whoItsFor: summarizeAudience(profile),
    watchingFor: buildWatchingFor(profile),
  };
}
