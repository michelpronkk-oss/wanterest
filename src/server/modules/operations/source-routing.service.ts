import type { BusinessClassification } from "../intelligence/business-classification.schemas";
import type { DemandProfileV2RoutingModel } from "../intelligence/demand-profile-v2.service";
import { sourceRoutingCapabilityProfiles, sourceRoutingSourceKeys } from "./source-routing.profiles";
import type {
  SourceRoutingAvailabilityStatus,
  SourceRoutingCapabilityProfile,
  SourceRoutingExcludedSource,
  SourceRoutingHealthStatus,
  SourceRoutingInput,
  SourceRoutingPriority,
  SourceRoutingReasonCode,
  SourceRoutingRoute,
  SourceRoutingScanMode,
  SourceRoutingSourceState,
  SourceRoutingPlan,
} from "./source-routing.schemas";
import { sourceRoutingVersion } from "./source-routing.schemas";

const priorityFor = (score: number): SourceRoutingPriority => score >= 0.9 ? "very_high" : score >= 0.75 ? "high" : score >= 0.5 ? "medium" : score >= 0.25 ? "low" : "off";
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value: number) => Math.round(clamp(value) * 1000) / 1000;

const businessTypeBase: Record<string, Record<string, number>> = {
  b2b_saas: { "hacker-news": 0.68, github: 0.58, gitlab: 0.5, reddit: 0.84, x: 0.72, bluesky: 0.45, "stack-exchange": 0.42, "product-hunt": 0.5, g2: 0.62, trustpilot: 0.42, youtube: 0.58, "public-web": 0.3 },
  developer_tool: { "hacker-news": 0.88, github: 0.94, gitlab: 0.9, reddit: 0.78, x: 0.74, bluesky: 0.38, "stack-exchange": 0.88, "product-hunt": 0.4, g2: 0.48, trustpilot: 0.2, youtube: 0.62, "public-web": 0.28 },
  consumer_software: { "hacker-news": 0.2, github: 0.12, gitlab: 0.08, reddit: 0.86, x: 0.82, bluesky: 0.55, "stack-exchange": 0.12, "product-hunt": 0.7, g2: 0.22, trustpilot: 0.68, youtube: 0.78, "public-web": 0.32 },
  ecommerce: { "hacker-news": 0.1, github: 0.05, gitlab: 0.03, reddit: 0.9, x: 0.82, bluesky: 0.45, "stack-exchange": 0.08, "product-hunt": 0.48, g2: 0.18, trustpilot: 0.82, youtube: 0.65, "public-web": 0.35 },
  marketplace: { "hacker-news": 0.45, github: 0.3, gitlab: 0.22, reddit: 0.88, x: 0.84, bluesky: 0.5, "stack-exchange": 0.15, "product-hunt": 0.55, g2: 0.3, trustpilot: 0.7, youtube: 0.68, "public-web": 0.38 },
  service_business: { "hacker-news": 0.1, github: 0.03, gitlab: 0.02, reddit: 0.62, x: 0.68, bluesky: 0.38, "stack-exchange": 0.08, "product-hunt": 0.28, g2: 0.12, trustpilot: 0.72, youtube: 0.62, "public-web": 0.35 },
  local_business: { "hacker-news": 0.03, github: 0.02, gitlab: 0.01, reddit: 0.55, x: 0.48, bluesky: 0.28, "stack-exchange": 0.03, "product-hunt": 0.18, g2: 0.08, trustpilot: 0.78, youtube: 0.55, "public-web": 0.45 },
  agency: { "hacker-news": 0.42, github: 0.2, gitlab: 0.16, reddit: 0.68, x: 0.82, bluesky: 0.5, "stack-exchange": 0.22, "product-hunt": 0.5, g2: 0.38, trustpilot: 0.5, youtube: 0.62, "public-web": 0.35 },
  media_content: { "hacker-news": 0.2, github: 0.02, gitlab: 0.01, reddit: 0.74, x: 0.9, bluesky: 0.72, "stack-exchange": 0.05, "product-hunt": 0.48, g2: 0.08, trustpilot: 0.4, youtube: 0.9, "public-web": 0.4 },
  other: { "hacker-news": 0.25, github: 0.2, gitlab: 0.16, reddit: 0.55, x: 0.55, bluesky: 0.35, "stack-exchange": 0.18, "product-hunt": 0.35, g2: 0.2, trustpilot: 0.35, youtube: 0.55, "public-web": 0.3 },
};

const costFactor: Record<SourceRoutingCapabilityProfile["cost_class"], number> = {
  free_low: 1,
  free_rate_limited: 0.9,
  paid_low: 0.75,
  paid_medium: 0.55,
  paid_high: 0.35,
};

function hasStructuredTerm(values: string[], terms: string[]): boolean {
  return values.some((value) => terms.some((term) => value.toLowerCase().includes(term)));
}

function effectiveIdentity(input: SourceRoutingInput): { businessType: string; businessModel: string; deliveryModel: string; technicalOrientation: string; marketScope: string; locationDependency: number; profileConfidence: number } {
  return {
    businessType: input.classification?.business_type ?? input.demandProfile?.business_type ?? "other",
    businessModel: input.classification?.business_model ?? input.demandProfile?.business_model ?? "unknown",
    deliveryModel: input.classification?.delivery_model ?? input.demandProfile?.delivery_model ?? "unknown",
    technicalOrientation: input.classification?.technical_orientation ?? input.demandProfile?.technical_orientation ?? "unknown",
    marketScope: input.classification?.market_scope ?? input.demandProfile?.market_scope ?? "unknown",
    locationDependency: input.classification?.location_dependency ?? input.demandProfile?.location_dependency ?? 0,
    profileConfidence: input.demandProfile
      ? Math.min(input.classification?.overall_confidence ?? 0.5, input.demandProfile.profile_confidence)
      : Math.min(input.classification?.overall_confidence ?? 0.5, 0.4),
  };
}

function initialScore(sourceKey: string, identity: ReturnType<typeof effectiveIdentity>, input: SourceRoutingInput): number {
  let score = businessTypeBase[identity.businessType]?.[sourceKey] ?? 0.25;
  const capability = sourceRoutingCapabilityProfiles[sourceKey];
  if (capability) {
    if (identity.deliveryModel === "software") score += capability.supports_software_demand * 0.04;
    if (identity.businessModel === "b2c" || identity.businessType === "consumer_software") score += capability.supports_consumer_demand * 0.03;
    if (identity.businessType === "ecommerce" || identity.deliveryModel === "physical_product") score += capability.supports_ecommerce_demand * 0.03;
    if (identity.locationDependency >= 0.8) score += capability.supports_local_demand * 0.02;
  }
  if (identity.deliveryModel === "software") {
    if (sourceKey === "github") score += 0.08;
    if (sourceKey === "hacker-news") score += 0.05;
    if (sourceKey === "stack-exchange") score += 0.05;
    if (sourceKey === "g2") score += 0.04;
    if (sourceKey === "youtube") score += 0.03;
  }
  if (identity.deliveryModel === "physical_product") {
    if (sourceKey === "reddit" || sourceKey === "x") score += 0.08;
    if (sourceKey === "hacker-news" || sourceKey === "github") score -= 0.08;
    if (sourceKey === "trustpilot") score += 0.08;
  }
  if (identity.technicalOrientation === "high") {
    if (sourceKey === "github") score += 0.2;
    if (sourceKey === "hacker-news") score += 0.15;
    if (sourceKey === "stack-exchange") score += 0.18;
  } else if (identity.technicalOrientation === "medium") {
    if (sourceKey === "github") score += 0.1;
    if (sourceKey === "hacker-news") score += 0.05;
    if (sourceKey === "stack-exchange") score += 0.08;
  } else if (identity.technicalOrientation === "low") {
    if (sourceKey === "github") score -= 0.12;
    if (sourceKey === "hacker-news") score -= 0.06;
    if (sourceKey === "stack-exchange") score -= 0.12;
  }

  const profile = input.demandProfile;
  const technicalAudience = Boolean(profile && hasStructuredTerm([...profile.target_customer_types, ...profile.buyer_roles, ...profile.end_user_types], ["developer", "engineer", "technical", "api", "software"]));
  const consumerAudience = identity.businessType === "consumer_software" || identity.businessModel === "b2c" || Boolean(profile && hasStructuredTerm([...profile.target_customer_types, ...profile.end_user_types], ["consumer", "individual", "household"]));
  if (technicalAudience && (sourceKey === "github" || sourceKey === "gitlab" || sourceKey === "hacker-news" || sourceKey === "stack-exchange")) score += sourceKey === "github" || sourceKey === "gitlab" ? 0.08 : sourceKey === "stack-exchange" ? 0.08 : 0.05;
  if (consumerAudience && (sourceKey === "reddit" || sourceKey === "x" || sourceKey === "product-hunt" || sourceKey === "trustpilot" || sourceKey === "youtube")) score += 0.04;

  const intents = new Set(profile?.buying_intents.map((intent) => intent.intent_type) ?? []);
  if (intents.has("alternative_search") || intents.has("switching_intent") || intents.has("renewal_reconsideration")) {
    if (sourceKey === "reddit" || sourceKey === "x" || sourceKey === "trustpilot" || sourceKey === "g2") score += 0.08;
    if (sourceKey === "hacker-news") score += 0.03;
    if (sourceKey === "product-hunt") score += 0.02;
    if ((sourceKey === "github" || sourceKey === "gitlab") && technicalAudience) score += 0.04;
    if (sourceKey === "g2") score += 0.05;
    if (capability) score += capability.supports_switching_intent * 0.02;
  }
  if (intents.has("recommendation_request")) {
    if (sourceKey === "reddit" || sourceKey === "x") score += 0.08;
    if (sourceKey === "bluesky") score += 0.05;
    if (sourceKey === "hacker-news") score += 0.02;
    if (capability) score += capability.supports_recommendation_intent * 0.02;
  }
  if (intents.has("feature_requirement")) {
    if (sourceKey === "github" && technicalAudience) score += 0.1;
    if (sourceKey === "reddit" || sourceKey === "x") score += 0.04;
    if (sourceKey === "hacker-news") score += 0.03;
    if (capability) score += capability.supports_feature_discussion * 0.02;
  }
  if (intents.has("comparison_intent")) {
    if (sourceKey === "reddit" || sourceKey === "x") score += 0.08;
    if (sourceKey === "hacker-news") score += 0.04;
    if ((sourceKey === "github" || sourceKey === "gitlab") && technicalAudience) score += 0.03;
    if (capability) score += capability.supports_competitor_comparison * 0.02;
  }
  if ((profile?.pains.length ?? 0) > 0) score += ({ reddit: 0.05, x: 0.04, bluesky: 0.03, "hacker-news": 0.03, github: technicalAudience ? 0.04 : 0, gitlab: technicalAudience ? 0.04 : 0, youtube: 0.03 }[sourceKey] ?? 0);
  if ((profile?.jobs_to_be_done.length ?? 0) > 0 && capability) score += capability.supports_problem_discussion * 0.02;
  if ((profile?.feature_demands.length ?? 0) > 0) score += ({ github: technicalAudience ? 0.05 : 0, gitlab: technicalAudience ? 0.05 : 0, reddit: 0.03, x: 0.03, youtube: 0.03 }[sourceKey] ?? 0);
  if ((profile?.known_competitors.length ?? 0) > 0 || (profile?.alternative_solutions.length ?? 0) > 0) score += ({ reddit: 0.03, x: 0.03, "hacker-news": 0.02, "product-hunt": 0.02, g2: 0.05, trustpilot: 0.03, youtube: 0.05, gitlab: technicalAudience ? 0.03 : 0, "public-web": 0.02 }[sourceKey] ?? 0);

  if (identity.locationDependency >= 0.8 || identity.marketScope === "local") {
    if (sourceKey === "hacker-news" || sourceKey === "github" || sourceKey === "stack-exchange") return 0;
    if (sourceKey === "reddit") score = Math.min(score, 0.6);
    if (sourceKey === "x" || sourceKey === "bluesky") score = Math.min(score, 0.4);
  }
  if (identity.marketScope === "local") {
    if (sourceKey === "hacker-news" || sourceKey === "github" || sourceKey === "stack-exchange") return 0;
    if (sourceKey === "reddit") score = Math.min(score, 0.6);
    if (sourceKey === "x" || sourceKey === "bluesky") score = Math.min(score, 0.45);
  } else if (identity.marketScope === "regional") {
    if (sourceKey === "hacker-news" || sourceKey === "github") score = Math.min(score, 0.45);
    if (sourceKey === "reddit" || sourceKey === "x" || sourceKey === "bluesky") score = Math.min(score, 0.7);
  }
  if (identity.businessType === "ecommerce" && (sourceKey === "hacker-news" || sourceKey === "github" || sourceKey === "stack-exchange")) return 0;
  if (identity.businessType === "local_business" && (sourceKey === "hacker-news" || sourceKey === "github" || sourceKey === "stack-exchange")) return 0;
  if (identity.profileConfidence < 0.5) score -= 0.08;
  return clamp(score);
}

function availability(state: SourceRoutingSourceState | undefined): { availabilityStatus: SourceRoutingAvailabilityStatus; healthStatus: SourceRoutingRoute["health_status"] } {
  const optionalUnavailable = ["trustpilot", "youtube", "gitlab"].includes(state?.sourceKey ?? "");
  if (!state || !state.configured) return { availabilityStatus: optionalUnavailable ? "unavailable" : "not_configured", healthStatus: optionalUnavailable ? "unknown" : state?.healthStatus ?? "unknown" };
  const controlState = state.controlState.toLowerCase();
  if (controlState === "paused") return { availabilityStatus: "paused", healthStatus: state.healthStatus ?? "unknown" };
  if (controlState === "disabled") return { availabilityStatus: "disabled", healthStatus: state.healthStatus ?? "unknown" };
  if (controlState !== "enabled") return { availabilityStatus: "unavailable", healthStatus: state.healthStatus ?? "unknown" };
  return { availabilityStatus: "available", healthStatus: state.healthStatus ?? "unknown" };
}

function reasonCodes(sourceKey: string, score: number, identity: ReturnType<typeof effectiveIdentity>, input: SourceRoutingInput, sourceState: SourceRoutingSourceState | undefined, healthStatus: SourceRoutingRoute["health_status"]): SourceRoutingReasonCode[] {
  const codes: SourceRoutingReasonCode[] = [];
  if (businessTypeBase[identity.businessType]?.[sourceKey] && businessTypeBase[identity.businessType][sourceKey] >= 0.65) codes.push("BUSINESS_TYPE_MATCH");
  const profile = input.demandProfile;
  const technical = identity.technicalOrientation === "high" || identity.technicalOrientation === "medium" || Boolean(profile && hasStructuredTerm([...profile.target_customer_types, ...profile.buyer_roles, ...profile.end_user_types], ["developer", "engineer", "technical", "api", "software"]));
  if (technical && (sourceKey === "github" || sourceKey === "gitlab")) codes.push("DEVELOPER_AUDIENCE_MATCH");
  if (technical && (sourceKey === "github" || sourceKey === "gitlab" || sourceKey === "hacker-news" || sourceKey === "stack-exchange")) codes.push("TECHNICAL_DISCUSSION_MATCH");
  const intents = new Set(profile?.buying_intents.map((intent) => intent.intent_type) ?? []);
  if (intents.has("switching_intent") || intents.has("alternative_search") || intents.has("renewal_reconsideration")) codes.push("SWITCHING_INTENT_MATCH");
  if (intents.has("recommendation_request")) codes.push("RECOMMENDATION_INTENT_MATCH");
  if (intents.has("comparison_intent")) codes.push("COMPARISON_INTENT_MATCH");
  if ((identity.businessType === "consumer_software" || identity.businessModel === "b2c") && (sourceKey === "reddit" || sourceKey === "x" || sourceKey === "product-hunt" || sourceKey === "trustpilot" || sourceKey === "youtube")) codes.push("CONSUMER_DISCUSSION_MATCH");
  if (identity.businessType === "ecommerce" && (sourceKey === "reddit" || sourceKey === "x" || sourceKey === "trustpilot")) codes.push("ECOMMERCE_MATCH");
  if (identity.locationDependency >= 0.8 || identity.marketScope === "local") {
    codes.push("HIGH_LOCATION_DEPENDENCY");
    if (sourceKey !== "reddit" && sourceKey !== "trustpilot" && sourceKey !== "youtube" && sourceKey !== "public-web") codes.push("LOCAL_COVERAGE_WEAK");
  }
  if (identity.profileConfidence < 0.5) codes.push("PROFILE_CONFIDENCE_LOW");
  if (sourceState && !sourceState.configured) codes.push("SOURCE_NOT_CONFIGURED");
  if (sourceState && sourceState.controlState.toLowerCase() === "paused") codes.push("SOURCE_PAUSED");
  if (healthStatus === "blocked" || healthStatus === "degraded") codes.push("SOURCE_UNHEALTHY");
  if (score < 0.25) codes.push("LOW_RELEVANCE");
  if (sourceKey === "x" && (input.scanMode === "onboarding" || input.scanMode === "baseline" || input.totalCandidateBudget < 50)) codes.push("PAID_SOURCE_BUDGET_LIMIT");
  return [...new Set(codes)];
}

function reasonSummary(codes: SourceRoutingReasonCode[]): string {
  return codes.length ? codes.map((code) => code.toLowerCase().replaceAll("_", " ")).join(", ") : "No strong product/source fit.";
}

function defaultCap(sourceKey: string, scanMode: SourceRoutingScanMode): { maxCandidates: number; maxPages: number } {
  if (scanMode === "onboarding" || scanMode === "baseline") return { maxCandidates: sourceKey === "x" ? 10 : ["product-hunt", "g2", "trustpilot", "youtube"].includes(sourceKey) ? 4 : 5, maxPages: 1 };
  return { maxCandidates: sourceKey === "x" ? 25 : ["product-hunt", "g2", "trustpilot", "youtube", "gitlab"].includes(sourceKey) ? 10 : 25, maxPages: sourceKey === "x" || sourceKey === "product-hunt" || sourceKey === "g2" || sourceKey === "trustpilot" || sourceKey === "youtube" || sourceKey === "gitlab" ? 1 : 3 };
}

function minimumCandidateBudget(route: SourceRoutingRoute, scanMode: SourceRoutingScanMode): number {
  if (scanMode === "manual" || scanMode === "manual_refresh" || scanMode === "manual_deep") {
    return ({ x: 6, github: 8, gitlab: 8, youtube: 6, "hacker-news": 4, bluesky: 6, "stack-exchange": 6, "product-hunt": 4, g2: 4, trustpilot: 4, "public-web": 2 } as Record<string, number>)[route.source_key] ?? 1;
  }
  if (scanMode !== "onboarding" && scanMode !== "baseline") return 1;
  return route.source_key === "x" ? 10 : 5;
}

function isExecutable(route: SourceRoutingRoute): boolean {
  return route.enabled_for_product && route.availability_status === "available" && route.health_status !== "blocked";
}

function rotationHash(seed: string, sourceKey: string): number {
  let hash = 2166136261;
  for (const character of seed + ":" + sourceKey) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function rotateSecondarySourceRoutes<T extends { source_key: string }>(routes: readonly T[], seed: string): T[] {
  if (routes.length <= 1) return [...routes];
  const numericSlot = Number(seed.match(/(\d+)$/)?.[1] ?? "");
  const offset = Number.isFinite(numericSlot) ? Math.max(0, numericSlot - 1) % routes.length : rotationHash(seed, "secondary") % routes.length;
  return [...routes.slice(offset), ...routes.slice(0, offset)];
}

function allocateBudget(routes: SourceRoutingRoute[], totalBudget: number, maxSources: number, input: SourceRoutingInput): { routes: SourceRoutingRoute[]; selected: SourceRoutingRoute[] } {
  if (totalBudget <= 0) return { routes: routes.map((route) => ({ ...route, budget_weight: 0, max_candidates: 0, max_pages: 0 })), selected: [] };
  const candidates = routes
    .filter(isExecutable)
    .filter((route) => (input.scanMode !== "onboarding" && input.scanMode !== "baseline") || route.priority !== "low")
    .sort((a, b) => {
      const healthRank = (status: SourceRoutingHealthStatus) => status === "healthy" ? 2 : status === "unknown" ? 1 : 0;
      const priorityRank = (priority: SourceRoutingPriority) => priority === "very_high" ? 2 : priority === "high" ? 1 : 0;
      if (healthRank(b.health_status) !== healthRank(a.health_status)) return healthRank(b.health_status) - healthRank(a.health_status);
      if (priorityRank(b.priority) !== priorityRank(a.priority)) return priorityRank(b.priority) - priorityRank(a.priority);
      return b.relevance_score - a.relevance_score || a.source_key.localeCompare(b.source_key);
    });
  const core = candidates.filter((route) => route.priority === "very_high" || route.priority === "high");
  const secondary = input.rotationSeed
    ? rotateSecondarySourceRoutes(candidates.filter((route) => route.priority !== "very_high" && route.priority !== "high"), input.rotationSeed)
    : candidates.filter((route) => route.priority !== "very_high" && route.priority !== "high");
  const limited = [...core, ...secondary].slice(0, maxSources);
  const selected: SourceRoutingRoute[] = [];
  let remainingBudget = totalBudget;
  for (const route of limited) {
    const minimum = Math.min(minimumCandidateBudget(route, input.scanMode), route.max_candidates);
    if (remainingBudget < minimum) continue;
    selected.push(route);
    remainingBudget -= minimum;
  }
  if (!selected.length) return { routes: routes.map((route) => ({ ...route, budget_weight: 0, max_candidates: 0, max_pages: 0 })), selected };
  const rawWeights = selected.map((route) => route.relevance_score * costFactor[route.cost_class] * (route.health_status === "degraded" ? 0.65 : 1));
  const totalWeight = rawWeights.reduce((sum, value) => sum + value, 0) || selected.length;
  const allocation = selected.map((route, index) => {
    const minimum = minimumCandidateBudget(route, input.scanMode);
    const desired = Math.max(minimum, Math.floor(totalBudget * rawWeights[index] / totalWeight));
    const cap = input.safetyCaps?.[route.source_key]?.maxCandidates ?? route.max_candidates;
    return { route, desired: Math.min(cap, desired), weight: rawWeights[index] / totalWeight };
  });
  let allocated = allocation.reduce((sum, item) => sum + item.desired, 0);
  let overflow = Math.max(0, allocated - totalBudget);
  for (const item of [...allocation].sort((a, b) => b.desired - a.desired || a.route.source_key.localeCompare(b.route.source_key))) {
    if (!overflow) break;
    const reducible = Math.max(0, item.desired - minimumCandidateBudget(item.route, input.scanMode));
    const reduction = Math.min(reducible, overflow);
    item.desired -= reduction;
    overflow -= reduction;
  }
  allocated = allocation.reduce((sum, item) => sum + item.desired, 0);
  const remaining = Math.max(0, totalBudget - allocated);
  if (remaining > 0) {
    const first = allocation[0];
    if (first) first.desired = Math.min(input.safetyCaps?.[first.route.source_key]?.maxCandidates ?? first.route.max_candidates, first.desired + remaining);
  }
  const allocatedByKey = new Map(allocation.map((item) => [item.route.source_key, item]));
  return {
    selected,
    routes: routes.map((route) => {
      const item = allocatedByKey.get(route.source_key);
      return item ? { ...route, budget_weight: round(item.weight), max_candidates: item.desired } : { ...route, budget_weight: 0, max_candidates: 0, max_pages: 0 };
    }),
  };
}

function missingCapabilities(identity: ReturnType<typeof effectiveIdentity>): string[] {
  if (identity.locationDependency >= 0.8 || identity.marketScope === "local" || identity.businessType === "local_business") return ["local_reviews", "local_forums", "search_demand"];
  if (identity.businessType === "ecommerce") return ["product_reviews", "shopping_reviews", "marketplace_reviews"];
  if (identity.businessType === "marketplace") return ["marketplace_reviews", "category_forums"];
  return [];
}

export function buildSourceRoutingPlan(input: SourceRoutingInput): SourceRoutingPlan {
  const identity = effectiveIdentity(input);
  const stateByKey = new Map(input.sourceStates.map((state) => [state.sourceKey, state]));
  const knownKeys = [...new Set([...sourceRoutingSourceKeys, ...input.sourceStates.map((state) => state.sourceKey)])].filter((key) => key !== "fixture" || (input.scanMode !== "onboarding" && input.scanMode !== "baseline"));
  const routes: SourceRoutingRoute[] = knownKeys.map((sourceKey) => {
    const profile = sourceRoutingCapabilityProfiles[sourceKey] ?? sourceRoutingCapabilityProfiles.fixture;
    const state = stateByKey.get(sourceKey);
    const { availabilityStatus, healthStatus } = availability(state);
    const relevance = round(initialScore(sourceKey, identity, input));
    const priority = priorityFor(relevance);
    const codes = reasonCodes(sourceKey, relevance, identity, input, state, healthStatus);
    const cap = input.safetyCaps?.[sourceKey] ?? defaultCap(sourceKey, input.scanMode);
    return {
      source_key: sourceKey,
      enabled_for_product: priority !== "off",
      priority,
      relevance_score: relevance,
      budget_weight: 0,
      max_candidates: priority === "off" ? 0 : cap.maxCandidates ?? defaultCap(sourceKey, input.scanMode).maxCandidates,
      max_pages: priority === "off" ? 0 : cap.maxPages ?? defaultCap(sourceKey, input.scanMode).maxPages,
      reason_codes: codes,
      reason_summary: reasonSummary(codes),
      confidence: round(identity.profileConfidence * (priority === "off" ? 0.75 : 1)),
      cost_class: profile.cost_class,
      health_status: healthStatus,
      availability_status: availabilityStatus,
    };
  });
  const maxSources = input.maxSources ?? ((input.scanMode === "onboarding" || input.scanMode === "baseline") ? 3 : input.scanMode === "manual" || input.scanMode === "manual_refresh" || input.scanMode === "manual_deep" ? 4 : routes.length);
  const allocation = allocateBudget(routes, Math.max(0, Math.floor(input.totalCandidateBudget)), maxSources, input);
  const finalRoutes = allocation.routes;
  const excludedSources: SourceRoutingExcludedSource[] = finalRoutes.filter((route) => !route.enabled_for_product).map((route) => ({ source_key: route.source_key, reason_codes: route.reason_codes, reason: route.reason_summary }));
  const operationalExclusions = finalRoutes.filter((route) => route.enabled_for_product && !isExecutable(route)).map((route) => ({ source_key: route.source_key, reason_codes: route.reason_codes, reason: route.reason_summary }));
  const relevant = finalRoutes.filter((route) => route.enabled_for_product && !(["trustpilot", "youtube", "gitlab"].includes(route.source_key) && route.availability_status === "unavailable"));
  const theoreticalWeight = relevant.reduce((sum, route) => sum + route.relevance_score, 0);
  const executableWeight = allocation.selected.reduce((sum, route) => sum + route.relevance_score, 0);
  let coverage = theoreticalWeight ? executableWeight / theoreticalWeight : 0;
  if (identity.locationDependency >= 0.8 || identity.marketScope === "local") coverage = Math.min(coverage, 0.45);
  coverage = round(coverage * (identity.profileConfidence < 0.5 ? 0.75 : 1));
  const coverageStatus: SourceRoutingPlan["coverage_status"] = coverage >= 0.75 ? "strong" : coverage >= 0.55 ? "good" : coverage >= 0.35 ? "limited" : coverage >= 0.15 ? "weak" : "unsupported";
  const selectedSources = allocation.selected.map((route) => route.source_key);
  const messages = [
    ...(identity.locationDependency >= 0.8 || identity.marketScope === "local" ? ["Location-dependent demand has limited coverage in the current provider set."] : []),
    ...(operationalExclusions.length ? [`${operationalExclusions.length} relevant source${operationalExclusions.length === 1 ? " is" : "s are"} not executable in the current environment.`] : []),
    ...(selectedSources.length ? [`Selected ${selectedSources.join(", ")} within the ${input.scanMode} budget.`] : ["No executable source met the current relevance and availability constraints."]),
  ];
  return {
    version: sourceRoutingVersion,
    product_id: input.productId,
    classification_version: input.classification?.classification_version ?? null,
    demand_profile_version: input.demandProfile ? "demand_profile_v2" : null,
    overall_coverage_confidence: coverage,
    coverage_status: coverageStatus,
    routes: finalRoutes,
    excluded_sources: excludedSources,
    diagnostics: {
      selected_sources: selectedSources,
      operational_exclusions: operationalExclusions,
      missing_source_capabilities: missingCapabilities(identity),
      budget_total: Math.max(0, Math.floor(input.totalCandidateBudget)),
      executable_budget: finalRoutes.reduce((sum, route) => sum + route.max_candidates, 0),
      messages,
    },
  };
}

export function selectExecutableSourceRoutes(plan: SourceRoutingPlan): SourceRoutingRoute[] {
  return plan.routes.filter(isExecutable).filter((route) => route.max_candidates > 0).sort((a, b) => b.relevance_score - a.relevance_score || a.source_key.localeCompare(b.source_key));
}

export function formatSourceRoutingDryRun(plan: SourceRoutingPlan): string {
  const routeLines = plan.routes.map((route) => `${route.source_key}: ${route.priority} relevance=${route.relevance_score} candidates=${route.max_candidates} availability=${route.availability_status}`);
  return [
    `${plan.version} product=${plan.product_id} coverage=${plan.coverage_status} confidence=${plan.overall_coverage_confidence}`,
    ...routeLines,
    `selected=${plan.diagnostics.selected_sources.join(",") || "none"}`,
    `gaps=${plan.diagnostics.missing_source_capabilities.join(",") || "none"}`,
  ].join("\n");
}

export type { DemandProfileV2RoutingModel, BusinessClassification };
