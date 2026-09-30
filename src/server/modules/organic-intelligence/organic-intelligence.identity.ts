import { createHash } from "node:crypto";

import type { OrganicReadinessCandidate } from "./organic-intelligence.schemas";

type IdentitySegment = { key: string; objectId: string };

export type CanonicalPathInput =
  | { family: "public_market_intelligence"; market: IdentitySegment }
  | { family: "demand_opportunity"; market: IdentitySegment; demand: IdentitySegment }
  | { family: "company_competitor_intelligence"; company: IdentitySegment }
  | { family: "trend_demand_drift"; trend: IdentitySegment }
  | { family: "geography_intelligence"; region: IdentitySegment; market: IdentitySegment }
  | { family: "research_data_report"; report: IdentitySegment };

export type CanonicalIdentityRecord = {
  family: OrganicReadinessCandidate["family"];
  objectId: string;
  path: string;
  aliasKeys: string[];
};

export type CanonicalIdentityResult = {
  state: "canonical" | "existing" | "merged" | "duplicate" | "collision" | "unresolved";
  family: OrganicReadinessCandidate["family"];
  objectId: string;
  canonicalPath: string | null;
  aliasKeys: string[];
  redirectFrom: string | null;
  reason: string | null;
};

function slugSegment(segment: IdentitySegment): string {
  const slug = segment.key
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "intelligence";
  const suffix = createHash("sha256").update(segment.objectId).digest("hex");
  return `${slug}~${suffix}`;
}

export function canonicalPathFor(input: CanonicalPathInput): string {
  switch (input.family) {
    case "public_market_intelligence":
      return `/market/${slugSegment(input.market)}`;
    case "demand_opportunity":
      return `/demand/${slugSegment(input.market)}/${slugSegment(input.demand)}`;
    case "company_competitor_intelligence":
      return `/companies/${slugSegment(input.company)}`;
    case "trend_demand_drift":
      return `/trends/${slugSegment(input.trend)}`;
    case "geography_intelligence":
      return `/markets/${slugSegment(input.region)}/${slugSegment(input.market)}`;
    case "research_data_report":
      return `/research/${slugSegment(input.report)}`;
  }
}

export function resolveCanonicalIdentity(
  input: CanonicalPathInput & { objectId: string; aliasKeys?: string[]; mergedIntoObjectId?: string | null },
  existing: readonly CanonicalIdentityRecord[],
): CanonicalIdentityResult {
  if (input.mergedIntoObjectId) {
    const target = existing.find((item) => item.family === input.family && item.objectId === input.mergedIntoObjectId);
    if (!target) {
      return {
        state: "unresolved", family: input.family, objectId: input.objectId, canonicalPath: null,
        aliasKeys: input.aliasKeys ?? [], redirectFrom: null, reason: "merge_target_unresolved",
      };
    }
    return {
      state: "merged", family: input.family, objectId: input.objectId, canonicalPath: target.path,
      aliasKeys: [...new Set([...(input.aliasKeys ?? []), ...target.aliasKeys])],
      redirectFrom: canonicalPathFor(input), reason: null,
    };
  }

  const existingObject = existing.find((item) => item.family === input.family && item.objectId === input.objectId);
  if (existingObject) {
    return {
      state: "existing",
      family: input.family,
      objectId: input.objectId,
      canonicalPath: existingObject.path,
      aliasKeys: [...new Set([...existingObject.aliasKeys, ...(input.aliasKeys ?? [])])],
      redirectFrom: null,
      reason: null,
    };
  }

  const aliasCollision = existing.some((item) =>
    item.family === input.family &&
    item.objectId !== input.objectId &&
    (input.aliasKeys ?? []).some((alias) => item.aliasKeys.includes(alias)),
  );
  if (aliasCollision) {
    return {
      state: "duplicate", family: input.family, objectId: input.objectId, canonicalPath: null,
      aliasKeys: input.aliasKeys ?? [], redirectFrom: null, reason: "canonical_alias_already_owned",
    };
  }

  const path = canonicalPathFor(input);
  const pathCollision = existing.some((item) => item.path === path && item.objectId !== input.objectId);
  if (pathCollision) {
    return {
      state: "collision", family: input.family, objectId: input.objectId, canonicalPath: null,
      aliasKeys: input.aliasKeys ?? [], redirectFrom: null, reason: "canonical_path_collision",
    };
  }

  return {
    state: "canonical", family: input.family, objectId: input.objectId, canonicalPath: path,
    aliasKeys: input.aliasKeys ?? [], redirectFrom: null, reason: null,
  };
}

export const FUTURE_CANONICAL_ROUTE_TEMPLATES = {
  public_market_intelligence: "/market/[market]",
  demand_opportunity: "/demand/[market]/[demand]",
  company_competitor_intelligence: "/companies/[company]",
  trend_demand_drift: "/trends/[trend]",
  geography_intelligence: "/markets/[region]/[market]",
  research_data_report: "/research/[report]",
} as const;
