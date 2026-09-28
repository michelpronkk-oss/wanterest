/**
 * Serializable, public-only inputs for identity artwork.
 *
 * This contract deliberately carries no workspace, application, membership, or
 * publication authority. The caller must obtain it from an already-authorized
 * public projection.
 */
export type PublicMemberIdentityAsset =
  | { kind: "company_logo"; url: string }
  | { kind: "profile_avatar"; url: string }
  | { kind: "monogram"; value: string }
  | { kind: "placeholder" };

/**
 * Ordered fallbacks for the public identity display hierarchy:
 * company logo -> profile avatar -> authoritative monogram -> neutral fallback.
 */
export type PublicMemberIdentity = {
  assets: readonly [PublicMemberIdentityAsset, ...PublicMemberIdentityAsset[]];
};
