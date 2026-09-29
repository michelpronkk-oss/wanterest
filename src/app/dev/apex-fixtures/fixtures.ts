import type { PublicMemberIdentity } from "@/shared/public-member-identity";

/**
 * VISUAL-QA FIXTURES ONLY. Clearly fictional, labeled data for rendering Apex
 * components in a browser without a database. Never imported by production
 * routes, never written to any table, never shown on the real Members Wall.
 */
const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;
export const FIXTURE_LOGO = svg(`<rect width="64" height="64" fill="#fff"/><rect x="10" y="22" width="44" height="20" rx="4" fill="#2f6fed"/><text x="32" y="36" font-family="Arial" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">LOGO</text>`);
export const FIXTURE_WIDE_LOGO = svg(`<rect width="64" height="64" fill="#fff"/><rect x="2" y="27" width="60" height="10" rx="2" fill="#c2410c"/>`);
export const FIXTURE_AVATAR = svg(`<rect width="64" height="64" fill="#c7b8a3"/><circle cx="32" cy="25" r="12" fill="#6b5a45"/><rect x="12" y="41" width="40" height="30" rx="15" fill="#6b5a45"/>`);
export const BROKEN_LOGO = "https://fixture-broken-logo.invalid/logo.png";
export const BROKEN_AVATAR = "https://fixture-broken-avatar.invalid/avatar.png";

export const identities = {
  logo: { assets: [{ kind: "company_logo", url: FIXTURE_LOGO }, { kind: "monogram", value: "FL" }, { kind: "placeholder" }] },
  wideLogo: { assets: [{ kind: "company_logo", url: FIXTURE_WIDE_LOGO }, { kind: "placeholder" }] },
  avatar: { assets: [{ kind: "profile_avatar", url: FIXTURE_AVATAR }, { kind: "monogram", value: "FA" }, { kind: "placeholder" }] },
  monogram1: { assets: [{ kind: "monogram", value: "F" }, { kind: "placeholder" }] },
  monogram2: { assets: [{ kind: "monogram", value: "FM" }, { kind: "placeholder" }] },
  monogram3: { assets: [{ kind: "monogram", value: "FXM" }, { kind: "placeholder" }] },
  placeholder: { assets: [{ kind: "placeholder" }] },
  brokenLogo: { assets: [{ kind: "company_logo", url: BROKEN_LOGO }, { kind: "profile_avatar", url: FIXTURE_AVATAR }, { kind: "monogram", value: "BL" }, { kind: "placeholder" }] },
  brokenBoth: { assets: [{ kind: "company_logo", url: BROKEN_LOGO }, { kind: "profile_avatar", url: BROKEN_AVATAR }, { kind: "monogram", value: "BB" }, { kind: "placeholder" }] },
} satisfies Record<string, PublicMemberIdentity>;

type Row = { publicSlug: string; displayName: string; headline: string | null; number: number; assignedAt: string; identity: PublicMemberIdentity };
const LONG = "Fixture Parallel North Studio Collective for Extremely Long Public Display Names Limited";

const base: Row[] = [
  { publicSlug: "fixture-logo", displayName: "Fixture Logo Co", headline: "Fixture headline: demand intelligence for industrial buyers", number: 1, assignedAt: "2026-03-04T00:00:00Z", identity: identities.logo },
  { publicSlug: "fixture-monogram", displayName: "Fixture Monogram", headline: null, number: 2, assignedAt: "2026-03-09T00:00:00Z", identity: identities.monogram1 },
  { publicSlug: "fixture-avatar", displayName: "Fixture Avatar Person", headline: "Fixture founder, avatar only", number: 3, assignedAt: "2026-03-12T00:00:00Z", identity: identities.avatar },
  { publicSlug: "fixture-two", displayName: "Fixture Two Letters", headline: "Fixture B2B research", number: 5, assignedAt: "2026-04-01T00:00:00Z", identity: identities.monogram2 },
  { publicSlug: "fixture-broken", displayName: "Fixture Broken Logo", headline: "Logo fails, avatar loads", number: 7, assignedAt: "2026-04-03T00:00:00Z", identity: identities.brokenLogo },
  { publicSlug: "fixture-long", displayName: LONG, headline: "Fixture long headline that keeps going to verify wrapping and clamping behaviour on narrow member cards without overlapping metadata", number: 9, assignedAt: "2026-04-18T00:00:00Z", identity: identities.monogram3 },
  { publicSlug: "fixture-neutral", displayName: "Fixture Neutral", headline: null, number: 12, assignedAt: "2026-05-02T00:00:00Z", identity: identities.placeholder },
  { publicSlug: "fixture-both-broken", displayName: "Fixture Both Broken", headline: "Logo and avatar fail → monogram", number: 25, assignedAt: "2026-05-20T00:00:00Z", identity: identities.brokenBoth },
];

export const foundingRows = base.map((row) => ({ ...row, cohort: "founding_25" as const }));
export const earlyRows = base.map((row) => ({ ...row, publicSlug: `${row.publicSlug}-e`, cohort: "early_100" as const, number: row.number === 25 ? 100 : row.number * 4 + 2 }));
export const LONG_NAME = LONG;
