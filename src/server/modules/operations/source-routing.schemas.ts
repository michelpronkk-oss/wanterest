import type { BusinessClassification } from "../intelligence/business-classification.schemas";
import type { DemandProfileV2RoutingModel } from "../intelligence/demand-profile-v2.service";

export const sourceRoutingVersion = "source_routing_v1" as const;

export type SourceRoutingScanMode = "onboarding" | "baseline" | "manual" | "manual_refresh" | "scheduled" | "monitoring" | "intelligence_cycle" | "deep" | "deep_refresh";
export type SourceRoutingPriority = "very_high" | "high" | "medium" | "low" | "off";
export type SourceRoutingCostClass = "free_low" | "free_rate_limited" | "paid_low" | "paid_medium" | "paid_high";
export type SourceRoutingHealthStatus = "healthy" | "degraded" | "blocked" | "unknown";
export type SourceRoutingAvailabilityStatus = "available" | "not_configured" | "paused" | "disabled" | "unavailable";

export type SourceRoutingReasonCode =
  | "BUSINESS_TYPE_MATCH"
  | "DEVELOPER_AUDIENCE_MATCH"
  | "TECHNICAL_DISCUSSION_MATCH"
  | "SWITCHING_INTENT_MATCH"
  | "RECOMMENDATION_INTENT_MATCH"
  | "COMPARISON_INTENT_MATCH"
  | "CONSUMER_DISCUSSION_MATCH"
  | "ECOMMERCE_MATCH"
  | "LOCAL_COVERAGE_WEAK"
  | "HIGH_LOCATION_DEPENDENCY"
  | "SOURCE_PAUSED"
  | "SOURCE_NOT_CONFIGURED"
  | "SOURCE_UNHEALTHY"
  | "PAID_SOURCE_BUDGET_LIMIT"
  | "LOW_RELEVANCE"
  | "PROFILE_CONFIDENCE_LOW";

export type SourceRoutingCapabilityProfile = {
  sourceKey: string;
  supports_software_demand: number;
  supports_consumer_demand: number;
  supports_developer_demand: number;
  supports_ecommerce_demand: number;
  supports_local_demand: number;
  supports_switching_intent: number;
  supports_recommendation_intent: number;
  supports_problem_discussion: number;
  supports_feature_discussion: number;
  supports_competitor_comparison: number;
  supports_long_form_context: number;
  supports_replies: number;
  supports_recency: number;
  cost_class: SourceRoutingCostClass;
};

export type SourceRoutingSourceState = {
  sourceKey: string;
  configured: boolean;
  controlState: string;
  healthStatus?: SourceRoutingHealthStatus;
  reason?: string | null;
};

export type SourceRoutingSafetyCap = {
  maxCandidates?: number;
  maxPages?: number;
};

export type SourceRoutingInput = {
  productId: string;
  classification: BusinessClassification | null;
  demandProfile: DemandProfileV2RoutingModel | null;
  sourceStates: SourceRoutingSourceState[];
  scanMode: SourceRoutingScanMode;
  totalCandidateBudget: number;
  maxSources?: number;
  safetyCaps?: Record<string, SourceRoutingSafetyCap>;
};

export type SourceRoutingRoute = {
  source_key: string;
  enabled_for_product: boolean;
  priority: SourceRoutingPriority;
  relevance_score: number;
  budget_weight: number;
  max_candidates: number;
  max_pages: number;
  reason_codes: SourceRoutingReasonCode[];
  reason_summary: string;
  confidence: number;
  cost_class: SourceRoutingCostClass;
  health_status: SourceRoutingHealthStatus;
  availability_status: SourceRoutingAvailabilityStatus;
};

export type SourceRoutingExcludedSource = {
  source_key: string;
  reason_codes: SourceRoutingReasonCode[];
  reason: string;
};

export type SourceRoutingDiagnostics = {
  selected_sources: string[];
  operational_exclusions: SourceRoutingExcludedSource[];
  missing_source_capabilities: string[];
  budget_total: number;
  executable_budget: number;
  messages: string[];
};

export type SourceRoutingPlan = {
  version: typeof sourceRoutingVersion;
  product_id: string;
  classification_version: string | null;
  demand_profile_version: string | null;
  overall_coverage_confidence: number;
  coverage_status: "strong" | "good" | "limited" | "weak" | "unsupported";
  routes: SourceRoutingRoute[];
  excluded_sources: SourceRoutingExcludedSource[];
  diagnostics: SourceRoutingDiagnostics;
};
