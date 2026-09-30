import "server-only";

import { z } from "zod";
import {
  evidenceMaturitySchema,
  organicIntelligenceFamilySchema,
  readinessDecisionStateSchema,
} from "../../../../src/server/modules/organic-intelligence/organic-intelligence.schemas";
import { createAdminServiceClient } from "./supabase";

export const ORGANIC_READINESS_FAMILIES = [
  { key: "public_market_intelligence", label: "Public Market Intelligence" },
  { key: "demand_opportunity", label: "Demand Opportunity" },
  { key: "company_competitor_intelligence", label: "Company / Competitor Intelligence" },
  { key: "trend_demand_drift", label: "Trend / Demand Drift" },
  { key: "geography_intelligence", label: "Geography Intelligence" },
  { key: "research_data_report", label: "Research / Data Report" },
] as const;

const countMapSchema = z.record(z.string(), z.number().int().nonnegative());
const candidateSchema = z.object({
  id: z.uuid(),
  publicIntelligenceId: z.uuid(),
  label: z.string().trim().min(2).max(160),
  family: organicIntelligenceFamilySchema,
  reviewState: z.enum(["candidate", "eligible", "review_required", "approved", "rejected", "stale", "merged"]),
  eligibilityState: readinessDecisionStateSchema,
  maturityState: evidenceMaturitySchema.nullable(),
  independentEpisodeCount: z.number().int().nonnegative().nullable(),
  uniqueAuthorCount: z.number().int().nonnegative().nullable(),
  sourceFamilyCount: z.number().int().nonnegative().nullable(),
  timeBucketCount: z.number().int().nonnegative().nullable(),
  duplicateRatio: z.number().min(0).max(1).nullable(),
  sourceConcentration: z.number().min(0).max(1).nullable(),
  viralEventConcentration: z.number().min(0).max(1).nullable(),
  firstObservedAt: z.iso.datetime().nullable(),
  lastObservedAt: z.iso.datetime().nullable(),
  freshnessState: z.enum(["fresh", "stale", "unknown"]).nullable(),
  truthState: z.enum(["confirmed", "needs_review", "unconfirmed", "unknown"]).nullable(),
  safetyState: z.enum(["approved", "blocked", "unknown"]).nullable(),
  searchConsolePriority: z.enum(["not_eligible", "search_opportunity", "provisional_signal", "standard_review", "unavailable"]).nullable(),
  blockerCodes: z.array(z.string().min(1).max(80)).max(200).nullable(),
  evaluatedAt: z.iso.datetime().nullable(),
  provenanceEpisodeRefs: z.array(z.uuid()).max(20),
}).strict();

const summarySchema = z.object({
  schemaVersion: z.literal(1),
  refreshedAt: z.iso.datetime(),
  sourcePolicyStates: countMapSchema,
  sourceFamilies: countMapSchema,
  topicStates: countMapSchema,
  publicEvidenceRecordCount: z.number().int().nonnegative(),
  verifiedEpisodeCount: z.number().int().nonnegative(),
  authorUnavailableCount: z.number().int().nonnegative(),
  episodeFamilies: countMapSchema,
  episodeFirstPublishedAt: z.iso.datetime().nullable(),
  episodeLatestObservedAt: z.iso.datetime().nullable(),
  candidateCount: z.number().int().nonnegative(),
  candidateReviewStates: countMapSchema,
  candidateEligibilityStates: countMapSchema,
  candidateFamilies: countMapSchema,
  maturityStates: countMapSchema,
  blockerDistribution: countMapSchema,
  staleCount: z.number().int().nonnegative(),
  mergedDuplicateCount: z.number().int().nonnegative(),
  averageSourceConcentration: z.number().min(0).max(1).nullable(),
  maximumViralEventConcentration: z.number().min(0).max(1).nullable(),
  lastEvaluatedAt: z.iso.datetime().nullable(),
  reviewEventCount: z.number().int().nonnegative(),
  candidates: z.array(candidateSchema).max(500),
}).strict();

export type OrganicReadinessCandidateRow = z.infer<typeof candidateSchema>;
export type OrganicReadinessStatus = {
  state: "available" | "empty" | "unavailable";
  source: string;
  detail: string;
  candidateCount: number | null;
  evaluatedAt: string | null;
  refreshedAt: string | null;
  range: string;
  publicationEnabled: false;
  summary: z.infer<typeof summarySchema> | null;
};

const sourceName = "Supabase · organic_public_intelligence_admin_summary";

function unavailable(detail: string): OrganicReadinessStatus {
  return {
    state: "unavailable",
    source: sourceName,
    detail,
    candidateCount: null,
    evaluatedAt: null,
    refreshedAt: null,
    range: "No candidate evaluation available",
    publicationEnabled: false,
    summary: null,
  };
}

function dateRange(summary: z.infer<typeof summarySchema>): string {
  if (!summary.episodeFirstPublishedAt || !summary.episodeLatestObservedAt) return "No approved public evidence window";
  return `${summary.episodeFirstPublishedAt.slice(0, 10)} – ${summary.episodeLatestObservedAt.slice(0, 10)} (UTC)`;
}

export async function getOrganicReadinessSourceStatus(): Promise<OrganicReadinessStatus> {
  const client = createAdminServiceClient();
  if (!client) return unavailable("The private production Supabase connection is unavailable. No source records are substituted.");

  const { data, error } = await client.rpc("organic_public_intelligence_admin_summary");
  if (error || !data) {
    return unavailable("The reviewed public-intelligence read model is not available. Apply and verify its forward migration before evaluating candidates.");
  }

  const parsed = summarySchema.safeParse(data);
  if (!parsed.success) return unavailable("The public-intelligence summary did not match its reviewed contract; candidate values are withheld.");

  const summary = parsed.data;
  const reviewedMeasurementPolicyCount = (summary.sourcePolicyStates.approved ?? 0) + (summary.sourcePolicyStates.restricted ?? 0);
  const state = summary.candidateCount > 0 || summary.publicEvidenceRecordCount > 0 ? "available" : "empty";
  const detail = state === "available"
    ? "Counts reflect currently approved public-source policy and the latest persisted SEO-2 evaluation."
    : reviewedMeasurementPolicyCount === 0
      ? "No source policy is approved for measurement. Production records remain excluded until rights, privacy, and independence are reviewed."
      : "No verified independent public evidence or evaluated candidates are currently available.";

  return {
    state,
    source: sourceName,
    detail,
    candidateCount: summary.candidateCount,
    evaluatedAt: summary.lastEvaluatedAt,
    refreshedAt: summary.refreshedAt,
    range: dateRange(summary),
    publicationEnabled: false,
    summary,
  };
}
