import { z } from "zod";

import { jsonObjectSchema } from "../../db/database.helpers";

export const experimentTypeSchema = z.enum([
  "messaging_test", "cta_test", "landing_page_test", "positioning_test", "offer_test", "onboarding_test",
]);
export const experimentMetricSchema = z.enum([
  "cta_click", "signup_started", "signup_completed", "demo_requested", "checkout_started", "purchase_completed",
]);
export const experimentStatusSchema = z.enum(["draft", "ready", "running", "paused", "completed", "canceled"]);
export const experimentEventTypeSchema = z.enum([
  "exposure", "cta_click", "signup_started", "signup_completed", "demo_requested", "checkout_started", "purchase_completed",
]);
const experimentEventMetadataSchema = z.object({
  pagePath: z.string().trim().max(500).optional(),
  targetKey: z.string().trim().max(200).optional(),
  source: z.string().trim().max(120).optional(),
  campaign: z.string().trim().max(200).optional(),
}).strict();

export const createExperimentSchema = z.object({
  workspaceId: z.string().uuid(),
  productId: z.string().uuid(),
  actionId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  hypothesis: z.string().trim().min(1).max(2_000),
  experimentType: experimentTypeSchema,
  primaryMetric: experimentMetricSchema,
  targetPagePath: z.string().trim().min(1).max(500).optional(),
  targetKey: z.string().trim().min(1).max(200).optional(),
  minSampleSize: z.number().int().min(1).max(1_000_000).default(100),
  createdBy: z.string().uuid(),
  engineVersionId: z.string().uuid().nullable().optional(),
});

export const createExperimentVariantSchema = z.object({
  workspaceId: z.string().uuid(),
  experimentId: z.string().uuid(),
  variantKey: z.string().regex(/^[a-z][a-z0-9_-]{0,80}$/),
  label: z.string().trim().min(1).max(200),
  content: z.json(),
  target: jsonObjectSchema.default({}),
  allocationWeight: z.number().int().min(1).max(10_000),
  isControl: z.boolean().default(false),
  sourceActionVariantId: z.string().uuid().nullable().optional(),
});

export const experimentTransitionSchema = z.object({
  workspaceId: z.string().uuid(),
  experimentId: z.string().uuid(),
  toStatus: experimentStatusSchema,
  actorUserId: z.string().uuid().optional(),
});

export const assignmentSchema = z.object({
  workspaceId: z.string().uuid(),
  experimentId: z.string().uuid(),
  subjectKey: z.string().trim().min(1).max(200),
});

export const publicExperimentEventSchema = z.object({
  publicToken: z.string().trim().min(20).max(240),
  experimentId: z.string().uuid(),
  eventId: z.string().trim().min(1).max(240),
  eventType: experimentEventTypeSchema,
  subjectKey: z.string().trim().min(1).max(200),
  variantId: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  metadata: experimentEventMetadataSchema.default({}),
});

export const experimentResultsQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  experimentId: z.string().uuid(),
});

export type CreateExperimentInput = z.infer<typeof createExperimentSchema>;
export type CreateExperimentVariantInput = z.infer<typeof createExperimentVariantSchema>;
export type ExperimentTransitionInput = z.infer<typeof experimentTransitionSchema>;
export type AssignmentInput = z.infer<typeof assignmentSchema>;
export type PublicExperimentEventInput = z.infer<typeof publicExperimentEventSchema>;
