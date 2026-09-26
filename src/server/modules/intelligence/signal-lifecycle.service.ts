import { z } from "zod";

import type { SignalRow, SignalUpdate } from "@/server/db/database.helpers";
import { AppError } from "@/server/lib/errors";

export const signalLifecycleStatusSchema = z.enum(["active", "saved", "dismissed", "archived", "invalidated", "retracted"]);
export type SignalLifecycleStatus = z.infer<typeof signalLifecycleStatusSchema>;

export const signalLifecycleReasonSchema = z.enum([
  "historical_clause_binding_false_positive",
  "evidence_invalidated",
  "source_withdrawn",
  "admin_review",
  "evidence_fidelity_revalidation",
]);
export type SignalLifecycleReason = z.infer<typeof signalLifecycleReasonSchema>;

export const SIGNAL_LIFECYCLE_VERSION = "signal_lifecycle_v1" as const;

export type SignalLifecycleRepository = {
  getSignal(signalId: string): Promise<SignalRow | null>;
  updateSignal(signalId: string, input: SignalUpdate): Promise<SignalRow>;
};

export type SignalLifecycleTransition = {
  workspaceId: string;
  signalId: string;
  to: SignalLifecycleStatus;
  reason?: SignalLifecycleReason;
  actor?: string;
};

function isTerminal(status: string): status is "invalidated" | "retracted" {
  return status === "invalidated" || status === "retracted";
}

function terminalAuditUpdate(input: SignalLifecycleTransition, now: string): SignalUpdate {
  if (!input.reason) throw new AppError("VALIDATION_ERROR", "A lifecycle reason is required for invalidation or retraction.", 422);
  if (!input.actor) throw new AppError("VALIDATION_ERROR", "A lifecycle actor is required for invalidation or retraction.", 422);
  if (input.to === "invalidated") {
    return {
      lifecycle_status: input.to,
      invalidated_at: now,
      invalidated_reason: input.reason,
      invalidated_by: input.actor,
      lifecycle_version: SIGNAL_LIFECYCLE_VERSION,
    } as SignalUpdate;
  }
  return {
    lifecycle_status: input.to,
    retracted_at: now,
    retracted_reason: input.reason,
    retracted_by: input.actor,
    lifecycle_version: SIGNAL_LIFECYCLE_VERSION,
  } as SignalUpdate;
}

/**
 * Internal, provider-neutral lifecycle transition seam. Terminal states are
 * append-like: repeating the same transition is a no-op and reactivation is
 * rejected. Evidence, evaluations, rankings, and the original signal row are
 * never deleted or rewritten by this helper.
 */
export async function transitionSignalLifecycle(
  repository: SignalLifecycleRepository,
  input: SignalLifecycleTransition,
  now = new Date(),
): Promise<SignalRow> {
  const parsed = signalLifecycleStatusSchema.safeParse(input.to);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid signal lifecycle state.", 422);
  const signal = await repository.getSignal(input.signalId);
  if (!signal) throw new AppError("NOT_FOUND", "Signal was not found.");
  if (signal.workspace_id !== input.workspaceId) throw new AppError("FORBIDDEN", "The signal does not belong to this workspace.");

  if (signal.lifecycle_status === input.to) return signal;
  if (isTerminal(signal.lifecycle_status) && !(signal.lifecycle_status === "invalidated" && input.to === "retracted")) {
    throw new AppError("CONFLICT", "Terminal signal lifecycle states cannot be reactivated.");
  }

  const update = isTerminal(input.to)
    ? terminalAuditUpdate(input, now.toISOString())
    : { lifecycle_status: input.to, lifecycle_version: SIGNAL_LIFECYCLE_VERSION } as SignalUpdate;
  return repository.updateSignal(signal.id, update);
}
