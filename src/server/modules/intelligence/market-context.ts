import type { DemandProfileV2 } from "./demand-profile-v2.schemas";

export const MARKET_CONTEXT_VERSION = "market_context_v1" as const;

export type MarketRelationshipType = "direct_competitor" | "indirect_competitor" | "substitute" | "adjacent_product" | "integration_complement" | "legacy_manual_substitute";
export type MarketRelationshipSource = "onboarding" | "website" | "structured_profile" | "conversation" | "external_evidence";

export type MarketRelationship = {
  entity_name: string;
  relationship_type: MarketRelationshipType;
  confidence: number;
  source: MarketRelationshipSource;
  evidence: Array<{ source_reference: string; excerpt: string | null; field_path: string }>;
  discovered_at: string | null;
  last_supported_at: string | null;
};

export type MarketContext = {
  version: typeof MARKET_CONTEXT_VERSION;
  product_name: string;
  categories: string[];
  capabilities: string[];
  jobs_to_be_done: string[];
  pains_solved: string[];
  buyer_roles: string[];
  relationships: MarketRelationship[];
};

function unique(values: string[], limit: number): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function evidence(value: Array<{ source_reference: string; excerpt: string | null; field_path: string }>): MarketRelationship["evidence"] {
  return value.slice(0, 4).map((item) => ({ source_reference: item.source_reference, excerpt: item.excerpt, field_path: item.field_path }));
}

export function buildMarketContext(profile: DemandProfileV2): MarketContext {
  const relationships: MarketRelationship[] = [
    ...profile.competitors.known_competitors.map((item) => ({
      entity_name: item.name,
      relationship_type: (item.relationship_type === "direct_competitor" ? "direct_competitor" : item.relationship_type === "adjacent_competitor" ? "adjacent_product" : "indirect_competitor") as MarketRelationshipType,
      confidence: item.confidence,
      source: "structured_profile" as const,
      evidence: evidence(item.evidence),
      discovered_at: null,
      last_supported_at: null,
    })),
    ...profile.alternatives.map((item) => ({
      entity_name: item.label,
      relationship_type: (item.alternative_type === "manual_process" || item.alternative_type === "status_quo" || item.alternative_type === "internal_build" ? "legacy_manual_substitute" : item.alternative_type === "competitor_product" ? "indirect_competitor" : "substitute") as MarketRelationshipType,
      confidence: item.confidence,
      source: "structured_profile" as const,
      evidence: evidence(item.evidence),
      discovered_at: null,
      last_supported_at: null,
    })),
  ];
  const deduped = new Map<string, MarketRelationship>();
  for (const relationship of relationships) {
    const key = relationship.entity_name.toLowerCase();
    const current = deduped.get(key);
    if (!current || current.confidence < relationship.confidence) deduped.set(key, relationship);
  }
  return {
    version: MARKET_CONTEXT_VERSION,
    product_name: profile.identity.product_name,
    categories: unique([profile.identity.primary_category, ...profile.identity.secondary_categories], 12),
    capabilities: unique(profile.feature_demands.map((item) => item.feature), 20),
    jobs_to_be_done: unique(profile.jobs_to_be_done.map((item) => item.job), 12),
    pains_solved: unique(profile.problems.map((item) => item.label), 12),
    buyer_roles: unique(profile.audience.buyer_roles, 20),
    relationships: [...deduped.values()].slice(0, 24),
  };
}

export function fallbackMarketContext(input: { productName: string; category?: string; capabilities: string[]; jobs: string[]; pains: string[]; buyerRoles: string[]; competitors: string[]; alternatives: Array<{ label: string; type?: string }> }): MarketContext {
  return {
    version: MARKET_CONTEXT_VERSION,
    product_name: input.productName,
    categories: input.category ? [input.category] : [],
    capabilities: unique(input.capabilities, 20),
    jobs_to_be_done: unique(input.jobs, 12),
    pains_solved: unique(input.pains, 12),
    buyer_roles: unique(input.buyerRoles, 20),
    relationships: [
      ...input.competitors.filter(Boolean).map((entity_name) => ({ entity_name, relationship_type: "direct_competitor" as const, confidence: 0.55, source: "onboarding" as const, evidence: [], discovered_at: null, last_supported_at: null })),
      ...input.alternatives.filter((item) => item.label).map((item) => ({ entity_name: item.label, relationship_type: item.type === "manual_process" ? "legacy_manual_substitute" as const : "substitute" as const, confidence: 0.55, source: "onboarding" as const, evidence: [], discovered_at: null, last_supported_at: null })),
    ].slice(0, 24),
  };
}
