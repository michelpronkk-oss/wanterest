"use client";

import { useState } from "react";

import type { PublicMemberIdentity } from "@/shared/public-member-identity";
import { admittedCohortPresentation, identityPixelSize, type AdmittedCohort, type IdentityTone } from "@/shared/member-presentation";
import { IdentityFallback } from "./member-identity-slots";
export { CohortBadge, IdentityFallback } from "./member-identity-slots";
export type { CohortBadgeProps, IdentityFallbackProps } from "./member-identity-slots";

import styles from "./public-members-wall.module.css";

export type MemberIdentityProps = {
  identity: PublicMemberIdentity;
  className?: string;
  size?: number;
  tone?: IdentityTone;
  imageFit?: { companyLogo?: "contain" | "cover"; profileAvatar?: "contain" | "cover" };
};

/**
 * Presentation-only identity slot. It walks the server-ordered, explicitly
 * public assets if an external image fails; it does not fetch profile data or
 * make any visibility decision.
 */
function identityKey(identity: PublicMemberIdentity): string {
  return identity.assets.map((asset) => asset.kind === "monogram" ? `${asset.kind}:${asset.value}` : "url" in asset ? `${asset.kind}:${asset.url}` : asset.kind).join("|");
}

function MemberIdentityRenderer({ identity, className, size = 48, tone = "light", imageFit }: MemberIdentityProps) {
  const pixels = identityPixelSize(size);
  const [assetIndex, setAssetIndex] = useState(0);
  const asset = identity.assets[Math.min(assetIndex, identity.assets.length - 1)];
  const classNames = [styles.identityAsset, className].filter(Boolean).join(" ");

  if (asset.kind === "company_logo" || asset.kind === "profile_avatar") {
    return (
      // A direct browser request avoids a server-side image proxy for arbitrary
      // owner-supplied public URLs; the selector has already required HTTPS.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={classNames}
        style={{ width: pixels, height: pixels, flexBasis: pixels, objectFit: asset.kind === "company_logo" ? imageFit?.companyLogo ?? "contain" : imageFit?.profileAvatar ?? "cover" }}
        data-tone={tone}
        data-identity-kind={asset.kind}
        src={asset.url}
        alt=""
        aria-hidden="true"
        decoding="async"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setAssetIndex((current) => Math.min(current + 1, identity.assets.length - 1))}
      />
    );
  }

  return <IdentityFallback asset={asset} className={classNames} size={pixels} tone={tone} />;
}

export function MemberIdentity(props: MemberIdentityProps) {
  return <MemberIdentityRenderer key={identityKey(props.identity)} {...props} />;
}

export type FounderPassArtworkProps = {
  cohort: AdmittedCohort;
  number: number;
  identity: PublicMemberIdentity;
  displayName: string;
  className?: string;
  size?: number;
  tone?: IdentityTone;
  headline?: string | null;
  admissionMonth?: string | null;
};

/**
 * Stable integration boundary for Claude's future pass artwork. A caller must
 * already have a pass-visible public DTO; this component cannot authorize or
 * publish a pass itself.
 */
export function FounderPassArtwork({ cohort, number, identity, displayName, className, size, tone = "light", headline, admissionMonth }: FounderPassArtworkProps) {
  const presentation = admittedCohortPresentation(cohort, number);
  return (
    <div className={className} data-founder-pass-artwork data-cohort={cohort} data-cohort-number={number} data-serial={presentation.serial} data-tone={tone} data-public-headline={headline ?? undefined} data-admission-month={admissionMonth ?? undefined} aria-label={`${displayName}, ${presentation.label} ${presentation.serial} public pass`}>
      <MemberIdentity identity={identity} size={size} tone={tone} />
    </div>
  );
}
