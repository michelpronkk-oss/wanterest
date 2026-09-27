import { sha256Json } from "../ingestion/hash";
import {
  CROSS_PRODUCT_ROUTING_MAX_PRODUCTS,
  crossProductRoutingVersion,
  productRoutingProfileVersion,
  type CrossProductRoute,
  type CrossProductRouteType,
  type CrossProductRoutingTelemetry,
  type ProductRoutingProfile,
  type PublicRoutingEvidence,
} from "./cross-product-routing.schemas";

const COMMON_WORD_CONTEXT: Record<string, string[]> = {
  linear: ["project", "issue", "task", "team", "workflow", "tool", "alternative", "alternatives", "switch", "switching", "missing", "lack", "lacks", "tracking"],
  notion: ["workspace", "wiki", "notes", "database", "template", "docs", "document", "team"],
  slack: ["channel", "chat", "message", "workspace", "team", "notification", "thread"],
  jira: ["issue", "ticket", "project", "sprint", "atlassian", "workflow", "alternative", "alternatives", "switch", "switching"],
};

const COMMON_WORD_EXCLUSIONS: Record<string, string[]> = {
  linear: ["regression", "algebra", "equation", "vector", "python", "mathematics", "math"],
  jira: ["plugin development", "plugin", "java api"],
};

const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "our", "your", "how", "what", "are", "is", "to", "of", "a", "an", "in", "on", "or", "as", "by", "it", "we", "need"]);

function normalizeTerm(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function meaningfulTerms(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeTerm).filter((value) => value.length >= 3 && !STOP_WORDS.has(value)))].sort();
}

function termValues(values: readonly unknown[]): string[] {
  return values.flatMap((value) => {
    if (typeof value === "string") return [value];
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    return [record.value, record.label, record.job, record.feature, record.name, record.term, record.category, record.key]
      .filter((item): item is string => typeof item === "string");
  });
}

export type ProductRoutingProfileInput = Omit<ProductRoutingProfile, "profileVersion" | "profileFingerprint" | "entityTerms" | "categoryTerms" | "jtbdTerms" | "painTerms" | "featureTerms" | "competitorTerms" | "comparisonTerms"> & {
  aliases?: string[];
  categories?: string[];
  jobs?: string[];
  pains?: string[];
  features?: string[];
  competitors?: string[];
  comparisonTerms?: string[];
};

export function buildProductRoutingProfile(input: ProductRoutingProfileInput): ProductRoutingProfile {
  const entityTerms = meaningfulTerms([input.productName, ...(input.aliases ?? [])]);
  const categoryTerms = meaningfulTerms(input.categories ?? []);
  const jtbdTerms = meaningfulTerms(input.jobs ?? []);
  const painTerms = meaningfulTerms(input.pains ?? []);
  const featureTerms = meaningfulTerms(input.features ?? []);
  const competitorTerms = meaningfulTerms(input.competitors ?? []);
  const comparisonTerms = meaningfulTerms(input.comparisonTerms ?? []);
  const fingerprint = sha256Json({
    version: productRoutingProfileVersion,
    workspaceId: input.workspaceId,
    productId: input.productId,
    productName: normalizeTerm(input.productName),
    entityTerms,
    categoryTerms,
    jtbdTerms,
    painTerms,
    featureTerms,
    competitorTerms,
    comparisonTerms,
  });
  return { ...input, profileVersion: productRoutingProfileVersion, profileFingerprint: fingerprint, entityTerms, categoryTerms, jtbdTerms, painTerms, featureTerms, competitorTerms, comparisonTerms };
}

export function publicEvidenceFingerprint(evidence: Pick<PublicRoutingEvidence, "conversationId" | "contentHash">): string {
  return sha256Json({ routingVersion: crossProductRoutingVersion, conversationId: evidence.conversationId, contentHash: evidence.contentHash });
}

export function routeFingerprint(input: { evidenceFingerprint: string; profileFingerprint: string }): string {
  return sha256Json({ routingVersion: crossProductRoutingVersion, evidenceFingerprint: input.evidenceFingerprint, profileFingerprint: input.profileFingerprint });
}

function searchableText(evidence: PublicRoutingEvidence): string {
  return normalizeTerm(`${evidence.title ?? ""} ${evidence.body}`);
}

function hasBoundaryTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text);
}

function entityGuard(term: string, text: string): string | null {
  const exclusions = COMMON_WORD_EXCLUSIONS[term];
  if (exclusions?.some((value) => text.includes(value))) return `common_word_exclusion:${term}`;
  const context = COMMON_WORD_CONTEXT[term];
  if (context && !context.some((value) => hasBoundaryTerm(text, value))) return `common_word_context_missing:${term}`;
  return null;
}

function matchingTerms(text: string, terms: readonly string[], guard = false): { matches: string[]; guardReason?: string } {
  const matches: string[] = [];
  for (const term of terms) {
    if (!hasBoundaryTerm(text, term)) continue;
    if (guard) {
      const guarded = entityGuard(term, text);
      if (guarded) return { matches: [], guardReason: guarded };
    }
    matches.push(term);
  }
  return { matches: [...new Set(matches)].sort() };
}

function routeFor(evidence: PublicRoutingEvidence, profile: ProductRoutingProfile): Omit<CrossProductRoute, "status"> | null {
  const text = searchableText(evidence);
  const direct = matchingTerms(text, profile.entityTerms, true);
  const competitors = matchingTerms(text, profile.competitorTerms, true);
  const category = matchingTerms(text, [...profile.categoryTerms, ...profile.jtbdTerms, ...profile.painTerms, ...profile.featureTerms]);
  let routeType: CrossProductRouteType | null = null;
  let stage: CrossProductRoute["reason"]["stage"];
  let matchedTerms: string[];
  let mentionedCompetitors: string[] = [];
  let score = 0;
  if (direct.matches.length) {
    routeType = "direct";
    stage = "deterministic_entity";
    matchedTerms = direct.matches;
    score = 1;
  } else if (competitors.matches.length) {
    routeType = "competitor";
    stage = "deterministic_competitor";
    matchedTerms = competitors.matches;
    mentionedCompetitors = competitors.matches;
    score = 0.86;
  } else if (category.matches.length) {
    routeType = "category";
    stage = "deterministic_category";
    matchedTerms = category.matches;
    score = Math.min(0.8, 0.52 + Math.min(category.matches.length, 4) * 0.07);
  } else {
    if (direct.guardReason) return null;
    return null;
  }
  const evidenceFingerprint = publicEvidenceFingerprint(evidence);
  const route = {
    workspaceId: profile.workspaceId,
    productId: profile.productId,
    conversationId: evidence.conversationId,
    routingVersion: crossProductRoutingVersion,
    profileVersion: profile.profileVersion,
    evidenceFingerprint,
    profileFingerprint: profile.profileFingerprint,
    routeFingerprint: routeFingerprint({ evidenceFingerprint, profileFingerprint: profile.profileFingerprint }),
    routeType,
    score,
    reason: { matchedTerms, mentionedCompetitors, stage, ...(direct.guardReason ? { commonWordGuard: direct.guardReason } : {}) },
  };
  return route;
}

export function routePublicEvidence(input: { evidence: PublicRoutingEvidence; profiles: ProductRoutingProfile[]; maxProducts?: number; existingProductIds?: Set<string> }): { routes: CrossProductRoute[]; telemetry: CrossProductRoutingTelemetry } {
  const maxProducts = Math.max(0, Math.floor(input.maxProducts ?? CROSS_PRODUCT_ROUTING_MAX_PRODUCTS));
  const candidates = input.profiles.map((profile) => routeFor(input.evidence, profile)).filter((route): route is Omit<CrossProductRoute, "status"> => Boolean(route));
  const ordered = [...candidates].sort((a, b) => b.score - a.score || a.routeType.localeCompare(b.routeType) || a.workspaceId.localeCompare(b.workspaceId) || a.productId.localeCompare(b.productId));
  const retained = ordered.slice(0, maxProducts).map((route) => ({ ...route, status: input.existingProductIds?.has(route.productId) ? "reused" as const : "eligible" as const }));
  const telemetry: CrossProductRoutingTelemetry = {
    routingVersion: crossProductRoutingVersion,
    shadowInvoked: true,
    evidenceSeen: 1,
    conversationsExamined: 1,
    routingProfilesConsidered: input.profiles.length,
    deterministicPrefilterMatches: candidates.length,
    directRoutes: retained.filter((route) => route.routeType === "direct").length,
    categoryRoutes: retained.filter((route) => route.routeType === "category").length,
    competitorRoutes: retained.filter((route) => route.routeType === "competitor").length,
    noRouteDecisions: candidates.length === 0 ? 1 : 0,
    candidateProductsBeforeCap: candidates.length,
    candidateProductsAfterCap: retained.length,
    candidateProducts: candidates.length,
    capSkips: Math.max(0, candidates.length - retained.length),
    conversationCapSkips: 0,
    routesCreated: retained.filter((route) => route.status === "eligible").length,
    routesReused: retained.filter((route) => route.status === "reused").length,
    routesRejectedDownstream: 0,
    routeMissShadow: 0,
    routeExtraShadow: 0,
    semanticCalls: 0,
  };
  return { routes: retained, telemetry };
}

export function compareCrossProductRouting(input: { existingProductIds: Set<string>; routes: CrossProductRoute[] }): Pick<CrossProductRoutingTelemetry, "routeMissShadow" | "routeExtraShadow"> {
  const routed = new Set(input.routes.map((route) => route.productId));
  return {
    routeMissShadow: [...input.existingProductIds].filter((productId) => !routed.has(productId)).length,
    routeExtraShadow: [...routed].filter((productId) => !input.existingProductIds.has(productId)).length,
  };
}

export function profileInputFromDemandProfile(input: {
  workspaceId: string;
  productId: string;
  productName: string;
  aliases?: unknown[];
  categories?: unknown[];
  jobs?: unknown[];
  pains?: unknown[];
  features?: unknown[];
  competitors?: unknown[];
  comparisonTerms?: unknown[];
}): ProductRoutingProfile {
  return buildProductRoutingProfile({
    workspaceId: input.workspaceId,
    productId: input.productId,
    productName: input.productName,
    aliases: termValues(input.aliases ?? []),
    categories: termValues(input.categories ?? []),
    jobs: termValues(input.jobs ?? []),
    pains: termValues(input.pains ?? []),
    features: termValues(input.features ?? []),
    competitors: termValues(input.competitors ?? []),
    comparisonTerms: termValues(input.comparisonTerms ?? []),
  });
}
