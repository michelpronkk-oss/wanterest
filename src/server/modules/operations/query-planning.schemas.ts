import { z } from "zod";

import { buyingIntentTypeSchema, type BuyingIntentType } from "../intelligence/demand-profile-v2.schemas";
import type { DemandProfileV2RoutingModel } from "../intelligence/demand-profile-v2.service";
import type { BusinessClassification } from "../intelligence/business-classification.schemas";
import type { JsonObject } from "../../db/database.helpers";
import type { SourceRoutingCostClass, SourceRoutingPlan, SourceRoutingPriority, SourceRoutingScanMode } from "./source-routing.schemas";

export const queryPlanningVersion = "query_planning_v2" as const;

export const demandSurfaceSchema = z.enum(["direct_product", "competitor_pain", "alternative_search", "category_demand", "job_demand", "pain_first", "feature_demand", "switching", "substitute_displacement", "commercial_pain"]);
export type DemandSurface = z.infer<typeof demandSurfaceSchema>;

export const queryFamilySchema = z.enum([
  "pain",
  "alternative_search",
  "switching",
  "recommendation",
  "comparison",
  "feature_requirement",
  "jtbd",
  "objection",
  "desired_outcome",
  "category_discovery",
]);
export type QueryFamily = z.infer<typeof queryFamilySchema>;

export { buyingIntentTypeSchema };
export type { BuyingIntentType };

export const queryPlanReasonCodeSchema = z.enum([
  "HIGH_SWITCHING_RELEVANCE",
  "HIGH_ALTERNATIVE_RELEVANCE",
  "KNOWN_COMPETITOR",
  "HIGH_CONFIDENCE_PAIN",
  "FEATURE_REQUIREMENT_MATCH",
  "JTBD_MATCH",
  "RECOMMENDATION_INTENT",
  "COMPARISON_INTENT",
  "SOURCE_STRONG_FOR_INTENT",
  "CATEGORY_FALLBACK",
  "LOW_PROFILE_CONFIDENCE",
  "GEO_DEPENDENT",
  "BUDGET_CONSTRAINED",
  "DUPLICATE_SUPPRESSED",
  "ALTERNATIVE_SOLUTION_MATCH",
  "DESIRED_OUTCOME_MATCH",
  "OBJECTION_MATCH",
  "SOURCE_QUERY_UNSUPPORTED",
  "DETECTED_COMPETITOR_CONFIDENCE",
]);
export type QueryPlanReasonCode = z.infer<typeof queryPlanReasonCodeSchema>;

export type QueryPlanQuery = {
  query_id: string;
  query_family: QueryFamily;
  demand_surface: DemandSurface;
  intent_type: BuyingIntentType;
  query_text: string;
  normalized_query: string;
  source_key: string;
  priority: SourceRoutingPriority;
  confidence: number;
  candidate_budget: number;
  reason_codes: QueryPlanReasonCode[];
  reason_summary: string;
  concept_keys: string[];
  competitor_refs: string[];
  alternative_refs: string[];
  geo_context: string | null;
  language_context: string | null;
  cost_hint: SourceRoutingCostClass;
  metadata: JsonObject;
};

export type QueryPlanSource = {
  source_key: string;
  priority: SourceRoutingPriority;
  candidate_budget: number;
  query_budget: number;
  queries: QueryPlanQuery[];
  excluded_query_families: QueryFamily[];
  reason_codes: QueryPlanReasonCode[];
  confidence: number;
};

export type QueryPlanDiagnostics = {
  source_count: number;
  query_count: number;
  query_family_distribution: Record<string, number>;
  demand_surface_coverage: Record<string, "covered" | "uncovered">;
  queries_per_source: Record<string, number>;
  candidate_budget_per_source: Record<string, number>;
  suppressed_duplicate_count: number;
  low_confidence: boolean;
  messages: string[];
};

export type QueryPlan = {
  version: typeof queryPlanningVersion;
  product_id: string;
  demand_profile_version: string | null;
  source_routing_version: SourceRoutingPlan["version"];
  scan_mode: SourceRoutingScanMode;
  overall_confidence: number;
  source_plans: QueryPlanSource[];
  diagnostics: QueryPlanDiagnostics;
};

export type QueryPlanningInput = {
  classification: BusinessClassification | null;
  demandProfile: DemandProfileV2RoutingModel | null;
  sourceRoutingPlan: SourceRoutingPlan;
  scanMode: SourceRoutingScanMode;
  /** Central plan cap applied after per-source diversity selection. */
  maxQueries?: number;
};
