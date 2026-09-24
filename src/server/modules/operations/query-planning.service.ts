import type { BusinessClassification } from "../intelligence/business-classification.schemas";
import type { DemandProfileV2RoutingModel } from "../intelligence/demand-profile-v2.service";
import { sourceRoutingCapabilityProfiles } from "./source-routing.profiles";
import { selectExecutableSourceRoutes } from "./source-routing.service";
import type { SourceRoutingCapabilityProfile, SourceRoutingRoute, SourceRoutingScanMode } from "./source-routing.schemas";
import {
  queryPlanningVersion,
  type QueryFamily,
  type QueryPlan,
  type QueryPlanDiagnostics,
  type QueryPlanQuery,
  type QueryPlanReasonCode,
  type QueryPlanSource,
  type QueryPlanningInput,
} from "./query-planning.schemas";

type Candidate = Omit<QueryPlanQuery, "query_id" | "normalized_query" | "candidate_budget" | "priority" | "metadata" | "reason_summary" | "competitor_specific"> & {
  score: number;
  conceptConfidence: number;
  competitorSpecific: boolean;
  semanticKey: string;
};

type CandidateContext = {
  classification: BusinessClassification | null;
  profile: DemandProfileV2RoutingModel | null;
  route: SourceRoutingRoute;
  lowConfidence: boolean;
  category: string;
  audience: string;
  geoContext: string | null;
};

const familyOrder: QueryFamily[] = ["switching", "alternative_search", "comparison", "recommendation", "feature_requirement", "pain", "jtbd", "objection", "desired_outcome", "category_discovery"];
const competitorOrientedSurfaces = new Set<QueryPlanQuery["demand_surface"]>(["switching", "alternative_search", "competitor_pain"]);

function isNonCompetitorSurface(candidate: Pick<QueryPlanQuery, "demand_surface">): boolean {
  return !competitorOrientedSurfaces.has(candidate.demand_surface);
}
const surfaceForFamily: Record<QueryFamily, QueryPlanQuery["demand_surface"]> = {
  switching: "switching",
  alternative_search: "alternative_search",
  comparison: "competitor_pain",
  recommendation: "category_demand",
  feature_requirement: "feature_demand",
  pain: "pain_first",
  jtbd: "job_demand",
  objection: "commercial_pain",
  desired_outcome: "job_demand",
  category_discovery: "category_demand",
};
const commercialWeight: Record<QueryFamily, number> = {
  switching: 0.95,
  alternative_search: 0.9,
  comparison: 0.8,
  objection: 0.72,
  recommendation: 0.75,
  feature_requirement: 0.65,
  pain: 0.55,
  jtbd: 0.55,
  desired_outcome: 0.5,
  category_discovery: 0.35,
};
const intentForFamily: Record<QueryFamily, QueryPlanQuery["intent_type"]> = {
  pain: "problem_solution_search",
  alternative_search: "alternative_search",
  switching: "switching_intent",
  recommendation: "recommendation_request",
  comparison: "comparison_intent",
  feature_requirement: "feature_requirement",
  jtbd: "problem_solution_search",
  objection: "vendor_evaluation",
  desired_outcome: "problem_solution_search",
  category_discovery: "recommendation_request",
};
const routePriorityWeight: Record<SourceRoutingRoute["priority"], number> = { very_high: 1, high: 0.9, medium: 0.75, low: 0.55, off: 0 };
const familySupportKey: Record<QueryFamily, keyof SourceRoutingCapabilityProfile> = {
  pain: "supports_problem_discussion",
  alternative_search: "supports_competitor_comparison",
  switching: "supports_switching_intent",
  recommendation: "supports_recommendation_intent",
  comparison: "supports_competitor_comparison",
  feature_requirement: "supports_feature_discussion",
  jtbd: "supports_problem_discussion",
  objection: "supports_problem_discussion",
  desired_outcome: "supports_problem_discussion",
  category_discovery: "supports_consumer_demand",
};

const sourceFamilyPolicy: Record<string, { allowed: QueryFamily[]; maxQueries?: number }> = {
  x: { allowed: ["switching", "alternative_search", "recommendation", "comparison", "pain", "feature_requirement"], maxQueries: 4 },
  reddit: { allowed: ["recommendation", "alternative_search", "switching", "pain", "comparison", "objection", "jtbd", "feature_requirement", "desired_outcome"] },
  github: { allowed: ["feature_requirement", "pain", "switching", "alternative_search", "comparison", "jtbd"], maxQueries: 4 },
  "hacker-news": { allowed: ["pain", "switching", "comparison", "recommendation", "alternative_search", "feature_requirement"], maxQueries: 2 },
  bluesky: { allowed: ["pain", "recommendation", "switching", "comparison", "category_discovery"], maxQueries: 2 },
  "product-hunt": { allowed: ["recommendation", "alternative_search", "comparison", "feature_requirement", "pain", "category_discovery"], maxQueries: 3 },
  "stack-exchange": { allowed: ["pain", "feature_requirement", "jtbd", "switching", "alternative_search", "comparison", "objection"], maxQueries: 4 },
  "public-web": { allowed: ["switching", "alternative_search", "recommendation", "comparison", "pain", "feature_requirement", "objection", "desired_outcome", "category_discovery"], maxQueries: 2 },
  g2: { allowed: ["alternative_search", "comparison", "recommendation", "feature_requirement", "pain", "objection"], maxQueries: 3 },
  trustpilot: { allowed: ["recommendation", "alternative_search", "comparison", "pain", "objection", "feature_requirement"], maxQueries: 2 },
  youtube: { allowed: ["alternative_search", "comparison", "switching", "recommendation", "pain", "feature_requirement", "objection"], maxQueries: 3 },
  gitlab: { allowed: ["feature_requirement", "pain", "switching", "alternative_search", "comparison", "jtbd", "objection"], maxQueries: 4 },
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const round = (value: number) => Math.round(clamp(value) * 1000) / 1000;

function clean(value: string | null | undefined, max = 100): string {
  return (value ?? "").replace(/\s+/g, " ").trim().replace(/["'`]/g, "").slice(0, max);
}

function normalizeQuery(value: string): string {
  return clean(value, 180).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

const categoryLabels: Record<string, string> = {
  productivity_software: "project management software",
  project_management_software: "project management software",
  software_development_tools: "software development tools",
  developer_tool: "developer tools",
  developer_tools: "developer tools",
  b2b_saas: "business software",
  consumer_software: "consumer software",
  ecommerce: "ecommerce software",
  service_business: "service business software",
  local_business: "local business software",
  media_content: "media software",
};

function humanizeCategory(value: string | null | undefined): string {
  const normalized = normalizeQuery(value ?? "");
  if (!normalized || ["unknown", "other", "product", "business"].includes(normalized)) return "";
  return categoryLabels[normalized.replaceAll(" ", "_")] ?? normalized;
}

function humanizeAudience(value: string | null | undefined): string {
  const normalized = normalizeQuery(value ?? "");
  if (!normalized || ["unknown", "other", "product", "business"].includes(normalized)) return "";
  const labels: Record<string, string> = {
    software_development_teams: "software development teams",
    product_manager: "product managers",
    engineering_manager: "engineering managers",
    team_lead: "team leads",
    software_engineer: "software engineers",
  };
  return labels[normalized.replaceAll(" ", "_")] ?? normalized;
}

function slug(value: string): string {
  return normalizeQuery(value).replace(/\s+/g, "-").slice(0, 90) || "query";
}

function priorityFor(score: number): SourceRoutingRoute["priority"] {
  return score >= 0.9 ? "very_high" : score >= 0.75 ? "high" : score >= 0.5 ? "medium" : score >= 0.25 ? "low" : "off";
}

function reasonSummary(family: QueryFamily, codes: QueryPlanReasonCode[]): string {
  const label = family.replaceAll("_", " ");
  const reasons = codes.map((code) => code.toLowerCase().replaceAll("_", " ")).join(", ");
  return `Generated from ${label} evidence${reasons ? `: ${reasons}` : "."}`;
}

function profileConfidence(input: QueryPlanningInput): number {
  return input.demandProfile?.profile_confidence ?? input.classification?.overall_confidence ?? 0.4;
}

function technicalProfile(input: Pick<QueryPlanningInput, "classification" | "demandProfile">): boolean {
  const profile = input.demandProfile;
  const classification = input.classification;
  const labels = [...(profile?.target_customer_types ?? []), ...(profile?.buyer_roles ?? []), ...(profile?.end_user_types ?? [])].join(" ").toLowerCase();
  return classification?.business_type === "developer_tool"
    || classification?.technical_orientation === "high"
    || classification?.technical_orientation === "medium"
    || Boolean(profile && /developer|engineer|technical|api|software|integration|sdk/.test(labels));
}

function categoryAndAudience(input: QueryPlanningInput): { category: string; audience: string } {
  const profile = input.demandProfile;
  const classification = input.classification;
  const usable = (value: string | null | undefined) => value && !["unknown", "other", "product", "business"].includes(value.trim().toLowerCase()) ? value : undefined;
  const category = humanizeCategory(usable(profile?.primary_category) ?? usable(classification?.primary_category)) || "software";
  const audience = [...(profile?.target_customer_types ?? []), ...(profile?.buyer_roles ?? []), ...(classification?.target_customer_types ?? [])].map((value) => humanizeAudience(usable(value))).find(Boolean) ?? "teams";
  return {
    category: clean(category, 80) || "product",
    audience: clean(audience, 70) || "teams",
  };
}

function geoContext(input: QueryPlanningInput): string | null {
  const profile = input.demandProfile;
  const classification = input.classification;
  const dependency = classification?.location_dependency ?? profile?.location_dependency ?? 0;
  const scope = classification?.market_scope ?? profile?.market_scope ?? "unknown";
  if (scope !== "local" && dependency < 0.8) return null;
  const geography = profile?.geography;
  const place = [geography?.primary_city, geography?.primary_region, geography?.primary_country_code].filter(Boolean).join(", ");
  return clean(place || "near me", 100);
}

function intentRelevance(profile: DemandProfileV2RoutingModel | null, intentType: QueryPlanQuery["intent_type"]): number {
  const matching = profile?.buying_intents.filter((intent) => intent.intent_type === intentType).map((intent) => intent.relevance) ?? [];
  if (matching.length) return Math.max(...matching);
  return intentType === "recommendation_request" ? 0.45 : intentType === "problem_solution_search" ? 0.4 : 0.35;
}

function addGeo(text: string, context: CandidateContext): string {
  if (!context.geoContext || context.route.source_key === "hacker-news" || context.route.source_key === "github") return text;
  if (context.geoContext === "near me") return clean(`${text} near me`, 180);
  return clean(`${text} ${context.geoContext}`, 180);
}

function makeCandidate(input: {
  family: QueryFamily;
  text: string;
  context: CandidateContext;
  conceptKeys?: string[];
  competitorRefs?: string[];
  alternativeRefs?: string[];
  confidence: number;
  reasonCodes: QueryPlanReasonCode[];
  competitorSpecific?: boolean;
  demandSurface?: QueryPlanQuery["demand_surface"];
}): Candidate {
  const text = addGeo(clean(input.text), input.context);
  const profile = input.context.profile;
  const capability = sourceRoutingCapabilityProfiles[input.context.route.source_key] ?? sourceRoutingCapabilityProfiles.fixture;
  const support = Number(capability[familySupportKey[input.family]] ?? 0.3);
  const intent = intentRelevance(profile, intentForFamily[input.family]);
  const score = round(commercialWeight[input.family] * 0.34 + input.confidence * 0.27 + intent * 0.16 + support * 0.13 + routePriorityWeight[input.context.route.priority] * 0.1);
  const codes = [...input.reasonCodes];
  if (support >= 0.75) codes.push("SOURCE_STRONG_FOR_INTENT");
  if (input.context.lowConfidence) codes.push("LOW_PROFILE_CONFIDENCE");
  return {
    query_family: input.family,
    demand_surface: input.demandSurface ?? surfaceForFamily[input.family],
    intent_type: intentForFamily[input.family],
    query_text: text,
    source_key: input.context.route.source_key,
    confidence: round(input.confidence * (input.context.lowConfidence ? 0.85 : 1)),
    reason_codes: [...new Set(codes)],
    concept_keys: [...new Set(input.conceptKeys ?? [])],
    competitor_refs: [...new Set(input.competitorRefs ?? [])],
    alternative_refs: [...new Set(input.alternativeRefs ?? [])],
    geo_context: input.context.geoContext,
    language_context: null,
    cost_hint: input.context.route.cost_class,
    score,
    conceptConfidence: input.confidence,
    competitorSpecific: input.competitorSpecific ?? false,
    semanticKey: `${input.family}:${normalizeQuery(text)}`,
  };
}

function topPains(profile: DemandProfileV2RoutingModel | null) {
  return [...(profile?.pains ?? [])].sort((a, b) => (b.confidence * (b.specificity + (b.severity_hint ?? 0.5))) - (a.confidence * (a.specificity + (a.severity_hint ?? 0.5))) || a.key.localeCompare(b.key)).slice(0, 3);
}

function topItems<T extends { confidence: number; key?: string }>(items: T[] | undefined): T[] {
  return [...(items ?? [])].sort((a, b) => b.confidence - a.confidence || (a.key ?? "").localeCompare(b.key ?? "")).slice(0, 3);
}

function competitorNames(profile: DemandProfileV2RoutingModel | null): string[] {
  const known = topItems(profile?.known_competitors).map((item) => clean(item.name, 70));
  const alternativeProducts = topItems(profile?.alternative_solutions)
    .filter((item) => item.alternative_type === "competitor_product")
    .map((item) => clean(item.label, 70));
  return [...new Set([...known, ...alternativeProducts].filter(Boolean))];
}

export function competitorReferencesForText(profile: DemandProfileV2RoutingModel | null, text: string): string[] {
  const normalized = normalizeQuery(text);
  const competitors = [
    ...(profile?.known_competitors ?? []).map((competitor) => ({ key: competitor.key, name: competitor.name })),
    ...(profile?.alternative_solutions ?? []).filter((alternative) => alternative.alternative_type === "competitor_product").map((alternative) => ({ key: alternative.key, name: alternative.label })),
  ];
  return competitors
    .filter((competitor) => {
      const name = normalizeQuery(competitor.name);
      return name.length > 1 && (` ${normalized} `).includes(` ${name} `);
    })
    .map((competitor) => competitor.key)
    .filter((key, index, values) => values.indexOf(key) === index);
}

function preferredFamilies(profile: DemandProfileV2RoutingModel | null): Set<QueryFamily> {
  const result = new Set<QueryFamily>();
  for (const intent of profile?.buying_intents ?? []) {
    if (intent.relevance < 0.35) continue;
    if (intent.intent_type === "switching_intent" || intent.intent_type === "renewal_reconsideration") result.add("switching");
    if (intent.intent_type === "alternative_search") result.add("alternative_search");
    if (intent.intent_type === "recommendation_request") result.add("recommendation");
    if (intent.intent_type === "comparison_intent" || intent.intent_type === "vendor_evaluation") result.add("comparison");
    if (intent.intent_type === "feature_requirement") result.add("feature_requirement");
    if (intent.intent_type === "problem_solution_search") result.add("pain");
  }
  return result;
}

function buildCandidates(context: CandidateContext): Candidate[] {
  const profile = context.profile;
  const candidates: Candidate[] = [];
  const add = (candidate: Candidate) => candidates.push(candidate);
  const intents = preferredFamilies(profile);
  const category = context.category;
  const audience = context.audience;
  const technical = technicalProfile({ classification: context.classification, demandProfile: profile });
  const policy = sourceFamilyPolicy[context.route.source_key] ?? { allowed: familyOrder };
  const allowed = (family: QueryFamily) => policy.allowed.includes(family);
  const familyIntent = (family: QueryFamily) => intents.has(family) ? 0.95 : 0.55;

  for (const competitor of topItems(profile?.known_competitors)) {
    const name = clean(competitor.name, 70);
    if (!name || context.lowConfidence) continue;
    if (allowed("alternative_search")) add(makeCandidate({ family: "alternative_search", text: `${name} alternative`, context, conceptKeys: [competitor.key], competitorRefs: [competitor.key], confidence: competitor.confidence * familyIntent("alternative_search"), reasonCodes: ["HIGH_ALTERNATIVE_RELEVANCE", "KNOWN_COMPETITOR"], competitorSpecific: true }));
    if (allowed("switching")) add(makeCandidate({ family: "switching", text: `switching from ${name}`, context, conceptKeys: [competitor.key], competitorRefs: [competitor.key], confidence: competitor.confidence * familyIntent("switching"), reasonCodes: ["HIGH_SWITCHING_RELEVANCE", "KNOWN_COMPETITOR"], competitorSpecific: true }));
    if (allowed("comparison")) add(makeCandidate({ family: "comparison", text: `${profile?.product_name ?? category} vs ${name}`, context, conceptKeys: [competitor.key], competitorRefs: [competitor.key], confidence: competitor.confidence * familyIntent("comparison"), reasonCodes: ["COMPARISON_INTENT", "KNOWN_COMPETITOR"], competitorSpecific: true }));
  }
  for (const competitor of topItems(profile?.detected_competitor_candidates).filter((item) => item.confidence >= 0.8)) {
    if (context.lowConfidence) continue;
    const name = clean(competitor.name, 70);
    if (allowed("alternative_search")) add(makeCandidate({ family: "alternative_search", text: `${name} alternative`, context, conceptKeys: [competitor.key], competitorRefs: [competitor.key], confidence: competitor.confidence * 0.9, reasonCodes: ["HIGH_ALTERNATIVE_RELEVANCE", "DETECTED_COMPETITOR_CONFIDENCE"], competitorSpecific: true }));
  }
  for (const term of topItems(profile?.comparison_terms)) {
    if (!allowed("comparison")) continue;
    const text = clean(term.term, 90);
    const competitorRefs = competitorReferencesForText(profile, text);
    add(makeCandidate({ family: "comparison", text, context, conceptKeys: [term.key, ...competitorRefs], competitorRefs, confidence: term.confidence, reasonCodes: ["COMPARISON_INTENT"], competitorSpecific: competitorRefs.length > 0 }));
  }
  for (const pain of topPains(profile)) {
    const phrase = clean(pain.label, 80);
    if (allowed("pain")) add(makeCandidate({ family: "pain", text: `${category} ${phrase}`, context, conceptKeys: ["category", pain.key], confidence: pain.confidence * pain.specificity, reasonCodes: ["HIGH_CONFIDENCE_PAIN"] }));
    if (allowed("pain")) add(makeCandidate({ family: "pain", text: `struggling with ${category} ${phrase}`, context, conceptKeys: ["category", pain.key], confidence: pain.confidence * 0.95, reasonCodes: ["HIGH_CONFIDENCE_PAIN"] }));
    if (allowed("pain")) add(makeCandidate({ family: "pain", text: `problem with ${category} ${phrase}`, context, conceptKeys: [pain.key], confidence: pain.confidence * 0.9, reasonCodes: ["HIGH_CONFIDENCE_PAIN"] }));
  }
  for (const trigger of topItems(profile?.switching_triggers)) {
    if (!allowed("switching")) continue;
    const switchingAnchor = competitorNames(profile)[0] ?? profile?.product_name ?? category;
    add(makeCandidate({ family: "switching", text: `switching from ${clean(switchingAnchor, 70)}`, context, conceptKeys: [trigger.key], confidence: trigger.confidence * familyIntent("switching"), reasonCodes: ["HIGH_SWITCHING_RELEVANCE"] }));
  }
  for (const feature of topItems(profile?.feature_demands)) {
    if (!allowed("feature_requirement")) continue;
    const value = clean(feature.feature, 70);
    add(makeCandidate({ family: "feature_requirement", text: `need ${category} with ${value}`, context, conceptKeys: [feature.key], confidence: feature.confidence * feature.importance_hint, reasonCodes: ["FEATURE_REQUIREMENT_MATCH"] }));
    add(makeCandidate({ family: "feature_requirement", text: `${category} that supports ${value}`, context, conceptKeys: [feature.key], confidence: feature.confidence * 0.95, reasonCodes: ["FEATURE_REQUIREMENT_MATCH"] }));
  }
  for (const job of topItems(profile?.jobs_to_be_done)) {
    if (!allowed("jtbd")) continue;
    add(makeCandidate({ family: "jtbd", text: `need ${category} to ${clean(job.desired_result, 80)}`, context, conceptKeys: ["category", job.key], confidence: job.confidence, reasonCodes: ["JTBD_MATCH"] }));
    add(makeCandidate({ family: "jtbd", text: `${category} tool to ${clean(job.job, 90)}`, context, conceptKeys: ["category", job.key], confidence: job.confidence * 0.95, reasonCodes: ["JTBD_MATCH"] }));
  }
  for (const objection of topItems(profile?.objections)) {
    if (!allowed("objection")) continue;
    add(makeCandidate({ family: "objection", text: `${category} too ${clean(objection.objection, 70)}`, context, conceptKeys: [objection.key], confidence: objection.confidence, reasonCodes: ["OBJECTION_MATCH"] }));
  }
  for (const outcome of topItems(profile?.desired_outcomes)) {
    if (!allowed("desired_outcome")) continue;
    add(makeCandidate({ family: "desired_outcome", text: `how to ${clean(outcome.label, 80)}`, context, conceptKeys: [outcome.key], confidence: outcome.confidence, reasonCodes: ["DESIRED_OUTCOME_MATCH"] }));
    add(makeCandidate({ family: "desired_outcome", text: `tool to ${clean(outcome.label, 80)}`, context, conceptKeys: [outcome.key], confidence: outcome.confidence * 0.9, reasonCodes: ["DESIRED_OUTCOME_MATCH"] }));
  }
  for (const alternative of topItems(profile?.alternative_solutions)) {
    if (!allowed("alternative_search") || context.lowConfidence) continue;
    const label = clean(alternative.label, 70);
    const text = alternative.alternative_type === "internal_build"
      ? `build vs buy ${category}`
      : alternative.alternative_type === "manual_process" || alternative.alternative_type === "status_quo"
        ? `replace ${label} with ${category}`
        : alternative.alternative_type === "service_provider"
          ? `${category} service provider versus software`
          : alternative.alternative_type === "generic_tool"
            ? `${label} versus ${category}`
            : `${label} alternative`;
    const demandSurface = alternative.alternative_type === "competitor_product" ? "alternative_search" : "substitute_displacement";
    const competitorRefs = alternative.alternative_type === "competitor_product" ? competitorReferencesForText(profile, label) : [];
    add(makeCandidate({ family: "alternative_search", text, context, conceptKeys: [alternative.key, ...competitorRefs], competitorRefs, alternativeRefs: [alternative.key], confidence: alternative.confidence, reasonCodes: ["ALTERNATIVE_SOLUTION_MATCH"], demandSurface, competitorSpecific: alternative.alternative_type === "competitor_product" || competitorRefs.length > 0 }));
  }
  if (allowed("recommendation")) {
    add(makeCandidate({ family: "recommendation", text: `best ${category} for ${audience}`, context, conceptKeys: ["category", "audience"], confidence: familyIntent("recommendation"), reasonCodes: ["RECOMMENDATION_INTENT"] }));
    add(makeCandidate({ family: "recommendation", text: `recommend ${category}`, context, conceptKeys: ["category"], confidence: familyIntent("recommendation") * 0.95, reasonCodes: ["RECOMMENDATION_INTENT"] }));
  }
  if (allowed("category_discovery")) add(makeCandidate({ family: "category_discovery", text: `looking for ${category}`, context, conceptKeys: ["category"], confidence: 0.45, reasonCodes: ["CATEGORY_FALLBACK"] }));

  if (!technical && context.route.source_key === "github") return candidates.filter((candidate) => candidate.query_family === "feature_requirement" || candidate.query_family === "pain" || candidate.query_family === "jtbd");
  return candidates;
}

function tokenSimilarity(left: string, right: string): number {
  const a = new Set(normalizeQuery(left).split(" ").filter(Boolean));
  const b = new Set(normalizeQuery(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

function selectDiverse(candidates: Candidate[], maxQueries: number): { selected: Candidate[]; suppressed: number } {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.query_family.localeCompare(b.query_family) || a.semanticKey.localeCompare(b.semanticKey));
  const unique: Candidate[] = [];
  let suppressed = 0;
  for (const candidate of sorted) {
    const duplicate = unique.some((existing) => existing.query_family === candidate.query_family && (existing.semanticKey === candidate.semanticKey || tokenSimilarity(existing.query_text, candidate.query_text) >= 0.8));
    if (duplicate) {
      const existing = unique.find((item) => item.query_family === candidate.query_family && (item.semanticKey === candidate.semanticKey || tokenSimilarity(item.query_text, candidate.query_text) >= 0.8));
      if (existing && candidate.competitorSpecific && !existing.competitorSpecific && normalizeQuery(existing.query_text) === normalizeQuery(candidate.query_text)) {
        existing.competitorSpecific = true;
        existing.competitor_refs = [...new Set([...existing.competitor_refs, ...candidate.competitor_refs])].sort();
        existing.concept_keys = [...new Set([...existing.concept_keys, ...candidate.concept_keys])].sort();
      }
      suppressed += 1;
      continue;
    }
    unique.push(candidate);
  }
  const selected: Candidate[] = [];
  const remaining = [...unique];
  const hasNonCompetitorCandidate = remaining.some(isNonCompetitorSurface);
  while (selected.length < maxQueries && remaining.length) {
    const competitorSurfaceCount = selected.filter((item) => !isNonCompetitorSurface(item)).length;
    const eligible = remaining.filter((item) => !(competitorSurfaceCount >= 2 && hasNonCompetitorCandidate && !isNonCompetitorSurface(item)));
    if (!eligible.length) break;
    const unseenSurface = eligible.filter((item) => !selected.some((chosen) => chosen.demand_surface === item.demand_surface));
    const next = (unseenSurface.length ? unseenSurface : eligible)[0];
    const index = remaining.indexOf(next);
    selected.push(remaining.splice(Math.max(0, index), 1)[0]);
  }
  return { selected, suppressed: suppressed + Math.max(0, unique.length - selected.length) };
}

function queryCountCap(mode: SourceRoutingScanMode): number {
  return mode === "onboarding" || mode === "baseline" ? 3 : mode === "manual" || mode === "manual_refresh" || mode === "manual_deep" ? 12 : mode === "scheduled" || mode === "monitoring" || mode === "intelligence_cycle" ? 4 : 8;
}

function allocateQueryBudgets(candidates: Candidate[], budget: number): number[] {
  if (!candidates.length || budget <= 0) return [];
  const count = Math.min(candidates.length, Math.floor(budget));
  const base = Math.floor(budget / count);
  const remainder = Math.floor(budget) - base * count;
  return candidates.map((_, index) => base + (index < remainder ? 1 : 0));
}

function buildSourcePlan(input: QueryPlanningInput, route: SourceRoutingRoute): { plan: QueryPlanSource; suppressed: number } {
  const confidence = profileConfidence(input);
  const lowConfidence = confidence < 0.55;
  const { category, audience } = categoryAndAudience(input);
  const context: CandidateContext = { classification: input.classification, profile: input.demandProfile, route, lowConfidence, category, audience, geoContext: geoContext(input) };
  let candidates = buildCandidates(context);
  if (lowConfidence) candidates = candidates.filter((candidate) => !candidate.competitorSpecific && ["pain", "recommendation", "category_discovery", "jtbd", "desired_outcome"].includes(candidate.query_family));
  const policy = sourceFamilyPolicy[route.source_key] ?? { allowed: familyOrder };
  const excludedQueryFamilies = familyOrder.filter((family) => !policy.allowed.includes(family));
  const paidSourceQueryCap = route.cost_class === "paid_medium" ? (input.scanMode === "manual" || input.scanMode === "manual_refresh" || input.scanMode === "manual_deep" ? 4 : 1) : Number.MAX_SAFE_INTEGER;
  const onboardingSourceQueryCap = (input.scanMode === "onboarding" || input.scanMode === "baseline") && route.source_key === "hacker-news" ? 1 : Number.MAX_SAFE_INTEGER;
  const maxQueries = Math.min(queryCountCap(input.scanMode), policy.maxQueries ?? Number.MAX_SAFE_INTEGER, Math.max(1, Math.floor(route.max_candidates)), paidSourceQueryCap, onboardingSourceQueryCap, lowConfidence ? 2 : Number.MAX_SAFE_INTEGER);
  const diverse = selectDiverse(candidates, maxQueries);
  const budgets = allocateQueryBudgets(diverse.selected, route.max_candidates);
  const queries = diverse.selected.map((candidate, index) => {
    const normalized = normalizeQuery(candidate.query_text);
    return {
      query_id: `qp-${route.source_key}-${slug(candidate.query_family)}-${slug(normalized)}`,
      query_family: candidate.query_family,
      demand_surface: candidate.demand_surface,
      competitor_specific: candidate.competitorSpecific,
      intent_type: candidate.intent_type,
      query_text: candidate.query_text,
      normalized_query: normalized,
      source_key: route.source_key,
      priority: priorityFor(candidate.score),
      confidence: candidate.confidence,
      candidate_budget: budgets[index] ?? 0,
      reason_codes: candidate.reason_codes,
      reason_summary: reasonSummary(candidate.query_family, candidate.reason_codes),
      concept_keys: candidate.concept_keys,
      competitor_refs: candidate.competitor_refs,
      alternative_refs: candidate.alternative_refs,
      geo_context: candidate.geo_context,
      language_context: candidate.language_context,
      cost_hint: candidate.cost_hint,
      metadata: {
        planner_version: queryPlanningVersion,
        discovery_intent: { surface: candidate.demand_surface, query_family: candidate.query_family, concept_keys: candidate.concept_keys, competitor_specific: candidate.competitorSpecific },
        semantic_query: candidate.query_text,
        provider_context: {
          product_name: input.demandProfile?.product_name ?? null,
          category,
          audience,
          competitors: competitorNames(input.demandProfile),
          alternatives: topItems(input.demandProfile?.alternative_solutions).map((item) => clean(item.label, 70)),
          competitor_targets: topItems(input.demandProfile?.known_competitors).map((item) => ({ key: item.key, kind: "competitor", name: clean(item.name, 70), domain: item.domain })),
          alternative_targets: topItems(input.demandProfile?.alternative_solutions).map((item) => ({ key: item.key, kind: "alternative", name: clean(item.label, 70) })),
          pains: topPains(input.demandProfile).map((item) => clean(item.label, 70)),
          switching_triggers: topItems(input.demandProfile?.switching_triggers).map((item) => clean(item.trigger, 70)),
          comparison_terms: topItems(input.demandProfile?.comparison_terms).map((item) => clean(item.term, 70)),
          feature_terms: topItems(input.demandProfile?.feature_demands).map((item) => clean(item.feature, 70)),
        },
        route_relevance: route.relevance_score,
        source_capability_fit: Number((sourceRoutingCapabilityProfiles[route.source_key] ?? sourceRoutingCapabilityProfiles.fixture)[familySupportKey[candidate.query_family]] ?? 0),
      },
    } satisfies QueryPlanQuery;
  });
  const sourceReasonCodes: QueryPlanReasonCode[] = [];
  if (lowConfidence) sourceReasonCodes.push("LOW_PROFILE_CONFIDENCE");
  if (route.cost_class === "paid_medium") sourceReasonCodes.push("BUDGET_CONSTRAINED");
  if (diverse.suppressed || diverse.selected.length < candidates.length) sourceReasonCodes.push("DUPLICATE_SUPPRESSED");
  if (input.demandProfile?.location_dependency && input.demandProfile.location_dependency >= 0.8) sourceReasonCodes.push("GEO_DEPENDENT");
  if (queries.some((query) => query.reason_codes.includes("SOURCE_STRONG_FOR_INTENT"))) sourceReasonCodes.push("SOURCE_STRONG_FOR_INTENT");
  const sourceConfidence = queries.length ? round(queries.reduce((sum, query) => sum + query.confidence, 0) / queries.length) : round(confidence * 0.7);
  return {
    plan: {
      source_key: route.source_key,
      priority: route.priority,
      candidate_budget: route.max_candidates,
      query_budget: queries.length,
      queries,
      excluded_query_families: excludedQueryFamilies,
      reason_codes: [...new Set(sourceReasonCodes)],
      confidence: sourceConfidence,
    },
    suppressed: diverse.suppressed,
  };
}

function applyGlobalQueryCap(sourcePlans: QueryPlanSource[], maxQueries: number | undefined): QueryPlanSource[] {
  if (maxQueries === undefined) return sourcePlans;
  const ranked = sourcePlans
    .flatMap((source) => source.queries.map((query) => ({ sourceKey: source.source_key, query })))
    .sort((a, b) => b.query.confidence - a.query.confidence || a.sourceKey.localeCompare(b.sourceKey) || a.query.query_id.localeCompare(b.query.query_id));
  const selected: typeof ranked = [];
  const cap = Math.max(0, Math.floor(maxQueries));
  const hasNonCompetitorCandidate = ranked.some((item) => isNonCompetitorSurface(item.query));
  while (selected.length < cap && ranked.length) {
    const competitorSurfaceCount = selected.filter((item) => !isNonCompetitorSurface(item.query)).length;
    const unusedSurface = ranked.filter((item) => !selected.some((chosen) => chosen.query.demand_surface === item.query.demand_surface));
    const eligible = unusedSurface.filter((item) => !(competitorSurfaceCount >= 2 && hasNonCompetitorCandidate && !isNonCompetitorSurface(item.query)));
    const fallback = ranked.filter((item) => !(competitorSurfaceCount >= 2 && hasNonCompetitorCandidate && !isNonCompetitorSurface(item.query)));
    const pool = eligible.length ? eligible : fallback;
    if (!pool.length) break;
    const sourceDiverse = pool.filter((item) => !selected.some((chosen) => chosen.sourceKey === item.sourceKey) && item.query.priority !== "low" && item.query.priority !== "off");
    const next = (sourceDiverse.length ? sourceDiverse : pool)[0];
    selected.push(next);
    ranked.splice(ranked.indexOf(next), 1);
  }
  const selectedIds = new Set(selected.map((item) => item.query.query_id));
  return sourcePlans.map((source) => {
    const queries = source.queries.filter((query) => selectedIds.has(query.query_id));
    return { ...source, queries, query_budget: queries.length };
  });
}

export function buildQueryPlan(input: QueryPlanningInput): QueryPlan {
  const routes = selectExecutableSourceRoutes(input.sourceRoutingPlan);
  const built = routes.map((route) => buildSourcePlan(input, route));
  const sourcePlans = applyGlobalQueryCap(built.map((result) => result.plan), input.maxQueries);
  const queries = sourcePlans.flatMap((source) => source.queries);
  const familyDistribution: Record<string, number> = {};
  const surfaceCoverage: Record<string, "covered" | "uncovered"> = {};
  const queriesPerSource: Record<string, number> = {};
  const budgetPerSource: Record<string, number> = {};
  for (const source of sourcePlans) {
    queriesPerSource[source.source_key] = source.queries.length;
    budgetPerSource[source.source_key] = source.queries.reduce((sum, query) => sum + query.candidate_budget, 0);
    for (const query of source.queries) familyDistribution[query.query_family] = (familyDistribution[query.query_family] ?? 0) + 1;
    for (const query of source.queries) surfaceCoverage[query.demand_surface] = "covered";
  }
  const lowConfidence = profileConfidence(input) < 0.55;
  const diagnostics: QueryPlanDiagnostics = {
    source_count: sourcePlans.filter((source) => source.queries.length > 0).length,
    query_count: queries.length,
    query_family_distribution: familyDistribution,
    demand_surface_coverage: Object.fromEntries(Object.entries(surfaceCoverage).sort(([left], [right]) => left.localeCompare(right))),
    queries_per_source: queriesPerSource,
    candidate_budget_per_source: budgetPerSource,
    suppressed_duplicate_count: built.reduce((sum, result) => sum + result.suppressed, 0),
    low_confidence: lowConfidence,
    messages: [
      ...(lowConfidence ? ["Low-confidence product understanding reduced query count and removed competitor-specific exploration."] : []),
      ...(queries.length ? [`Generated ${queries.length} bounded semantic quer${queries.length === 1 ? "y" : "ies"} across ${sourcePlans.length} source${sourcePlans.length === 1 ? "" : "s"}.`] : ["No semantic query met the current profile and source constraints."]),
    ],
  };
  const overallConfidence = queries.length ? round(queries.reduce((sum, query) => sum + query.confidence, 0) / queries.length * (lowConfidence ? 0.8 : 1)) : round(profileConfidence(input) * 0.7);
  return {
    version: queryPlanningVersion,
    product_id: input.sourceRoutingPlan.product_id,
    demand_profile_version: input.sourceRoutingPlan.demand_profile_version,
    source_routing_version: input.sourceRoutingPlan.version,
    scan_mode: input.scanMode,
    overall_confidence: overallConfidence,
    source_plans: sourcePlans,
    diagnostics,
  };
}

export function formatQueryPlanDryRun(plan: QueryPlan): string {
  const lines = [`${plan.version} product=${plan.product_id} mode=${plan.scan_mode} confidence=${plan.overall_confidence}`];
  for (const source of plan.source_plans) {
    lines.push(`${source.source_key}: candidateBudget=${source.candidate_budget} queryBudget=${source.query_budget} priority=${source.priority}`);
    for (const query of source.queries) lines.push(`  ${query.query_family} [${query.priority}/${query.confidence}] ${query.query_text} candidates=${query.candidate_budget} reasons=${query.reason_codes.join(",")}`);
  }
  lines.push(`suppressedDuplicates=${plan.diagnostics.suppressed_duplicate_count}`);
  return lines.join("\n");
}

export type { DemandProfileV2RoutingModel, BusinessClassification };
