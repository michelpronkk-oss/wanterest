import type { CSSProperties, ReactNode } from "react";

import { ApexMark, ApexPlate } from "@/components/identity/apex-artwork";
import { earlyAccessLabel } from "@/components/waitlist/journey";
import type { PublicMemberIdentityAsset } from "@/shared/public-member-identity";
import { plateRadius } from "@/shared/apex-artwork";
import {
  admittedCohortLabel,
  admittedCohortPresentation,
  identityPixelSize,
  monogramFontSize,
  monogramTone,
  type AdmittedCohort,
  type BadgeSize,
  type IdentityTone,
} from "@/shared/member-presentation";
import styles from "./apex-identity.module.css";

/*
 * Server/client-safe Apex 2.0 presentation slots. None of these read data,
 * decide visibility, allocate numbers or accept pre-admission identities as
 * cohorts: callers pass values from an already-authorized backend read.
 */

export type CohortBadgeProps = {
  cohort: AdmittedCohort; number?: number; size?: BadgeSize; tone?: IdentityTone; className?: string;
};

const PILL_LABEL: Record<AdmittedCohort, string> = { founding_25: "FOUNDING", early_100: "EARLY" };

/**
 * Board 03/17 cohort badge. `standard` (28px) and `compact` (22px) are the
 * "Apex + cohort + serial" pill; `micro` is the plate with an optional "#07".
 * The serial is always the authoritative number, formatted, never generated.
 */
export function CohortBadge({ cohort, number, size = "standard", tone = "light", className }: CohortBadgeProps) {
  const label = admittedCohortLabel(cohort);
  const identity = number === undefined ? null : admittedCohortPresentation(cohort, number);
  const accessible = identity ? `${label} ${identity.serial}` : label;
  const edition = cohort === "founding_25" ? "founding" : "early";
  if (size === "micro") {
    return (
      <span className={[styles.micro, className].filter(Boolean).join(" ")} data-cohort={cohort} data-badge-size={size} data-tone={tone}>
        <ApexPlate size={20} edition={edition} surface={tone} />
        {identity ? <span className={styles.microSerial} aria-hidden="true">{identity.serial}</span> : null}
        <span className={styles.srOnly}>{accessible}</span>
      </span>
    );
  }
  const fill = cohort === "founding_25" ? "founding-dark" : tone === "dark" ? "early-dark" : "early-light";
  return (
    <span className={[styles.pill, className].filter(Boolean).join(" ")} data-cohort={cohort} data-badge-size={size} data-tone={tone}>
      <ApexMark size={size === "compact" ? 11 : 14} fill={fill} />
      <span className={styles.pillLabel} aria-hidden="true">{PILL_LABEL[cohort]}</span>
      {identity ? <><span className={styles.pillDivider} aria-hidden="true" /><span className={styles.pillSerial} aria-hidden="true">{identity.digits}</span></> : null}
      <span className={styles.srOnly}>{accessible}</span>
    </span>
  );
}

export type IdentityFallbackProps = {
  asset: Extract<PublicMemberIdentityAsset, { kind: "monogram" | "placeholder" }>;
  size?: number; tone?: IdentityTone; className?: string;
};

function tileStyle(pixels: number): CSSProperties {
  return { width: pixels, height: pixels, flexBasis: pixels, borderRadius: plateRadius(pixels) };
}

/** Board 04: the persisted monogram (unmodified) or the neutral sand tile with an open ring. */
export function IdentityFallback({ asset, size = 48, tone = "light", className }: IdentityFallbackProps) {
  const pixels = identityPixelSize(size);
  const classNames = [styles.tile, className].filter(Boolean).join(" ");
  if (asset.kind === "monogram") {
    return (
      <span className={classNames} style={{ ...tileStyle(pixels), fontSize: monogramFontSize(asset.value, pixels) }} data-identity-kind="monogram" data-monogram-tone={monogramTone(asset.value)} data-tone={tone} aria-hidden="true">
        {asset.value}
      </span>
    );
  }
  const ring = Math.round(pixels * 0.3);
  return (
    <span className={classNames} style={tileStyle(pixels)} data-identity-kind="placeholder" data-tone={tone} aria-hidden="true">
      <span className={styles.ring} style={{ width: ring, height: ring }} />
    </span>
  );
}

/** Frame for an explicitly public image (company logo contained, avatar cropped to a circle). */
export function IdentityImageFrame({ kind, size, tone = "light", className, children }: { kind: "company_logo" | "profile_avatar"; size: number; tone?: IdentityTone; className?: string; children: ReactNode }) {
  const pixels = identityPixelSize(size);
  return (
    <span className={[styles.tile, className].filter(Boolean).join(" ")} style={tileStyle(pixels)} data-identity-kind={kind} data-tone={tone} aria-hidden="true">
      {children}
    </span>
  );
}

/** Board 02/13 Early Access: permanent waitlist identity. Hollow-ring family, never an Apex or a cohort. */
export function EarlyAccessPill({ number, size = "standard", tone = "light", className }: { number?: number | null; size?: "compact" | "standard"; tone?: IdentityTone; className?: string }) {
  // Formatting only, through the existing waitlist formatter; a missing number stays absent.
  const label = earlyAccessLabel(number);
  return (
    <span className={[styles.accessPill, className].filter(Boolean).join(" ")} data-access-kind="early_access" data-badge-size={size} data-tone={tone}>
      <span className={styles.accessLabel}>Early access</span>
      {label ? <span className={styles.accessNumber}>{label}</span> : null}
    </span>
  );
}

/**
 * Board 02/13 Priority Access: a revocable status shown with the original
 * Early Access number. Renders nothing when Priority is revoked or absent —
 * the design returns quietly to Early Access (no "lost" state).
 */
export function PriorityPill({ status, earlyAccessNumber, size = "standard", tone = "light", className }: { status: "granted" | "revoked" | null; earlyAccessNumber?: number | null; size?: "compact" | "standard"; tone?: IdentityTone; className?: string }) {
  if (status !== "granted") return null;
  const label = earlyAccessLabel(earlyAccessNumber);
  return (
    <span className={[styles.priorityPill, className].filter(Boolean).join(" ")} data-access-kind="priority_access" data-badge-size={size} data-tone={tone}>
      <span className={styles.priorityDot} aria-hidden="true" />
      <span className={styles.priorityLabel}>Priority</span>
      {label ? <span className={styles.priorityNumber}>{label}</span> : null}
    </span>
  );
}

/** Oversized Early Access number with the muted "#" (board 02/13 "#0184"). */
export function EarlyAccessNumber({ label, className }: { label: string; className?: string }) {
  const digits = label.startsWith("#") ? label.slice(1) : label;
  return (
    <span className={[styles.earlyAccessNumber, className].filter(Boolean).join(" ")}>
      {label.startsWith("#") ? <span className={styles.earlyAccessHash}>#</span> : null}{digits}
    </span>
  );
}

export type AccessStatusKind = "pending" | "email_confirmed" | "review" | "priority" | "invite_ready" | "invited" | "admitted";
const STATUS_LABEL: Record<AccessStatusKind, string> = {
  pending: "Pending verification", email_confirmed: "Email confirmed", review: "Under review",
  priority: "Priority active", invite_ready: "Invitation ready", invited: "Invited", admitted: "Admitted",
};

/** Board 03 "Access · where you are": square-cornered 6px chips. */
export function AccessStatusChip({ status, label, className }: { status: AccessStatusKind; label?: string; className?: string }) {
  return (
    <span className={[styles.status, className].filter(Boolean).join(" ")} data-status={status}>
      <span className={styles.statusGlyph} aria-hidden="true" />{label ?? STATUS_LABEL[status]}
    </span>
  );
}

/** Board 03 "Publication · consent": wall and pass are always shown as two independent chips. */
export function PublicationChip({ surface, visible, className }: { surface: "wall" | "pass"; visible: boolean; className?: string }) {
  const label = surface === "wall" ? (visible ? "On public wall" : "Not on wall") : (visible ? "Pass public" : "Pass private");
  return (
    <span className={[styles.publication, className].filter(Boolean).join(" ")} data-public={visible}>
      <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><rect x="1" y="1" width="9" height="9" rx="2" fill={visible ? "#111110" : "none"} stroke={visible ? "#111110" : "#a3a399"} strokeWidth="1.2" /></svg>
      {label}
    </span>
  );
}

/** Board 03 "Activity · workspace now": text + dot beside identity, never inside it. */
export function WorkspaceActivity({ active, tone = "light", className }: { active: boolean; tone?: IdentityTone; className?: string }) {
  return (
    <span className={[styles.activity, className].filter(Boolean).join(" ")} data-active={active} data-tone={tone}>
      <span className={styles.activityDot} aria-hidden="true" />{active ? "Workspace active" : "Workspace inactive"}
    </span>
  );
}
