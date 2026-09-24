import { z } from "zod";

import { AppError } from "../../lib/errors";
export const boundedReplaySchema = z.object({ limit: z.number().int().min(1).max(500).default(100), cursor: z.string().max(500).optional(), dryRun: z.boolean().default(false) });
export type BoundedReplayInput = z.infer<typeof boundedReplaySchema>;
export type ReplayCommand = "replayRawSourceItem" | "replayConversationAnalysis" | "replayProductMatch" | "replaySemanticShadowReasoning" | "replayDemandIntelligence" | "replayActions" | "reprocessBillingWebhook" | "reconcileBillingSubscription" | "recomputeExperimentResults";
export type ReplayHandler<T = unknown> = (input: BoundedReplayInput) => Promise<T>;
export async function runBoundedReplay<T>(command: ReplayCommand, input: unknown, handler: ReplayHandler<T>) { const parsed = boundedReplaySchema.safeParse(input); if (!parsed.success) throw new AppError("VALIDATION_ERROR", `Invalid ${command} request.`, 422, { issues: parsed.error.issues }); return handler(parsed.data); }
export const replayCommands: ReplayCommand[] = ["replayRawSourceItem", "replayConversationAnalysis", "replayProductMatch", "replaySemanticShadowReasoning", "replayDemandIntelligence", "replayActions", "reprocessBillingWebhook", "reconcileBillingSubscription", "recomputeExperimentResults"];
export const replayRawSourceItem = <T>(input: unknown, handler: ReplayHandler<T>) => runBoundedReplay("replayRawSourceItem", input, handler);
export const replayConversationAnalysis = <T>(input: unknown, handler: ReplayHandler<T>) => runBoundedReplay("replayConversationAnalysis", input, handler);
export const replayProductMatch = <T>(input: unknown, handler: ReplayHandler<T>) => runBoundedReplay("replayProductMatch", input, handler);
export const replaySemanticShadowReasoning = <T>(input: unknown, handler: ReplayHandler<T>) => runBoundedReplay("replaySemanticShadowReasoning", input, handler);
export const replayDemandIntelligence = <T>(input: unknown, handler: ReplayHandler<T>) => runBoundedReplay("replayDemandIntelligence", input, handler);
export const replayActions = <T>(input: unknown, handler: ReplayHandler<T>) => runBoundedReplay("replayActions", input, handler);
export const reprocessBillingWebhook = <T>(input: unknown, handler: ReplayHandler<T>) => runBoundedReplay("reprocessBillingWebhook", input, handler);
export const reconcileBillingSubscription = <T>(input: unknown, handler: ReplayHandler<T>) => runBoundedReplay("reconcileBillingSubscription", input, handler);
export const recomputeExperimentResults = <T>(input: unknown, handler: ReplayHandler<T>) => runBoundedReplay("recomputeExperimentResults", input, handler);
