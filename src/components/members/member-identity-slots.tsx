import type { CSSProperties } from "react";
import type { PublicMemberIdentityAsset } from "@/shared/public-member-identity";
import { admittedCohortLabel, admittedCohortPresentation, identityPixelSize, type AdmittedCohort, type BadgeSize, type IdentityTone } from "@/shared/member-presentation";
import styles from "./public-members-wall.module.css";

export type CohortBadgeProps = {
  cohort: AdmittedCohort; number?: number; size?: BadgeSize; tone?: IdentityTone; className?: string;
};
/** Server/client-safe structural badge. Size/tone hooks do not invent final artwork. */
export function CohortBadge({ cohort, number, size = "standard", tone = "light", className }: CohortBadgeProps) {
  const identity = number === undefined ? null : admittedCohortPresentation(cohort, number);
  return <span className={className} data-cohort={cohort} data-badge-size={size} data-tone={tone}>{admittedCohortLabel(cohort)}{identity ? ` ${identity.serial}` : ""}</span>;
}
export type IdentityFallbackProps = {
  asset: Extract<PublicMemberIdentityAsset, { kind: "monogram" | "placeholder" }>;
  size?: number; tone?: IdentityTone; className?: string;
};
export function IdentityFallback({ asset, size = 48, tone = "light", className }: IdentityFallbackProps) {
  const pixels = identityPixelSize(size);
  const style: CSSProperties = { width: pixels, height: pixels, flexBasis: pixels };
  return <span className={className ?? styles.monogram} style={style} data-identity-kind={asset.kind} data-tone={tone} aria-hidden="true">{asset.kind === "monogram" ? asset.value : "—"}</span>;
}
