import type { EligibilityDecision } from "./organic-intelligence.schemas";

export type OrganicPublicationState =
  | "candidate"
  | "eligible"
  | "review_required"
  | "approved"
  | "published"
  | "noindex"
  | "retired"
  | "merged";

export type LifecycleAction =
  | "evaluate"
  | "request_review"
  | "approve"
  | "publish"
  | "stale_review"
  | "noindex"
  | "retire"
  | "merge";

export type LifecycleActor = {
  kind: "system" | "human";
  userId?: string;
  auditEventId?: string;
  reason?: string;
};

export type LifecycleTransition = {
  allowed: boolean;
  state: OrganicPublicationState;
  reason: string;
  actorKind: LifecycleActor["kind"];
  auditEventId: string | null;
};

const publishableStates = new Set(["eligible", "eligible_review_required"]);

function transition(
  allowed: boolean,
  state: OrganicPublicationState,
  reason: string,
  actor: LifecycleActor,
): LifecycleTransition {
  return { allowed, state, reason, actorKind: actor.kind, auditEventId: actor.auditEventId ?? null };
}

function hasHumanAudit(actor: LifecycleActor): boolean {
  return actor.kind === "human" && Boolean(actor.userId && actor.auditEventId && actor.reason?.trim());
}

export function recommendPublicationState(
  decision: EligibilityDecision,
  currentState: OrganicPublicationState = "candidate",
): OrganicPublicationState {
  if (decision.state === "merged_identity") return "merged";
  if (currentState === "merged" || currentState === "retired" || currentState === "noindex") return currentState;
  if (decision.state === "noindex" || decision.state === "privacy_blocked" || decision.state === "copyright_blocked") return "noindex";
  if (decision.state === "eligible_review_required") return "review_required";
  if (decision.state === "eligible") return currentState === "candidate" ? "eligible" : currentState;
  if (decision.state === "stale" && currentState === "published") return "review_required";
  if (currentState === "published") return "review_required";
  return currentState === "approved" ? "review_required" : "candidate";
}

export function transitionPublicationState(
  current: OrganicPublicationState,
  action: LifecycleAction,
  decision: EligibilityDecision,
  actor: LifecycleActor,
): LifecycleTransition {
  if (action === "evaluate") {
    if (decision.state === "eligible") return transition(true, current === "candidate" ? "eligible" : current, "eligibility_evaluated", actor);
    if (decision.state === "eligible_review_required") return transition(true, "review_required", "human_review_required", actor);
    return transition(true, recommendPublicationState(decision, current), "eligibility_not_publishable", actor);
  }

  if (action === "stale_review") {
    if (actor.kind !== "system" || current !== "published" || decision.state !== "stale") {
      return transition(false, current, "stale_review_transition_invalid", actor);
    }
    return transition(true, "review_required", "published_claim_requires_refresh_review", actor);
  }

  if (action === "request_review") {
    if (current !== "eligible" && current !== "review_required") return transition(false, current, "review_requires_eligible_candidate", actor);
    return transition(true, "review_required", "human_review_requested", actor);
  }

  if (action === "approve") {
    if (current !== "review_required" || !publishableStates.has(decision.state)) {
      return transition(false, current, "approval_requires_current_eligible_review", actor);
    }
    if (!hasHumanAudit(actor)) return transition(false, current, "human_audit_record_required", actor);
    return transition(true, "approved", "human_approved", actor);
  }

  if (action === "publish") {
    if (current !== "approved" || decision.state !== "eligible") {
      return transition(false, current, "publication_requires_human_approval_and_current_eligibility", actor);
    }
    if (!hasHumanAudit(actor)) return transition(false, current, "human_audit_record_required", actor);
    return transition(true, "published", "human_published", actor);
  }

  if (action === "noindex") {
    if (current !== "review_required" && current !== "approved" && current !== "published") {
      return transition(false, current, "noindex_requires_review", actor);
    }
    if (!hasHumanAudit(actor)) return transition(false, current, "human_audit_record_required", actor);
    return transition(true, "noindex", "human_noindex_decision", actor);
  }

  if (action === "retire") {
    if (current !== "noindex" || !hasHumanAudit(actor)) return transition(false, current, "retirement_requires_noindex_and_human_audit", actor);
    return transition(true, "retired", "human_retired", actor);
  }

  if (action === "merge") {
    if (!hasHumanAudit(actor)) return transition(false, current, "merge_requires_human_audit", actor);
    if (decision.state !== "merged_identity") return transition(false, current, "merge_requires_canonical_merge_decision", actor);
    return transition(true, "merged", "human_merge_recorded", actor);
  }

  return transition(false, current, "unsupported_lifecycle_action", actor);
}

export type RefreshAssessment = {
  state: "fresh" | "review_due" | "noindex_candidate" | "merged" | "unavailable";
  reasons: string[];
  changedAt: string | null;
};

export function assessRefreshLifecycle(
  decision: EligibilityDecision,
  meaningfulChangedAt: string | null,
): RefreshAssessment {
  if (decision.state === "merged_identity") return { state: "merged", reasons: ["canonical_identity_merged"], changedAt: meaningfulChangedAt };
  if (decision.state === "stale") return { state: "review_due", reasons: ["claim_specific_freshness_failed"], changedAt: meaningfulChangedAt };
  if (decision.state === "noindex" || decision.state === "privacy_blocked" || decision.state === "copyright_blocked") {
    return { state: "noindex_candidate", reasons: [decision.state], changedAt: meaningfulChangedAt };
  }
  if (!meaningfulChangedAt || !Number.isFinite(Date.parse(meaningfulChangedAt))) {
    return { state: "unavailable", reasons: ["meaningful_change_time_unavailable"], changedAt: null };
  }
  return { state: "fresh", reasons: [], changedAt: meaningfulChangedAt };
}
