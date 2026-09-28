import type { PublicMemberIdentity, PublicMemberIdentityAsset } from "@/shared/public-member-identity";

import type { PublicCohortRow } from "./cohort-public.schemas";

function safePublicImage(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Creates a rendering-only identity model from the narrow public RPC row.
 * It never derives a monogram: that value is established by the Layer 13A.4
 * SQL/application normalization contract before this presentation step.
 */
export function selectPublicMemberIdentity(row: Pick<PublicCohortRow, "logoUrl" | "avatarUrl" | "monogram">): PublicMemberIdentity {
  const assets: [PublicMemberIdentityAsset, ...PublicMemberIdentityAsset[]] = [{ kind: "placeholder" }];
  const logoUrl = safePublicImage(row.logoUrl);
  const avatarUrl = safePublicImage(row.avatarUrl);

  if (row.monogram) assets.unshift({ kind: "monogram", value: row.monogram });
  if (avatarUrl) assets.unshift({ kind: "profile_avatar", url: avatarUrl });
  if (logoUrl) assets.unshift({ kind: "company_logo", url: logoUrl });

  return { assets };
}
