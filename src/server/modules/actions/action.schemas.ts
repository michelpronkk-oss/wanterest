import { z } from "zod";
import type { Json } from "../../db/database.helpers";

export const actionTypeSchema = z.enum([
  "messaging_change", "landing_page", "positioning_change", "offer_hypothesis",
  "onboarding_change", "comparison_page", "content_angle", "campaign_angle",
  "product_research",
]);
export type ActionType = z.infer<typeof actionTypeSchema>;

// concept_gap/concept_drift are Layer 9C's persisted, lifecycle-verified basis
// types (docs/architecture.md Section 18). Additive; existing trigger types
// and rows are unchanged.
export const actionTriggerTypeSchema = z.enum(["demand_gap", "demand_drift", "demand_snapshot", "signal", "concept_gap", "concept_drift"]);
export type ActionTriggerType = z.infer<typeof actionTriggerTypeSchema>;

/**
 * Layer 9B read-only label (never persisted, never changes the stored Action):
 * with DOWNSTREAM_INTELLIGENCE_V2_ENABLED off, currentness isn't evaluated at
 * all. With it on, none of 9B's existing trigger types (demand_gap, demand_drift,
 * demand_snapshot, signal) carry a lifecycle-verified Stage 2G concept basis —
 * that arrives with Layer 9C's concept-based trigger type — so every existing
 * Action reads as "not_verified" until then. See docs/architecture.md §17.
 */
export type ActionBasisLifecycleStatus = "not_applicable" | "not_verified";

export function actionBasisLifecycleStatus(downstreamIntelligenceV2Enabled: boolean): ActionBasisLifecycleStatus {
  return downstreamIntelligenceV2Enabled ? "not_verified" : "not_applicable";
}

/**
 * Layer 9B: with the flag on, generateActionsForScan must not generate from any
 * legacy trigger (gap, drift, snapshot fallback, geography) — none carries a
 * lifecycle-verified concept basis. Pure so the gate itself is directly testable
 * without mocking Supabase; action.orchestration.ts returns immediately when this
 * is non-null, before any gap/drift/snapshot/geography read.
 */
export const NO_LIFECYCLE_VERIFIED_BASIS_WARNING = "no_lifecycle_verified_basis" as const;

export function legacyActionGenerationPauseReason(downstreamIntelligenceV2Enabled: boolean): typeof NO_LIFECYCLE_VERIFIED_BASIS_WARNING | null {
  return downstreamIntelligenceV2Enabled ? NO_LIFECYCLE_VERIFIED_BASIS_WARNING : null;
}
// Layer 10 adds `expired` (system-only: the settled canonical selector found no
// eligible basis). See docs/architecture.md Section 21.
export const actionStatusSchema = z.enum(["proposed", "approved", "in_progress", "completed", "dismissed", "superseded", "expired"]);
export type ActionStatus = z.infer<typeof actionStatusSchema>;
export const actionVariantStatusSchema = z.enum(["generated", "selected", "rejected", "archived"]);
export type ActionVariantStatus = z.infer<typeof actionVariantStatusSchema>;
export const actionFeedbackTypeSchema = z.enum([
  "useful", "not_useful", "too_generic", "not_relevant", "already_done",
  "saved", "approved", "dismissed", "completed",
]);
export type ActionFeedbackType = z.infer<typeof actionFeedbackTypeSchema>;
export const actionEventTypeSchema = z.enum(["approved", "dismissed", "started", "completed", "superseded", "regenerated", "expired", "revalidated"]);
export type ActionEventType = z.infer<typeof actionEventTypeSchema>;

export const digestTypeSchema = z.enum(["daily", "weekly"]);
export type DigestType = z.infer<typeof digestTypeSchema>;
export const digestStatusSchema = z.enum(["materialized", "sent", "superseded"]);
export type DigestStatus = z.infer<typeof digestStatusSchema>;
export const digestItemTypeSchema = z.enum(["signal", "theme", "gap", "drift", "action"]);
export type DigestItemType = z.infer<typeof digestItemTypeSchema>;

export const businessHypothesisSchema = z.object({
  observation: z.string().trim().min(1).max(2_000),
  hypothesis: z.string().trim().min(1).max(2_000),
  target: z.string().trim().min(1).max(500),
  metric: z.string().trim().min(1).max(500),
});
export type BusinessHypothesis = z.infer<typeof businessHypothesisSchema>;

const objectContent = z.record(z.string(), z.json());
const messagingContent = z.object({
  headline: z.string().trim().min(1).max(500),
  subheadline: z.string().trim().min(1).max(1_000),
  cta: z.string().trim().min(1).max(200),
});
const landingPageContent = z.object({
  angle: z.string().trim().min(1).max(500),
  headline: z.string().trim().min(1).max(500),
  problemStatement: z.string().trim().min(1).max(1_000),
  proofPoints: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
  cta: z.string().trim().min(1).max(200),
});
const onboardingContent = z.object({
  message: z.string().trim().min(1).max(1_000),
  stepContext: z.string().trim().min(1).max(500),
});
const comparisonContent = z.object({
  positioningAngle: z.string().trim().min(1).max(500),
  comparisonFraming: z.string().trim().min(1).max(1_000),
});
const angleContent = z.object({
  angle: z.string().trim().min(1).max(1_000),
  audience: z.string().trim().min(1).max(500),
  proof: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
});

export type VariantContent = Record<string, Json>;

export function parseVariantContent(actionType: ActionType, value: unknown): VariantContent {
  const schema = actionType === "messaging_change" || actionType === "positioning_change"
    ? messagingContent
    : actionType === "landing_page"
      ? landingPageContent
      : actionType === "onboarding_change"
        ? onboardingContent
        : actionType === "comparison_page"
          ? comparisonContent
          : actionType === "content_angle" || actionType === "campaign_angle"
            ? angleContent
            : objectContent;
  return schema.parse(value) as VariantContent;
}

export const actionGenerationInputSchema = z.object({
  workspaceId: z.string().uuid(),
  productId: z.string().uuid(),
  productName: z.string().trim().min(1).max(200),
  triggerType: actionTriggerTypeSchema,
  triggerId: z.string().uuid(),
  triggerEvidenceNodeId: z.string().uuid(),
  triggerConceptKey: z.string().trim().min(1).max(300),
  /** Layer 10: concept_gap/concept_drift only — the basis row's clustering_version (canonical concept identity). */
  triggerClusteringVersion: z.string().trim().min(1).max(120).optional(),
  conceptLabel: z.string().trim().min(1).max(500),
  targetKey: z.string().trim().min(1).max(200),
  marketWeight: z.number().min(0).max(1).default(0),
  gapScore: z.number().min(0).max(1).default(0),
  driftStrength: z.number().min(0).max(1).default(0),
  intentStrength: z.number().min(0).max(1).default(0),
  opportunityScore: z.number().min(0).max(1).default(0),
  evidenceStrength: z.number().min(0).max(1).default(0),
  confidence: z.number().min(0).max(1),
  freshness: z.number().min(0).max(1).default(1),
  sampleSize: z.number().int().nonnegative().default(0),
  sampleQuality: z.enum(["insufficient_data", "low_confidence", "normal", "high_confidence"]),
  driftDirection: z.enum(["rising", "cooling", "stable", "insufficient_data"]).optional(),
  driftSignificance: z.enum(["insufficient", "weak", "notable", "strong"]).optional(),
  positioningWeight: z.number().min(0).max(1).default(0),
  highIntentShare: z.number().min(0).max(1).default(0),
  specificity: z.number().min(0).max(1).default(0),
  buyerLanguage: z.array(z.string()).max(10).default([]),
  geoContext: z.object({
    market: z.string().trim().min(1).max(160),
    topTheme: z.string().trim().min(1).max(180).nullable(),
    trendPercentage: z.number().nullable(),
    sampleSize: z.number().int().nonnegative(),
  }).optional(),
  supportingEvidence: z.array(z.string().uuid()).max(50).default([]),
  actionEngineVersionId: z.string().uuid().optional(),
});
export type ActionGenerationInput = z.infer<typeof actionGenerationInputSchema>;

export const actionListFiltersSchema = z.object({
  status: actionStatusSchema.optional(),
  actionType: actionTypeSchema.optional(),
  triggerType: actionTriggerTypeSchema.optional(),
  minimumPriority: z.number().min(0).max(1).optional(),
  stale: z.boolean().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Optional server-side cap for compact surfaces such as the dashboard inbox. */
  limit: z.number().int().positive().max(100).optional(),
});
export type ActionListFilters = z.infer<typeof actionListFiltersSchema>;

export const actionFeedbackInputSchema = z.object({
  workspaceId: z.string().uuid(),
  productId: z.string().uuid(),
  actionId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  feedbackType: actionFeedbackTypeSchema,
  reason: z.string().trim().min(1).max(1_000).optional(),
  metadata: z.record(z.string(), z.json()).default({}),
});

export const digestBuildInputSchema = z.object({
  workspaceId: z.string().uuid(),
  productId: z.string().uuid().nullable().optional(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  digestType: digestTypeSchema,
  renderVersion: z.string().trim().min(1).max(120),
  engineVersionId: z.string().uuid().nullable().optional(),
});
export type DigestBuildInput = z.infer<typeof digestBuildInputSchema>;

export function clampAction(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/** Layer 10: open concept-Action workflow states (one per canonical concept, DB-enforced). */
export const OPEN_ACTION_STATUSES = ["proposed", "approved", "in_progress"] as const;
export const CONCEPT_ACTION_TRIGGER_TYPES = ["concept_gap", "concept_drift"] as const;
export type ConceptActionTriggerType = (typeof CONCEPT_ACTION_TRIGGER_TYPES)[number];

export function isConceptTriggerType(value: string): value is ConceptActionTriggerType {
  return value === "concept_gap" || value === "concept_drift";
}

export function isOpenActionStatus(value: string): value is (typeof OPEN_ACTION_STATUSES)[number] {
  return value === "proposed" || value === "approved" || value === "in_progress";
}

/** Layer 10: approval policy is always a human decision; no autonomy. */
export const ACTION_APPROVAL_POLICY = "human_required_v1" as const;
/** Layer 10: Wanterest proposes; the human executes. Never "executed by Wanterest". */
export const ACTION_EXECUTION_MODE = "manual" as const;

/** Human-initiated transitions. `expired`/`superseded` are server-owned only. */
export const userActionTransitionSchema = z.enum(["approved", "in_progress", "completed", "dismissed"]);
export type UserActionTransition = z.infer<typeof userActionTransitionSchema>;

/**
 * Layer 10 browser contract: the browser sends only the Action id, the desired
 * transition and an optional note. A workspace id is never accepted — scope is
 * derived server-side from the Action itself (docs/architecture.md Section 21).
 */
export const actionTransitionRequestSchema = z.object({
  actionId: z.string().uuid(),
  toStatus: userActionTransitionSchema,
  note: z.string().trim().min(1).max(1_000).optional(),
  /** Layer 11: when the change went live (required to complete an Action measured by a running experiment). */
  liveSince: z.string().datetime({ offset: true }).optional(),
}).strict();
export type ActionTransitionRequest = z.infer<typeof actionTransitionRequestSchema>;
