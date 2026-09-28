"use client";

import { useState } from "react";

import type { PublicMemberIdentity, PublicMemberIdentityAsset } from "@/shared/public-member-identity";

import styles from "./public-members-wall.module.css";

export type CohortBadgeProps = {
  cohort: "founding_25" | "early_100";
  className?: string;
};

export function CohortBadge({ cohort, className }: CohortBadgeProps) {
  return <span className={className} data-cohort={cohort}>{cohort === "founding_25" ? "Founding 25" : "Early 100"}</span>;
}

export type IdentityFallbackProps = {
  asset: Extract<PublicMemberIdentityAsset, { kind: "monogram" | "placeholder" }>;
  className?: string;
};

/** Structural fallback surface for Claude's final monogram and neutral artwork. */
export function IdentityFallback({ asset, className }: IdentityFallbackProps) {
  return (
    <span className={className ?? styles.monogram} data-identity-kind={asset.kind} aria-hidden="true">
      {asset.kind === "monogram" ? asset.value : "—"}
    </span>
  );
}

export type MemberIdentityProps = {
  identity: PublicMemberIdentity;
  className?: string;
};

/**
 * Presentation-only identity slot. It walks the server-ordered, explicitly
 * public assets if an external image fails; it does not fetch profile data or
 * make any visibility decision.
 */
function identityKey(identity: PublicMemberIdentity): string {
  return identity.assets.map((asset) => asset.kind === "monogram" ? `${asset.kind}:${asset.value}` : "url" in asset ? `${asset.kind}:${asset.url}` : asset.kind).join("|");
}

function MemberIdentityRenderer({ identity, className }: MemberIdentityProps) {
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

  return <IdentityFallback asset={asset} className={classNames} />;
}

export function MemberIdentity({ identity, className }: MemberIdentityProps) {
  return <MemberIdentityRenderer key={identityKey(identity)} identity={identity} className={className} />;
}

export type FounderPassArtworkProps = {
  cohort: "founding_25" | "early_100";
  number: number;
  identity: PublicMemberIdentity;
  displayName: string;
  className?: string;
};

/**
 * Stable integration boundary for Claude's future pass artwork. A caller must
 * already have a pass-visible public DTO; this component cannot authorize or
 * publish a pass itself.
 */
export function FounderPassArtwork({ cohort, number, identity, displayName, className }: FounderPassArtworkProps) {
  return (
    <div className={className} data-founder-pass-artwork data-cohort={cohort} data-cohort-number={number} aria-label={`${displayName} founder pass`}>
      <MemberIdentity identity={identity} />
    </div>
  );
}
