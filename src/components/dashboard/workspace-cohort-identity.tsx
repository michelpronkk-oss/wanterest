import { CohortBadge } from "@/components/members/member-identity-slots";
import { admittedCohortPresentation, type AdmittedCohort } from "@/shared/member-presentation";

/**
 * Apex 2.0 board 16 sidebar identity + tooltip. Receives only the current
 * workspace's authorized permanent cohort; renders nothing for other workspaces.
 */
export function WorkspaceCohortIdentity({ cohort, number, placement = "sidebar" }: { cohort: AdmittedCohort; number: number; placement?: "sidebar" | "mobile" }) {
  const presentation = admittedCohortPresentation(cohort, number);
  const description = cohort === "founding_25" ? "One of the first 25 admitted workspaces. Permanent." : "One of the next 100 admitted workspaces. Permanent.";
  const tooltipId = `workspace-cohort-${placement}`;
  return (
    <span className={`workspace-cohort-identity is-${placement}`} tabIndex={0} aria-describedby={tooltipId}>
      <CohortBadge cohort={cohort} number={number} size="compact" />
      <span id={tooltipId} role="tooltip" className="workspace-cohort-tooltip">
        <strong>{presentation.label} · No. {presentation.digits}</strong>
        <span>{description}</span>
      </span>
    </span>
  );
}
