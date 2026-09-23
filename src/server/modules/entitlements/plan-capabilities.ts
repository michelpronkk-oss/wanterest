import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types";
import type { ScanMode } from "../operations/product-demand-scan.schemas";

/** Wanterest-owned plans. Billing providers must map into this union. */
export const internalPlanSchema = ["free", "pro", "growth"] as const;
export type InternalPlan = (typeof internalPlanSchema)[number];
export type BillingCadence = "monthly" | "annual" | null;

export type ScanProfile =
  | "onboarding"
  | "manual_standard"
  | "manual_deep"
  | "monitoring"
  | "scheduled_deep_discovery";

export type ScanBudget = {
  maxSourcesPerScan: number;
  maxQueriesPerScan: number;
  maxCandidatesPerScan: number;
  maxLlmEvaluationsPerScan: number;
  enabled: boolean;
};

export type ProviderCostClass = "paid_request" | "quota_sensitive" | "low_cost";
export type ProviderKey =
  | "x"
  | "github"
  | "gitlab"
  | "hacker-news"
  | "bluesky"
  | "product-hunt"
  | "stack-exchange"
  | "youtube"
  | "public-web"
  | "g2"
  | "trustpilot";

export type ProviderBudget = {
  costClass: ProviderCostClass;
  maxQueriesPerCycle: number;
  maxQueriesPerScan: number;
  maxPagesPerQuery: number;
  maxCandidatesPerQuery: number;
  maxCandidatesPerCycle: number;
  enabledForMonitoring: boolean;
  enabledForDeepDiscovery: boolean;
  maxVideosPerQuery?: number;
  maxCommentThreadsPerCycle?: number;
  maxCommentsPerCycle?: number;
};

export type PlanCapabilities = {
  plan: InternalPlan;
  billingCadence: BillingCadence;
  products: { maxProducts: number };
  monitoring: {
    enabled: boolean;
    monitoringIntervalMinutes: number | null;
    targetCyclesPerDay: number;
    deepDiscoveryIntervalDays: number | null;
  };
  manual: { manualScansPerMonth: number };
  history: { driftHistoryDays: number };
  geography: {
    enabled: boolean;
    historyDays: number;
    trendEnabled: boolean;
    maxMarkets: number;
    countryDrilldown: boolean;
    regionDrilldown: boolean;
    regionalHistoryDays: number;
    comparisonEnabled: boolean;
  };
  experiments: { maxActiveExperiments: number };
  team: { seats: number };
  scanProfiles: Record<ScanProfile, ScanBudget>;
  providerBudgets: Record<ProviderKey, ProviderBudget>;
};

const providerBudgets: Record<ProviderKey, ProviderBudget> = {
  x: {
    costClass: "paid_request",
    maxQueriesPerCycle: 1,
    maxQueriesPerScan: 2,
    maxPagesPerQuery: 1,
    maxCandidatesPerQuery: 10,
    maxCandidatesPerCycle: 10,
    enabledForMonitoring: true,
    enabledForDeepDiscovery: true,
  },
  github: {
    costClass: "quota_sensitive",
    maxQueriesPerCycle: 2,
    maxQueriesPerScan: 4,
    maxPagesPerQuery: 3,
    maxCandidatesPerQuery: 12,
    maxCandidatesPerCycle: 24,
    enabledForMonitoring: true,
    enabledForDeepDiscovery: true,
  },
  gitlab: {
    costClass: "quota_sensitive",
    maxQueriesPerCycle: 2,
    maxQueriesPerScan: 4,
    maxPagesPerQuery: 3,
    maxCandidatesPerQuery: 12,
    maxCandidatesPerCycle: 24,
    enabledForMonitoring: true,
    enabledForDeepDiscovery: true,
  },
  "hacker-news": {
    costClass: "low_cost",
    maxQueriesPerCycle: 2,
    maxQueriesPerScan: 5,
    maxPagesPerQuery: 3,
    maxCandidatesPerQuery: 10,
    maxCandidatesPerCycle: 20,
    enabledForMonitoring: true,
    enabledForDeepDiscovery: true,
  },
  bluesky: {
    costClass: "low_cost",
    maxQueriesPerCycle: 2,
    maxQueriesPerScan: 5,
    maxPagesPerQuery: 1,
    maxCandidatesPerQuery: 10,
    maxCandidatesPerCycle: 20,
    enabledForMonitoring: true,
    enabledForDeepDiscovery: true,
  },
  "product-hunt": {
    costClass: "quota_sensitive",
    maxQueriesPerCycle: 1,
    maxQueriesPerScan: 2,
    maxPagesPerQuery: 1,
    maxCandidatesPerQuery: 10,
    maxCandidatesPerCycle: 10,
    enabledForMonitoring: true,
    enabledForDeepDiscovery: true,
  },
  "stack-exchange": {
    costClass: "quota_sensitive",
    maxQueriesPerCycle: 1,
    maxQueriesPerScan: 3,
    maxPagesPerQuery: 2,
    maxCandidatesPerQuery: 10,
    maxCandidatesPerCycle: 10,
    enabledForMonitoring: true,
    enabledForDeepDiscovery: true,
  },
  youtube: {
    costClass: "quota_sensitive",
    maxQueriesPerCycle: 1,
    maxQueriesPerScan: 2,
    maxPagesPerQuery: 1,
    maxCandidatesPerQuery: 3,
    maxCandidatesPerCycle: 3,
    enabledForMonitoring: true,
    enabledForDeepDiscovery: true,
    maxVideosPerQuery: 3,
    maxCommentThreadsPerCycle: 3,
    maxCommentsPerCycle: 15,
  },
  "public-web": {
    costClass: "quota_sensitive",
    maxQueriesPerCycle: 1,
    maxQueriesPerScan: 3,
    maxPagesPerQuery: 1,
    maxCandidatesPerQuery: 10,
    maxCandidatesPerCycle: 10,
    enabledForMonitoring: true,
    enabledForDeepDiscovery: true,
  },
  g2: {
    costClass: "quota_sensitive",
    maxQueriesPerCycle: 1,
    maxQueriesPerScan: 2,
    maxPagesPerQuery: 1,
    maxCandidatesPerQuery: 10,
    maxCandidatesPerCycle: 10,
    enabledForMonitoring: true,
    enabledForDeepDiscovery: true,
  },
  trustpilot: {
    costClass: "quota_sensitive",
    maxQueriesPerCycle: 1,
    maxQueriesPerScan: 2,
    maxPagesPerQuery: 1,
    maxCandidatesPerQuery: 10,
    maxCandidatesPerCycle: 10,
    enabledForMonitoring: true,
    enabledForDeepDiscovery: true,
  },
};

function budget(maxSourcesPerScan: number, maxQueriesPerScan: number, maxCandidatesPerScan: number, maxLlmEvaluationsPerScan: number, enabled = true): ScanBudget {
  return { maxSourcesPerScan, maxQueriesPerScan, maxCandidatesPerScan, maxLlmEvaluationsPerScan, enabled };
}

function profiles(plan: InternalPlan): Record<ScanProfile, ScanBudget> {
  if (plan === "free") {
    return {
      onboarding: budget(4, 6, 30, 20),
      manual_standard: budget(3, 4, 20, 15),
      manual_deep: budget(3, 4, 20, 15, false),
      monitoring: budget(0, 0, 0, 0, false),
      scheduled_deep_discovery: budget(0, 0, 0, 0, false),
    };
  }
  if (plan === "pro") {
    return {
      onboarding: budget(4, 6, 30, 20),
      manual_standard: budget(4, 5, 30, 20),
      manual_deep: budget(6, 10, 60, 40),
      monitoring: budget(4, 5, 30, 20),
      scheduled_deep_discovery: budget(6, 10, 60, 40),
    };
  }
  return {
    onboarding: budget(4, 6, 30, 20),
    manual_standard: budget(6, 8, 50, 35),
    manual_deep: budget(8, 12, 100, 70),
    monitoring: budget(6, 8, 50, 35),
    scheduled_deep_discovery: budget(8, 12, 100, 70),
  };
}

function createCapabilities(plan: InternalPlan, billingCadence: BillingCadence = null): PlanCapabilities {
  const isFree = plan === "free";
  const isPro = plan === "pro";
  return {
    plan,
    billingCadence,
    products: { maxProducts: isFree ? 1 : isPro ? 3 : 10 },
    monitoring: {
      enabled: !isFree,
      monitoringIntervalMinutes: isFree ? null : isPro ? 360 : 120,
      targetCyclesPerDay: isFree ? 0 : isPro ? 4 : 12,
      deepDiscoveryIntervalDays: isFree ? null : isPro ? 7 : 3,
    },
    manual: { manualScansPerMonth: isFree ? 3 : isPro ? 30 : 100 },
    history: { driftHistoryDays: isFree ? 0 : isPro ? 30 : 90 },
    geography: {
      enabled: true,
      historyDays: isFree ? 0 : isPro ? 30 : 90,
      trendEnabled: !isFree,
      maxMarkets: isFree ? 3 : isPro ? 6 : 10,
      countryDrilldown: !isFree,
      regionDrilldown: !isFree,
      regionalHistoryDays: isFree ? 0 : isPro ? 30 : 90,
      comparisonEnabled: isPro || plan === "growth",
    },
    experiments: { maxActiveExperiments: isFree ? 0 : isPro ? 2 : 10 },
    team: { seats: isFree || isPro ? 1 : 3 },
    scanProfiles: profiles(plan),
    providerBudgets,
  };
}

export const PLAN_CAPABILITIES: Readonly<Record<InternalPlan, PlanCapabilities>> = {
  free: createCapabilities("free"),
  pro: createCapabilities("pro"),
  growth: createCapabilities("growth"),
};

export type BillingState = {
  internalPlan?: string | null;
  status?: string | null;
  billingCadence?: BillingCadence;
};

const paidStatuses = new Set(["active", "trialing", "past_due", "canceling"]);

/** Maps normalized billing state to a Wanterest plan; provider IDs never enter this function. */
export function resolveInternalPlan(state: BillingState | null | undefined): InternalPlan {
  if (!state || !state.internalPlan || (state.status !== undefined && state.status !== null && !paidStatuses.has(state.status))) return "free";
  return state.internalPlan === "pro" || state.internalPlan === "growth" ? state.internalPlan : "free";
}

export function getPlanCapabilities(plan: InternalPlan, billingCadence: BillingCadence = null): PlanCapabilities {
  const base = PLAN_CAPABILITIES[plan];
  return billingCadence === null ? base : { ...base, billingCadence };
}

export function scanProfileForMode(mode: ScanMode): ScanProfile {
  if (mode === "onboarding" || mode === "baseline") return "onboarding";
  if (mode === "manual" || mode === "manual_refresh") return "manual_standard";
  if (mode === "manual_deep") return "manual_deep";
  if (mode === "deep" || mode === "deep_refresh") return "scheduled_deep_discovery";
  return "monitoring";
}

export function getScanBudget(capabilities: PlanCapabilities, profile: ScanProfile): ScanBudget {
  return capabilities.scanProfiles[profile];
}

export function getProviderBudget(capabilities: PlanCapabilities, provider: ProviderKey, profile: ScanProfile): ProviderBudget {
  const configured = capabilities.providerBudgets[provider];
  const base = provider === "x" && capabilities.plan === "growth"
    ? { ...configured, maxQueriesPerCycle: 2, maxQueriesPerScan: 4, maxCandidatesPerCycle: 20 }
    : configured;
  const monitoring = profile === "monitoring";
  const deep = profile === "manual_deep" || profile === "scheduled_deep_discovery";
  const queryCap = monitoring ? base.maxQueriesPerCycle : deep ? Math.min(base.maxQueriesPerScan, base.maxQueriesPerCycle * 2) : base.maxQueriesPerScan;
  return {
    ...base,
    maxQueriesPerCycle: queryCap,
    maxCandidatesPerCycle: monitoring ? base.maxCandidatesPerCycle : base.maxCandidatesPerQuery * queryCap,
    enabledForMonitoring: monitoring ? base.enabledForMonitoring : base.enabledForMonitoring,
    enabledForDeepDiscovery: deep ? base.enabledForDeepDiscovery : base.enabledForDeepDiscovery,
    ...(provider === "youtube" && base.maxCommentThreadsPerCycle !== undefined ? { maxCommentThreadsPerCycle: monitoring ? base.maxCommentThreadsPerCycle : base.maxCommentThreadsPerCycle * 2 } : {}),
    ...(provider === "youtube" && base.maxCommentsPerCycle !== undefined ? { maxCommentsPerCycle: monitoring ? base.maxCommentsPerCycle : base.maxCommentsPerCycle * 2 } : {}),
  };
}

type SubscriptionPlanRow = Pick<Database["public"]["Tables"]["subscriptions"]["Row"], "internal_plan" | "status" | "billing_interval">;
type Client = SupabaseClient<Database>;

/** Runtime resolver used by jobs and server actions. A missing subscription is Free. */
export async function resolveWorkspaceCapabilities(client: Client, workspaceId: string): Promise<PlanCapabilities> {
  const result = await client
    .from("subscriptions")
    .select("internal_plan, status, billing_interval")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  const row = result.data as SubscriptionPlanRow | null;
  const cadence: BillingCadence = row?.billing_interval === "monthly" || row?.billing_interval === "annual" ? row.billing_interval : null;
  return getPlanCapabilities(resolveInternalPlan(row), cadence);
}

export function sourceKeyForProviderBudget(sourceKey: string): ProviderKey | null {
  return (Object.keys(providerBudgets) as ProviderKey[]).includes(sourceKey as ProviderKey) ? sourceKey as ProviderKey : null;
}
