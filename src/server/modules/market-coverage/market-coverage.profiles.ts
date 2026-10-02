import "server-only";

import { MARKET_SOURCE_FAMILIES, marketSourceFamilySchema, type MARKET_EVIDENCE_ROLES } from "./market-coverage.contracts";

type EvidenceRole = (typeof MARKET_EVIDENCE_ROLES)[number];
export type CoverageProfileEntry = { sourceFamily: (typeof MARKET_SOURCE_FAMILIES)[number]; evidenceRole: EvidenceRole; relevant: true };
export type CoverageProfile = {
  verticalKey: string;
  profileKey: string;
  profileVersion: string;
  defaultAvailability: "unknown";
  defaultRightsState: "unknown";
  entries: readonly CoverageProfileEntry[];
};

/** Owned/private families are represented by the taxonomy, but excluded from global public profiles and tables. */
export const PRIVATE_ONLY_SOURCE_FAMILIES = ["owned_survey", "owned_support", "owned_crm", "owned_form"] as const;

export function defineCoverageProfile(input: {
  verticalKey: string;
  profileKey: string;
  profileVersion: string;
  entries: readonly { sourceFamily: string; evidenceRole: string; relevant: true }[];
}): CoverageProfile {
  const families = new Set<string>();
  const entries = input.entries.map((entry) => {
    const sourceFamily = marketSourceFamilySchema.parse(entry.sourceFamily);
    const evidenceRole = entry.evidenceRole as EvidenceRole;
    if (!["demand", "supply", "context"].includes(evidenceRole)) throw new Error("Private evidence roles cannot be registered in a global coverage profile");
    if (PRIVATE_ONLY_SOURCE_FAMILIES.includes(sourceFamily as (typeof PRIVATE_ONLY_SOURCE_FAMILIES)[number])) {
      throw new Error("Owned/private source families are not global public coverage surfaces");
    }
    const key = `${sourceFamily}:${evidenceRole}`;
    if (families.has(key)) throw new Error(`Duplicate coverage profile entry: ${key}`);
    families.add(key);
    return { sourceFamily, evidenceRole, relevant: true as const };
  });
  if (!/^[a-z][a-z0-9_-]{1,59}$/.test(input.verticalKey)) throw new Error("Invalid vertical key");
  if (!/^[a-z][a-z0-9_-]{1,59}$/.test(input.profileKey)) throw new Error("Invalid profile key");
  if (!input.profileVersion.trim() || input.profileVersion.length > 40) throw new Error("Invalid profile version");
  return { ...input, defaultAvailability: "unknown", defaultRightsState: "unknown", entries };
}

/** A configurable SaaS template only. Every provider's rights/availability remain unknown until reviewed. */
export function createSaasCoverageProfile(): CoverageProfile {
  return defineCoverageProfile({
    verticalKey: "saas",
    profileKey: "saas_public_surfaces",
    profileVersion: "1",
    entries: [
      { sourceFamily: "social", evidenceRole: "demand", relevant: true },
      { sourceFamily: "community_forum", evidenceRole: "demand", relevant: true },
      { sourceFamily: "developer", evidenceRole: "demand", relevant: true },
      { sourceFamily: "reviews", evidenceRole: "demand", relevant: true },
      { sourceFamily: "alternative_comparison", evidenceRole: "context", relevant: true },
      { sourceFamily: "video", evidenceRole: "demand", relevant: true },
      { sourceFamily: "first_party_company", evidenceRole: "supply", relevant: true },
      { sourceFamily: "launch_directory", evidenceRole: "context", relevant: true },
      { sourceFamily: "broad_web", evidenceRole: "context", relevant: true },
      { sourceFamily: "news_editorial", evidenceRole: "context", relevant: true },
      { sourceFamily: "commercial_enrichment", evidenceRole: "context", relevant: true },
      { sourceFamily: "search_intent", evidenceRole: "demand", relevant: true },
      { sourceFamily: "marketplace", evidenceRole: "context", relevant: true },
    ],
  });
}
