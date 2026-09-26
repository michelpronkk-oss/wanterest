import "server-only";

import { canMaterializeQualifiedSignal, failClosedQualification, qualifySignal, type SignalQualificationInput } from "./signal-qualification.service";
import type { SignalQualification } from "./signal-qualification.schemas";
import { transitionSignalLifecycle, type SignalLifecycleRepository } from "./signal-lifecycle.service";
import { evidenceFidelityGroundingEnabled } from "./evidence-grounding";

export const SIGNAL_REVALIDATION_VERSION = "signal_revalidation_v1" as const;

/** Mirrors 12A.2's own retirement-pass bound: bounded, not unbounded batch work. */
export const SIGNAL_REVALIDATION_MAX_PER_TICK = 50;

export type SignalRevalidationAction = "unchanged" | "reconfirmed" | "invalidated" | "skipped";

export type SignalRevalidationDecision = {
  action: SignalRevalidationAction;
  reason: string;
  freshQualification: SignalQualification;
};

/**
 * Pure decision: compares a previously-stored qualification against a freshly
 * recomputed one (from the same stored raw/canonical inputs - no re-crawl, no
 * new evidence). Never deletes or rewrites anything itself; it only decides
 * what a caller should do. "unchanged" means the fresh qualification is
 * effectively identical to what was stored; "reconfirmed" means the signal
 * still materializes but the qualification changed (e.g. corrected wording);
 * "invalidated" means the signal no longer meets the bar that let it
 * materialize in the first place.
 */
export function decideRevalidationAction(input: { previous: SignalQualification | null; fresh: SignalQualification }): SignalRevalidationDecision {
  const previouslyMaterialized = canMaterializeQualifiedSignal(input.previous);
  const nowMaterializes = canMaterializeQualifiedSignal(input.fresh);
  if (previouslyMaterialized && !nowMaterializes) {
    return { action: "invalidated", reason: `no longer meets qualification bar: ${input.fresh.diagnostics.gate_failures.join(", ") || input.fresh.status}`, freshQualification: input.fresh };
  }
  if (!previouslyMaterialized) {
    return { action: "skipped", reason: "the signal was never a materialized qualified/high-confidence signal", freshQualification: input.fresh };
  }
  const identical = input.previous
    && input.previous.status === input.fresh.status
    && input.previous.qualification_reason === input.fresh.qualification_reason
    && input.previous.reason_codes.join(",") === input.fresh.reason_codes.join(",");
  return identical
    ? { action: "unchanged", reason: "recomputed qualification matches the stored one", freshQualification: input.fresh }
    : { action: "reconfirmed", reason: "still materializes; qualification content changed on recomputation", freshQualification: input.fresh };
}

export type SignalRevalidationRepository = SignalLifecycleRepository;

export type SignalRevalidationCandidate = {
  signalId: string;
  workspaceId: string;
  previousQualification: SignalQualification | null;
  freshInput: SignalQualificationInput;
};

export type SignalRevalidationOutcome = {
  signalId: string;
  action: SignalRevalidationAction;
  reason: string;
};

/**
 * Recomputes one signal's qualification against already-stored inputs and, only
 * when it no longer materializes, transitions the signal to "invalidated" via
 * the existing signal_lifecycle_v1 primitive - never deletes, never rewrites the
 * underlying (immutable) evaluation row. Idempotent: transitionSignalLifecycle
 * already no-ops when the target status matches the current one and rejects
 * reactivating a terminal signal, and recomputation is a pure function of
 * already-stored inputs, so re-running the same candidate twice is a no-op the
 * second time.
 */
export async function revalidateSignal(repository: SignalRevalidationRepository, candidate: SignalRevalidationCandidate, now = new Date(), env: Record<string, string | undefined> = process.env): Promise<SignalRevalidationOutcome> {
  // 12A.3A.1 Amendment II: revalidation is authoritatively gated by the same
  // workspace-scoped check new signals use, computed here (not trusted from
  // whatever the caller happened to set on freshInput.groundingEnabled) so a
  // workspace outside the fidelity allowlist - or the flag being off entirely -
  // always produces a safe, deliberate no-op skip, never a silent legacy
  // recomputation and never a global fallback.
  const groundingEnabled = evidenceFidelityGroundingEnabled({ env, workspaceId: candidate.workspaceId });
  if (!groundingEnabled) return { signalId: candidate.signalId, action: "skipped", reason: "evidence_fidelity_grounding_disabled" };
  const freshInput: SignalQualificationInput = { ...candidate.freshInput, groundingEnabled };
  let fresh: SignalQualification;
  try {
    fresh = qualifySignal(freshInput);
  } catch (error) {
    fresh = failClosedQualification(freshInput, error instanceof Error ? error.message.slice(0, 120) : "QUALIFICATION_FAILED");
  }
  const decision = decideRevalidationAction({ previous: candidate.previousQualification, fresh });
  if (decision.action !== "invalidated") return { signalId: candidate.signalId, action: decision.action, reason: decision.reason };
  await transitionSignalLifecycle(repository, {
    workspaceId: candidate.workspaceId,
    signalId: candidate.signalId,
    to: "invalidated",
    reason: "evidence_fidelity_revalidation",
    actor: `system:${SIGNAL_REVALIDATION_VERSION}`,
  }, now);
  return { signalId: candidate.signalId, action: "invalidated", reason: decision.reason };
}

/** Bounded batch: never processes more than SIGNAL_REVALIDATION_MAX_PER_TICK candidates per call. */
export async function revalidateSignalBatch(repository: SignalRevalidationRepository, candidates: SignalRevalidationCandidate[], now = new Date(), env: Record<string, string | undefined> = process.env): Promise<SignalRevalidationOutcome[]> {
  const bounded = candidates.slice(0, SIGNAL_REVALIDATION_MAX_PER_TICK);
  const outcomes: SignalRevalidationOutcome[] = [];
  for (const candidate of bounded) {
    try {
      outcomes.push(await revalidateSignal(repository, candidate, now, env));
    } catch (error) {
      outcomes.push({ signalId: candidate.signalId, action: "skipped", reason: error instanceof Error ? error.message.slice(0, 200) : "revalidation_failed" });
    }
  }
  return outcomes;
}
