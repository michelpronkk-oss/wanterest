import { ApexMark } from "@/components/identity/apex-artwork";
import type { PublicMemberIdentity } from "@/shared/public-member-identity";
import { admittedCohortPresentation, type AdmittedCohort } from "@/shared/member-presentation";
import { MemberIdentity } from "./member-identity-client";
import { CohortBadge } from "./member-identity-slots";
import styles from "./member-wall-card.module.css";

export type MemberWallCardProps = {
  cohort: AdmittedCohort;
  number: number;
  displayName: string;
  headline: string | null;
  /** Already formatted from the authoritative assignment time ("Sep 2026"). */
  admissionMonth: string;
  identity: PublicMemberIdentity;
  variant?: "default" | "compact";
  className?: string;
};

/**
 * Board 05 "A · Serial-led — selected" member card. Founding 25 is an ink card
 * with the lit keystone; Early 100 is a white card with an ink Apex.
 *
 * Deliberately never a link: wall_visible and pass_visible are independent
 * consent flags and the public wall projection carries no pass eligibility, so
 * the design's optional "View pass →" affordance is not rendered.
 */
export function MemberWallCard({ cohort, number, displayName, headline, admissionMonth, identity, variant = "default", className }: MemberWallCardProps) {
  const presentation = admittedCohortPresentation(cohort, number);
  const edition = cohort === "founding_25" ? "founding" : "early";
  const label = `${displayName}, ${presentation.label} ${presentation.serial}`;

  if (variant === "compact") {
    return (
      <article className={[styles.compact, className].filter(Boolean).join(" ")} data-edition={edition} aria-label={label}>
        <MemberIdentity identity={identity} size={36} tone="light" />
        <div className={styles.compactCopy}>
          <strong className={styles.compactName}>{displayName}</strong>
          <span className={styles.compactMeta}>Admitted {admissionMonth}</span>
        </div>
        <CohortBadge cohort={cohort} number={number} size="compact" tone="light" />
      </article>
    );
  }

  return (
    <article className={[styles.card, className].filter(Boolean).join(" ")} data-edition={edition} aria-label={label}>
      <div className={styles.topline} aria-hidden="true">
        <ApexMark size={16} fill={edition === "founding" ? "founding-dark" : "early-light"} />
        <span>{presentation.label.toUpperCase()}</span>
      </div>
      <div className={styles.serial} aria-hidden="true">
        <span className={styles.digits}>{presentation.digits}</span>
        <span className={styles.total}>/{presentation.limit}</span>
      </div>
      <div className={styles.rule} aria-hidden="true" />
      <div className={styles.identity}>
        <MemberIdentity identity={identity} size={36} tone={edition === "founding" ? "dark" : "light"} />
        <div className={styles.identityCopy}>
          <strong className={styles.name}>{displayName}</strong>
          {headline ? <span className={styles.headline}>{headline}</span> : null}
        </div>
      </div>
      <div className={styles.footer}>
        <span>Admitted {admissionMonth}</span>
      </div>
    </article>
  );
}
