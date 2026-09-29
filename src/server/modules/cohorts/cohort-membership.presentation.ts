import { admittedCohortPresentation } from "@/shared/member-presentation";
import type { WorkspaceCohortIdentity } from "./cohort-membership.schemas";

/** Private badge/Settings input after getWorkspaceCohortIdentityQuery authorization.
 * Independent of optional public profiles, consent, billing and workspace activity.
 * Inactivity affects public eligibility, not this historical cohort identity.
 */
export function workspaceCohortPresentation(identity: WorkspaceCohortIdentity) {
  if (identity.cohort === "none") return null;
  if (identity.number === null || identity.assignedAt === null) throw new Error("Incomplete authoritative cohort identity.");
  return {
    ...admittedCohortPresentation(identity.cohort, identity.number),
    assignedAt: identity.assignedAt, workspaceStatus: identity.workspaceStatus,
  };
}
