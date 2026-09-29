import type { PublicMemberIdentity, PublicMemberIdentityAsset } from "@/shared/public-member-identity";
import { publicProfileUrlOrNull } from "@/shared/public-profile-url";

import type { PublicCohortRow } from "./cohort-public.schemas";

/**
 * Creates a rendering-only identity model from the narrow public RPC row.
 * It never derives a monogram: that value is established by the Layer 13A.4
 * SQL/application normalization contract before this presentation step.
 */
export function selectPublicMemberIdentity(row: Pick<PublicCohortRow, "logoUrl" | "avatarUrl" | "monogram">): PublicMemberIdentity {
  const assets: [PublicMemberIdentityAsset, ...PublicMemberIdentityAsset[]] = [{ kind: "placeholder" }];
  const logoUrl = publicProfileUrlOrNull(row.logoUrl);
  const avatarUrl = publicProfileUrlOrNull(row.avatarUrl);

  if (row.monogram) assets.unshift({ kind: "monogram", value: row.monogram });
  if (avatarUrl) assets.unshift({ kind: "profile_avatar", url: avatarUrl });
  if (logoUrl) assets.unshift({ kind: "company_logo", url: logoUrl });

  return { assets };
}
