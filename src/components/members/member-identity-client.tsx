"use client";

import { useCallback, useState } from "react";

import type { PublicMemberIdentity } from "@/shared/public-member-identity";
import { identityPixelSize, type IdentityTone } from "@/shared/member-presentation";
import { IdentityFallback, IdentityImageFrame } from "./member-identity-slots";

export type MemberIdentityProps = {
  identity: PublicMemberIdentity;
  className?: string;
  size?: number;
  tone?: IdentityTone;
  imageFit?: { companyLogo?: "contain" | "cover"; profileAvatar?: "contain" | "cover" };
};

function identityKey(identity: PublicMemberIdentity): string {
  return identity.assets.map((asset) => asset.kind === "monogram" ? `${asset.kind}:${asset.value}` : "url" in asset ? `${asset.kind}:${asset.url}` : asset.kind).join("|");
}

/**
 * Client-only image-failure wrapper around the pure Apex identity tiles. It
 * walks the server-ordered, explicitly public assets (logo -> avatar ->
 * persisted monogram -> neutral) if an external image fails; it does not fetch
 * profile data or make any visibility decision.
 */
function MemberIdentityRenderer({ identity, className, size = 48, tone = "light", imageFit }: MemberIdentityProps) {
  const pixels = identityPixelSize(size);
  const [assetIndex, setAssetIndex] = useState(0);
  const currentIndex = Math.min(assetIndex, identity.assets.length - 1);
  const asset = identity.assets[currentIndex];
  // Idempotent per failed asset: an error reported twice for the same image (early
  // detection + onError) must not skip the next fallback in the server-ordered chain.
  const advanceFrom = useCallback((failedIndex: number) => setAssetIndex((current) => current === failedIndex ? Math.min(current + 1, identity.assets.length - 1) : current), [identity.assets.length]);
  // A server-rendered <img> can fail before hydration attaches onError; detect
  // that already-failed state once the element is mounted.
  const detectEarlyFailure = useCallback((element: HTMLImageElement | null) => {
    if (element?.complete && element.naturalWidth === 0) advanceFrom(Number(element.dataset.assetIndex));
  }, [advanceFrom]);

  if (asset.kind === "company_logo" || asset.kind === "profile_avatar") {
    return (
      <IdentityImageFrame kind={asset.kind} size={pixels} tone={tone} className={className}>
        {/* A direct browser request avoids a server-side image proxy for arbitrary
            owner-supplied public URLs; the selector has already applied the shared
            public URL policy. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          style={{ width: pixels, height: pixels, objectFit: asset.kind === "company_logo" ? imageFit?.companyLogo ?? "contain" : imageFit?.profileAvatar ?? "cover" }}
          data-identity-kind={asset.kind}
          src={asset.url}
          alt=""
          decoding="async"
          loading="lazy"
          referrerPolicy="no-referrer"
          key={currentIndex}
          data-asset-index={currentIndex}
          ref={detectEarlyFailure}
          onError={() => advanceFrom(currentIndex)}
        />
      </IdentityImageFrame>
    );
  }

  return <IdentityFallback asset={asset} className={className} size={pixels} tone={tone} />;
}

export function MemberIdentity(props: MemberIdentityProps) {
  return <MemberIdentityRenderer key={identityKey(props.identity)} {...props} />;
}
