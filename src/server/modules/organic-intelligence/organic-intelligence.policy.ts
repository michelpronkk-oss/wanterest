import {
  eligibilityDecisionSchema,
  organicReadinessCandidateSchema,
  type EligibilityDecision,
  type GateAssessment,
  type GateState,
  type IndependenceMetrics,
  type OrganicReadinessCandidate,
  type ReadinessDecisionState,
} from "./organic-intelligence.schemas";

export const ORGANIC_READINESS_THRESHOLDS = {
  maturity: {
    repeatedEpisodes: 3,
    repeatedAuthors: 3,
    corroboratedEpisodes: 5,
    corroboratedAuthors: 4,
    persistenceEpisodes: 8,
    persistenceAuthors: 5,
    persistenceBuckets: 4,
    persistenceDays: 90,
    accelerationEpisodes: 12,
    accelerationAuthors: 8,
    accelerationSources: 2,
    accelerationBuckets: 3,
    accelerationDays: 60,
    minimumAcceleration: 0.25,
    marketEpisodes: 24,
    marketAuthors: 18,
    marketSources: 3,
    marketBuckets: 5,
    marketDays: 120,
    marketMaximumDuplicateRatio: 0.15,
    marketMaximumConcentration: 0.2,
    marketMaximumViralConcentration: 0.15,
  },
  families: {
    public_market_intelligence: {
      episodes: 24, authors: 18, sourceFamilies: 3, timeBuckets: 5, spanDays: 120,
      duplicateRatio: 0.15, concentration: 0.2, viralConcentration: 0.15,
      maturity: "market_level", claimKinds: ["demand_signal"],
    },
    demand_opportunity: {
      episodes: 8, authors: 6, sourceFamilies: 2, timeBuckets: 4, spanDays: 90,
      duplicateRatio: 0.2, concentration: 0.35, viralConcentration: 0.25,
      maturity: "persistent", claimKinds: ["demand_signal"],
    },
    company_competitor_intelligence: {
      episodes: 8, authors: 6, sourceFamilies: 2, timeBuckets: 4, spanDays: 90,
      duplicateRatio: 0.2, concentration: 0.35, viralConcentration: 0.25,
      maturity: "persistent", claimKinds: ["demand_signal", "supply_fact"],
    },
    trend_demand_drift: {
      episodes: 12, authors: 8, sourceFamilies: 2, timeBuckets: 5, spanDays: 120,
      duplicateRatio: 0.15, concentration: 0.25, viralConcentration: 0.2,
      maturity: "persistent", claimKinds: ["trend_measurement"],
    },
    geography_intelligence: {
      episodes: 30, authors: 20, sourceFamilies: 3, timeBuckets: 4, spanDays: 90,
      duplicateRatio: 0.15, concentration: 0.25, viralConcentration: 0.2,
      maturity: "persistent", claimKinds: ["demand_signal", "geography_sample"],
      geographyConfidence: 0.85, regionalEpisodes: 30,
    },
    research_data_report: {
      episodes: 0, authors: 0, sourceFamilies: 0, timeBuckets: 0, spanDays: 0,
      duplicateRatio: 1, concentration: 1, viralConcentration: 1,
      maturity: null, claimKinds: ["research_dataset"], datasetRecords: 50,
    },
  },
  freshnessDays: {
    demand_signal: 90,
    supply_fact: 30,
    trend_measurement: 45,
    geography_sample: 90,
    research_dataset: 365,
  },
} as const;

export type EvidenceMaturityAssessment = {
  state: "observed" | "repeated" | "corroborated" | "persistent" | "accelerating" | "market_level" | "unavailable";
  reasons: string[];
  measuredSpanDays: number | null;
};

const MATURITY_REQUIRED: ReadonlyArray<keyof IndependenceMetrics> = [
  "independentEpisodeCount",
  "uniqueAuthorCount",
  "sourceFamilyCount",
  "timeBucketCount",
  "firstObservedAt",
  "lastObservedAt",
  "duplicateRatio",
  "sourceConcentration",
  "viralEventConcentration",
];

function measuredSpanDays(metrics: IndependenceMetrics): number | null {
  if (!metrics.firstObservedAt || !metrics.lastObservedAt) return null;
  const first = Date.parse(metrics.firstObservedAt);
  const last = Date.parse(metrics.lastObservedAt);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return null;
  return Math.floor((last - first) / 86_400_000);
}

export function assessEvidenceMaturity(metrics: IndependenceMetrics): EvidenceMaturityAssessment {
  if (MATURITY_REQUIRED.some((key) => metrics[key] === null)) {
    return { state: "unavailable", reasons: ["independence_dimensions_unavailable"], measuredSpanDays: measuredSpanDays(metrics) };
  }

  const episodes = metrics.independentEpisodeCount!;
  const authors = metrics.uniqueAuthorCount!;
  const sources = metrics.sourceFamilyCount!;
  const buckets = metrics.timeBucketCount!;
  const duplicateRatio = metrics.duplicateRatio!;
  const concentration = metrics.sourceConcentration!;
  const viralConcentration = metrics.viralEventConcentration!;
  const span = measuredSpanDays(metrics);
  if (span === null) return { state: "unavailable", reasons: ["evidence_time_window_invalid"], measuredSpanDays: null };

  const threshold = ORGANIC_READINESS_THRESHOLDS.maturity;
  if (
    episodes >= threshold.marketEpisodes && authors >= threshold.marketAuthors && sources >= threshold.marketSources &&
    buckets >= threshold.marketBuckets && span >= threshold.marketDays &&
    duplicateRatio <= threshold.marketMaximumDuplicateRatio && concentration <= threshold.marketMaximumConcentration &&
    viralConcentration <= threshold.marketMaximumViralConcentration
  ) {
    return { state: "market_level", reasons: [], measuredSpanDays: span };
  }

  if (
    episodes >= threshold.accelerationEpisodes && authors >= threshold.accelerationAuthors &&
    sources >= threshold.accelerationSources && buckets >= threshold.accelerationBuckets && span >= threshold.accelerationDays &&
    metrics.independentEpisodeAcceleration !== null && metrics.independentEpisodeAcceleration >= threshold.minimumAcceleration &&
    concentration <= 0.35 && viralConcentration <= 0.25
  ) {
    return { state: "accelerating", reasons: [], measuredSpanDays: span };
  }

  if (
    episodes >= threshold.persistenceEpisodes && authors >= threshold.persistenceAuthors &&
    sources >= 2 && buckets >= threshold.persistenceBuckets && span >= threshold.persistenceDays
  ) {
    return { state: "persistent", reasons: [], measuredSpanDays: span };
  }

  if (episodes >= threshold.corroboratedEpisodes && authors >= threshold.corroboratedAuthors && sources >= 2) {
    return { state: "corroborated", reasons: [], measuredSpanDays: span };
  }

  if (episodes >= threshold.repeatedEpisodes && authors >= threshold.repeatedAuthors) {
    return { state: "repeated", reasons: [], measuredSpanDays: span };
  }

  return { state: "observed", reasons: [], measuredSpanDays: span };
}

type ReadinessThreshold = {
  episodes: number;
  authors: number;
  sourceFamilies: number;
  timeBuckets: number;
  spanDays: number;
  duplicateRatio: number;
  concentration: number;
  viralConcentration: number;
  maturity: "market_level" | "persistent" | null;
  claimKinds: readonly string[];
  geographyConfidence?: number;
  regionalEpisodes?: number;
  datasetRecords?: number;
};
type ReasonAxis = "evidence" | "diversity" | "persistence" | "freshness" | "uniqueness" | "truth" | "concentration" | "safety" | "indexing";

function reason(code: string, axis: ReasonAxis, detail: string, evidenceRefs: string[]): EligibilityDecision["reasons"][number] {
  return { code, axis, detail, evidenceRefs: evidenceRefs.slice(0, 40) };
}

function gate(state: GateState, reasons: EligibilityDecision["reasons"] = []): GateAssessment {
  return { state, reasons };
}

function countGate(value: number | null, minimum: number, axis: ReasonAxis, code: string, description: string, refs: string[]): GateAssessment {
  if (value === null) return gate("unavailable", [reason(`${code}_unavailable`, axis, `The ${description} measure is unavailable.`, refs)]);
  if (value < minimum) return gate("fail", [reason(code, axis, `The ${description} measure is below the conservative minimum of ${minimum}.`, refs)]);
  return gate("pass");
}

function ratioGate(value: number | null, maximum: number, axis: ReasonAxis, code: string, description: string, refs: string[]): GateAssessment {
  if (value === null) return gate("unavailable", [reason(`${code}_unavailable`, axis, `The ${description} measure is unavailable.`, refs)]);
  if (value > maximum) return gate("fail", [reason(code, axis, `The ${description} exceeds the maximum of ${maximum}.`, refs)]);
  return gate("pass");
}

function expectedClaims(family: OrganicReadinessCandidate["family"]): readonly string[] {
  return ORGANIC_READINESS_THRESHOLDS.families[family].claimKinds;
}

function assessEvidence(candidate: OrganicReadinessCandidate, threshold: ReadinessThreshold): GateAssessment {
  const refs = candidate.publicEvidenceRefs;
  if (candidate.family === "research_data_report") {
    if (!candidate.research || candidate.research.datasetRecordCount === null) {
      return gate("unavailable", [reason("defensible_dataset_unavailable", "evidence", "Research dataset readiness has not been verified.", refs)]);
    }
    if (candidate.research.datasetRecordCount < ORGANIC_READINESS_THRESHOLDS.families.research_data_report.datasetRecords!) {
      return gate("fail", [reason("research_dataset_too_small", "evidence", "The defensible research dataset is below the configured minimum record count.", refs)]);
    }
    if (candidate.publicEvidenceRefs.length === 0) return gate("fail", [reason("research_evidence_missing", "evidence", "No reviewed supporting evidence is linked to the research candidate.", refs)]);
    if (candidate.research.datasetDefensible !== true) return gate("fail", [reason("dataset_not_defensible", "evidence", "The dataset has not been confirmed as defensible.", refs)]);
    return gate("pass");
  }

  const episodes = countGate(candidate.independence.independentEpisodeCount, threshold.episodes, "evidence", "independent_episodes_insufficient", "independent episode count", refs);
  if (episodes.state !== "pass") return episodes;
  if (refs.length === 0) return gate("fail", [reason("evidence_references_missing", "evidence", "No source evidence references are available for review.", refs)]);
  return gate("pass");
}

function assessDiversity(candidate: OrganicReadinessCandidate, threshold: ReadinessThreshold): GateAssessment {
  if (candidate.family === "research_data_report") {
    const defensible = candidate.research?.datasetDefensible;
    if (defensible === null || defensible === undefined) return gate("unavailable", [reason("research_dataset_diversity_unavailable", "diversity", "The research dataset diversity review is unavailable.", candidate.publicEvidenceRefs)]);
    return defensible ? gate("pass") : gate("fail", [reason("research_dataset_not_diverse", "diversity", "The research dataset has not passed the diversity review.", candidate.publicEvidenceRefs)]);
  }
  const author = countGate(candidate.independence.uniqueAuthorCount, threshold.authors, "diversity", "independent_authors_insufficient", "independent author count", candidate.publicEvidenceRefs);
  const source = countGate(candidate.independence.sourceFamilyCount, threshold.sourceFamilies, "diversity", "source_families_insufficient", "source-family breadth", candidate.publicEvidenceRefs);
  const combined = [...author.reasons, ...source.reasons];
  if (author.state === "fail" || source.state === "fail") return gate("fail", combined);
  if (author.state === "unavailable" || source.state === "unavailable") return gate("unavailable", combined);
  return gate("pass");
}

function assessPersistence(candidate: OrganicReadinessCandidate, threshold: ReadinessThreshold, maturity: EvidenceMaturityAssessment): GateAssessment {
  if (candidate.family === "research_data_report") {
    const approved = candidate.research?.topicManuallyApproved;
    const methodology = candidate.research?.methodologyDefined;
    if (approved === null || approved === undefined || methodology === null || methodology === undefined) {
      return gate("unavailable", [reason("research_review_unavailable", "persistence", "Manual topic approval and methodology status are required.", candidate.publicEvidenceRefs)]);
    }
    if (!approved || !methodology) return gate("fail", [reason("research_methodology_incomplete", "persistence", "Research requires manual topic approval and an explicit methodology.", candidate.publicEvidenceRefs)]);
    return gate("pass");
  }

  const buckets = countGate(candidate.independence.timeBucketCount, threshold.timeBuckets, "persistence", "meaningful_time_buckets_insufficient", "independent time-bucket count", candidate.publicEvidenceRefs);
  if (buckets.state !== "pass") return buckets;
  const span = maturity.measuredSpanDays;
  if (span === null) return gate("unavailable", [reason("evidence_span_unavailable", "persistence", "The evidence time span could not be measured.", candidate.publicEvidenceRefs)]);
  if (span < threshold.spanDays) return gate("fail", [reason("evidence_span_too_short", "persistence", `Evidence has persisted for fewer than ${threshold.spanDays} days.`, candidate.publicEvidenceRefs)]);

  if (threshold.maturity === "market_level" && maturity.state !== "market_level") {
    return gate("fail", [reason("market_level_maturity_not_met", "persistence", "Evidence does not meet the market-level maturity contract.", candidate.publicEvidenceRefs)]);
  }
  if (threshold.maturity === "persistent" && !["persistent", "accelerating", "market_level"].includes(maturity.state)) {
    return gate("fail", [reason("persistent_maturity_not_met", "persistence", "Evidence remains below persistent maturity.", candidate.publicEvidenceRefs)]);
  }
  if (candidate.family === "trend_demand_drift") {
    const acceleration = candidate.independence.independentEpisodeAcceleration;
    if (acceleration === null) return gate("unavailable", [reason("independent_movement_unavailable", "persistence", "Trend movement from independent episodes is unavailable.", candidate.publicEvidenceRefs)]);
    if (Math.abs(acceleration) < ORGANIC_READINESS_THRESHOLDS.maturity.minimumAcceleration) {
      return gate("fail", [reason("independent_movement_not_significant", "persistence", "Independent episode movement is below the configured trend threshold.", candidate.publicEvidenceRefs)]);
    }
  }
  if (candidate.family === "geography_intelligence") {
    const confidence = candidate.independence.geographyConfidence;
    const regionalEpisodes = candidate.independence.regionalIndependentEpisodeCount;
    if (confidence === null || regionalEpisodes === null) return gate("unavailable", [reason("geography_confidence_unavailable", "persistence", "Regional evidence count or location confidence is unavailable.", candidate.publicEvidenceRefs)]);
    if (confidence < threshold.geographyConfidence! || regionalEpisodes < threshold.regionalEpisodes!) {
      return gate("fail", [reason("geography_sample_insufficient", "persistence", "Location confidence or regional sample size is below the configured minimum.", candidate.publicEvidenceRefs)]);
    }
  }
  return gate("pass");
}

function assessFreshness(candidate: OrganicReadinessCandidate, now: Date): GateAssessment {
  const kinds = expectedClaims(candidate.family);
  const reasons: EligibilityDecision["reasons"] = [];
  let sawUnavailable = false;
  let sawFailure = false;
  for (const kind of kinds) {
    const claim = candidate.freshnessClaims.find((item) => item.kind === kind);
    if (!claim || !claim.lastMeaningfulUpdateAt) {
      sawUnavailable = true;
      reasons.push(reason(`claim_freshness_unavailable_${kind}`, "freshness", `A meaningful update date for the ${kind.replaceAll("_", " ")} claim is unavailable.`, candidate.publicEvidenceRefs));
      continue;
    }
    const timestamp = Date.parse(claim.lastMeaningfulUpdateAt);
    if (!Number.isFinite(timestamp) || timestamp > now.getTime()) {
      sawUnavailable = true;
      reasons.push(reason(`claim_freshness_invalid_${kind}`, "freshness", `The ${kind.replaceAll("_", " ")} claim update date is not trustworthy.`, candidate.publicEvidenceRefs));
      continue;
    }
    const ageDays = Math.floor((now.getTime() - timestamp) / 86_400_000);
    const maxDays = ORGANIC_READINESS_THRESHOLDS.freshnessDays[kind as keyof typeof ORGANIC_READINESS_THRESHOLDS.freshnessDays];
    if (ageDays > maxDays) {
      sawFailure = true;
      reasons.push(reason(`claim_stale_${kind}`, "freshness", `The ${kind.replaceAll("_", " ")} claim is older than its ${maxDays}-day freshness window.`, candidate.publicEvidenceRefs));
    }
  }
  if (sawFailure) return gate("fail", reasons);
  if (sawUnavailable) return gate("unavailable", reasons);
  return gate("pass");
}

function assessUniqueness(candidate: OrganicReadinessCandidate): GateAssessment {
  switch (candidate.uniqueness) {
    case "unique": return gate("pass");
    case "duplicate": return gate("fail", [reason("duplicate_identity", "uniqueness", "An existing canonical identity covers this intelligence object.", candidate.publicEvidenceRefs)]);
    case "merged": return gate("fail", [reason("merged_identity", "uniqueness", "This intelligence object has a stronger canonical identity.", candidate.publicEvidenceRefs)]);
    case "review": return gate("review", [reason("identity_review_required", "uniqueness", "Identity overlap requires human review.", candidate.publicEvidenceRefs)]);
    case "unverified": return gate("unavailable", [reason("uniqueness_unverified", "uniqueness", "Canonical uniqueness has not been verified.", candidate.publicEvidenceRefs)]);
  }
}

function assessTruth(candidate: OrganicReadinessCandidate): GateAssessment {
  const reasons: EligibilityDecision["reasons"] = [];
  let failed = false;
  let review = false;
  let unavailable = false;
  for (const kind of expectedClaims(candidate.family)) {
    const claim = candidate.freshnessClaims.find((item) => item.kind === kind);
    if (!claim) {
      unavailable = true;
      reasons.push(reason(`claim_truth_unavailable_${kind}`, "truth", `Truth state for the ${kind.replaceAll("_", " ")} claim is unavailable.`, candidate.publicEvidenceRefs));
      continue;
    }
    if (claim.truth === "unconfirmed") {
      failed = true;
      reasons.push(reason(`claim_unconfirmed_${kind}`, "truth", `The ${kind.replaceAll("_", " ")} claim is not confirmed.`, candidate.publicEvidenceRefs));
    } else if (claim.truth === "needs_review") {
      review = true;
      reasons.push(reason(`claim_review_required_${kind}`, "truth", `The ${kind.replaceAll("_", " ")} claim requires human confirmation.`, candidate.publicEvidenceRefs));
    }
  }

  if (candidate.family === "company_competitor_intelligence" && candidate.firstPartySupplyConfirmed !== true) {
    if (candidate.firstPartySupplyConfirmed === null) {
      unavailable = true;
      reasons.push(reason("first_party_supply_unavailable", "truth", "Company supply facts lack a first-party confirmation record.", candidate.publicEvidenceRefs));
    } else {
      failed = true;
      reasons.push(reason("first_party_supply_unconfirmed", "truth", "Company supply facts are not first-party confirmed.", candidate.publicEvidenceRefs));
    }
  }
  if (failed) return gate("fail", reasons);
  if (unavailable) return gate("unavailable", reasons);
  if (review) return gate("review", reasons);
  return gate("pass");
}

function assessConcentration(candidate: OrganicReadinessCandidate, threshold: ReadinessThreshold): GateAssessment {
  const refs = candidate.publicEvidenceRefs;
  const ratios = [
    ratioGate(candidate.independence.duplicateRatio, threshold.duplicateRatio, "concentration", "duplicate_ratio_high", "duplicate ratio", refs),
    ratioGate(candidate.independence.sourceConcentration, threshold.concentration, "concentration", "source_concentration_high", "source concentration", refs),
    ratioGate(candidate.independence.viralEventConcentration, threshold.viralConcentration, "concentration", "viral_event_concentration_high", "viral-event concentration", refs),
  ];
  const reasons = ratios.flatMap((item) => item.reasons);
  if (ratios.some((item) => item.state === "fail")) return gate("fail", reasons);
  if (ratios.some((item) => item.state === "unavailable")) return gate("unavailable", reasons);
  return gate("pass");
}

function assessSafety(candidate: OrganicReadinessCandidate): GateAssessment {
  const reasons: EligibilityDecision["reasons"] = [];
  if (candidate.privacy === "blocked") reasons.push(reason("privacy_review_blocked", "safety", "The public projection fails the privacy review.", candidate.publicEvidenceRefs));
  if (candidate.copyright === "blocked") reasons.push(reason("copyright_review_blocked", "safety", "The public projection fails the copyright review.", candidate.publicEvidenceRefs));
  if (reasons.length > 0) return gate("fail", reasons);
  if (candidate.privacy === "unverified" || candidate.copyright === "unverified") {
    return gate("unavailable", [reason("public_safety_unverified", "safety", "Privacy and copyright approval are both required before any public-safe projection can be created.", candidate.publicEvidenceRefs)]);
  }
  return gate("pass");
}

function stateFromGates(candidate: OrganicReadinessCandidate, gates: EligibilityDecision["gates"]): ReadinessDecisionState {
  if (candidate.indexPolicy === "noindex") return "noindex";
  if (candidate.uniqueness === "merged") return "merged_identity";
  if (candidate.uniqueness === "duplicate") return "duplicate_identity";
  if (candidate.uniqueness === "unverified") return "uniqueness_unverified";
  if (gates.safety.reasons.some((item) => item.code === "privacy_review_blocked")) return "privacy_blocked";
  if (gates.safety.reasons.some((item) => item.code === "copyright_review_blocked")) return "copyright_blocked";
  if (gates.truth.state === "fail") return "truth_unconfirmed";
  if (gates.concentration.state === "fail") return "high_concentration";
  if (gates.evidence.state === "fail") return "insufficient_evidence";
  if (gates.diversity.state === "fail") return "insufficient_diversity";
  if (gates.persistence.state === "fail") return "insufficient_persistence";
  if (gates.freshness.state === "fail") return "stale";
  if (gates.evidence.state === "unavailable") return "evidence_unavailable";
  if (gates.diversity.state === "unavailable" || gates.persistence.state === "unavailable") return "insufficient_persistence";
  if (gates.freshness.state === "unavailable") return "freshness_unverified";
  if (gates.truth.state === "unavailable") return "truth_unconfirmed";
  if (gates.concentration.state === "unavailable") return "evidence_unavailable";
  if (gates.safety.state === "unavailable") return "safety_unverified";
  if (gates.uniqueness.state === "review" || gates.truth.state === "review") return "eligible_review_required";
  return "eligible";
}

export function evaluateOrganicEligibility(candidate: OrganicReadinessCandidate, evaluatedAt: Date = new Date()): EligibilityDecision {
  const parsed = organicReadinessCandidateSchemaParse(candidate);
  const threshold = ORGANIC_READINESS_THRESHOLDS.families[parsed.family];
  const maturity = parsed.family === "research_data_report" ? null : assessEvidenceMaturity(parsed.independence);
  const gates: EligibilityDecision["gates"] = {
    evidence: assessEvidence(parsed, threshold),
    diversity: assessDiversity(parsed, threshold),
    persistence: assessPersistence(parsed, threshold, maturity ?? { state: "unavailable", reasons: [], measuredSpanDays: null }),
    freshness: assessFreshness(parsed, evaluatedAt),
    uniqueness: assessUniqueness(parsed),
    truth: assessTruth(parsed),
    concentration: assessConcentration(parsed, threshold),
    safety: assessSafety(parsed),
  };
  const reasons = Object.values(gates).flatMap((item) => item.reasons);
  const decision = {
    objectId: parsed.objectId,
    family: parsed.family,
    state: stateFromGates(parsed, gates),
    maturity: maturity?.state === "unavailable" ? null : maturity?.state ?? null,
    evaluatedAt: evaluatedAt.toISOString(),
    gates,
    reasons,
  };
  return eligibilityDecisionSchema.parse(decision);
}

function organicReadinessCandidateSchemaParse(candidate: OrganicReadinessCandidate): OrganicReadinessCandidate {
  // Revalidate at the domain boundary in case data came from a database adapter.
  const result = organicReadinessCandidateSchema.safeParse(candidate);
  if (!result.success) throw new Error("organic_readiness_candidate_invalid");
  return result.data;
}

// Search visibility can reprioritize review only; it never participates in eligibility.
export type SearchConsoleReadinessSignal = {
  state: "settled" | "provisional" | "unavailable";
  opportunities: ReadonlyArray<{ type: string; branded: boolean }>;
};

export type SearchConsoleReadinessPriority = "not_eligible" | "search_opportunity" | "provisional_signal" | "standard_review" | "unavailable";

export function prioritizeEligibleCandidate(
  decision: Pick<EligibilityDecision, "state">,
  signal: SearchConsoleReadinessSignal,
): SearchConsoleReadinessPriority {
  if (decision.state !== "eligible" && decision.state !== "eligible_review_required") return "not_eligible";
  if (signal.state === "unavailable") return "unavailable";
  const hasNonBrandedOpportunity = signal.opportunities.some((item) => !item.branded);
  if (!hasNonBrandedOpportunity) return "standard_review";
  return signal.state === "provisional" ? "provisional_signal" : "search_opportunity";
}
