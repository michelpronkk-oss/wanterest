/**
 * Stable Apex 2.0 identity integration boundary (see
 * docs/design/members-identity-engineering-handoff.md). Pure artwork lives in
 * `member-identity-slots.tsx` / `founder-pass.tsx`; the only client module is
 * the image-failure wrapper in `member-identity-client.tsx`.
 */
export { MemberIdentity } from "./member-identity-client";
export type { MemberIdentityProps } from "./member-identity-client";
export { CohortBadge, IdentityFallback, EarlyAccessPill, PriorityPill } from "./member-identity-slots";
export type { CohortBadgeProps, IdentityFallbackProps } from "./member-identity-slots";
export { FounderPassArtwork } from "./founder-pass";
export type { FounderPassArtworkProps } from "./founder-pass";
