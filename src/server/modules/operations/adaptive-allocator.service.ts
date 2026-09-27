import "server-only";

import { adaptiveAllocatorMode, type AdaptiveAllocatorMode } from "./adaptive-allocator.config";
import { listAdaptiveAllocatorHistory } from "./adaptive-allocator.repository";
import { buildAdaptiveAllocatorOffTelemetry, buildAdaptiveAllocatorPlan } from "./adaptive-allocator.policy";
import type { AdaptiveAllocatorSourceState, AdaptiveAllocatorTelemetry } from "./adaptive-allocator.schemas";
import type { QueryPlan } from "./query-planning.schemas";

export type AdaptiveAllocatorRuntimeInput = {
  client: unknown;
  workspaceId: string;
  productId: string;
  plan: QueryPlan;
  sourceStates: readonly AdaptiveAllocatorSourceState[];
  rotationSeed: string;
  env?: Record<string, string | undefined>;
  now?: Date;
};

export type AdaptiveAllocatorRuntimeResult = {
  mode: AdaptiveAllocatorMode;
  plan: QueryPlan;
  telemetry: AdaptiveAllocatorTelemetry;
};

export async function prepareAdaptiveAllocator(input: AdaptiveAllocatorRuntimeInput): Promise<AdaptiveAllocatorRuntimeResult> {
  const mode = adaptiveAllocatorMode(input.env, input.workspaceId);
  if (mode === "off") return { mode, plan: input.plan, telemetry: buildAdaptiveAllocatorOffTelemetry(input.plan, input.sourceStates) };
  let history;
  let historyWindowDays = 90;
  try {
    const loaded = await listAdaptiveAllocatorHistory({ client: input.client, workspaceId: input.workspaceId, productId: input.productId, now: input.now });
    history = loaded.rows;
    historyWindowDays = loaded.windowDays;
  } catch (error) {
    if (mode === "active") throw error;
    const fallback = buildAdaptiveAllocatorPlan({ plan: input.plan, history: [], sourceStates: input.sourceStates, mode, rotationSeed: input.rotationSeed, now: input.now, historyWindowDays });
    return {
      mode,
      plan: input.plan,
      telemetry: { ...fallback.telemetry, errors: [`History read failed: ${error instanceof Error ? error.message.slice(0, 180) : "unknown error"}`], warnings: [...fallback.telemetry.warnings, "Shadow mode preserved baseline allocation after a bounded history-read failure."] },
    };
  }
  return { mode, ...buildAdaptiveAllocatorPlan({ plan: input.plan, history, sourceStates: input.sourceStates, mode, rotationSeed: input.rotationSeed, now: input.now, historyWindowDays }) };
}
