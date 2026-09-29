# Apex 2.0 pre-integration audit

Audit date: 2026-09-29. Scope: technical readiness, not artwork implementation or production approval.

**Verdict: READINESS_FIXES_REQUIRED.** The public identity foundation is usable, but definitive Apex 2.0 exports are absent from the audited branch, several required presentation slots are not connected, and public release has unresolved privacy/runtime gates. No substitute artwork, implementation repair, migration application, merge, deployment, real email, or production-data mutation was performed.

## 1. Verified baseline and evidence limits

| Reference | Verified full SHA |
| --- | --- |
| Audit branch: `integration/f1-5-emails-members-identity` | `4c0ecff2958fb759f3e084fd19d4159a0ae0e75e` |
| `origin/integration/f1-5-emails-members-identity` after fetch | `4c0ecff2958fb759f3e084fd19d4159a0ae0e75e` |
| `origin/main` after fetch / production reference | `51ced7673cc4c94b1b1f792d864baecca0295edd` |
| Read-only future 13B reference: `origin/layer13b3-public-intelligence-attribution` | `e22e075f89be301fa92eea3af6de11f20e6e7355` |

`git merge-base --is-ancestor 51ced7673cc4c94b1b1f792d864baecca0295edd HEAD` passed. Integration-only history is `5e157f9` (emails), `e0e2393` (Members Wall/identity infrastructure), then `4c0ecff` (handoff clarification). The worktree was clean before this audit. Its implementation was inspected alongside `docs/design/members-identity-engineering-handoff.md`; that document was not accepted as runtime proof.

Only this audit document is to be committed. Other frontend worktrees, uncommitted homepage/menu work, `WANTEREST_LOCAL_HANDOFF.md`, environment files, parked P2.2B, and production remain untouched. The audit commit's own full SHA is reported with the delivery; embedding a document's containing commit hash inside itself would be circular.

Evidence classifications used below:

- **Implemented/static:** verified repository code or SQL definition.
- **Tested:** this audit executed the named offline tests/build commands.
- **NOT_RUNTIME_VALIDATED:** pending SQL has not been executed against isolated PostgreSQL by this audit.
- **Not browser validated:** no actual browser exercise of wall/pass/image failure/consent revocation was performed in this audit.

Remote Git references establish the code baseline, not deployed database parity, grants, production access mode, or Vercel runtime state. No production database was queried. Supabase/Postgres review guidance was used to separate RLS, function grants and server authority from presentation-only checks; see the [official RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

## A. Existing implementation inventory

Paths below are repository-relative so this handoff remains portable across worktrees.

| Area | Actual implementation | Assessment |
| --- | --- | --- |
| Permanent identity | `src/server/modules/cohorts/cohort-membership.{schemas,service,repository}.ts`, `index.ts` | Typed private identity query and controlled admission-assignment seam; allocator/immutability are in SQL. |
| Benefits | `src/server/modules/cohort-benefits/` | Separate policy/entitlement authority. Apex is presentation only; do not modify benefits. |
| Public DTO / input | `src/server/modules/cohort-public/cohort-public.schemas.ts` | Two admitted cohorts; narrow public projection and separately typed private profile. Single public display name, not separate person/company names. |
| Public persistence | `src/server/modules/cohort-public/cohort-public.repository.ts` | RPC adapter, explicit field mapping, Zod result parsing, safe application errors. Uses a local string-based RPC client contract rather than generated cohort RPC types. |
| Public application service | `src/server/modules/cohort-public/cohort-public.service.ts`, `index.ts` | Parallel wall reads, normalized pass lookup, authenticated private read/update; React request memoization, no persistent permission cache. Query helpers live in this service, not a separate queries file. |
| Identity selection | `src/server/modules/cohort-public/cohort-public.identity.ts` | Existing public fields only; ordered fallback; no second monogram derivation. |
| Serializable identity | `src/shared/public-member-identity.ts` | Nonempty asset tuple: company logo, avatar, monogram, placeholder. No IDs or publication authority. |
| Four visual slots | `src/components/members/member-identity.tsx` | `CohortBadge`, `MemberIdentity`, `IdentityFallback`, `FounderPassArtwork`. Minimal structural components, not definitive artwork. |
| Wall renderer / skin | `src/components/members/public-members-wall.tsx`, `public-members-wall.module.css` | Both cohorts, non-clickable cards, real numbers/months, empty state and keyboard tab logic. Four/two/one-column CSS; 48px identity tiles. |
| Public wall | `src/app/members/page.tsx` | Dynamic route, two public cohort RPCs and authoritative access-mode CTA. Explicit DTO-to-wall mapping. |
| Public pass | `src/app/members/[slug]/page.tsx` | Dynamic lookup, canonical metadata, unavailable/not-found path. Older text/monogram presentation; does not use the four new slots. |
| Private profile API | `src/app/api/workspaces/[workspaceId]/public-profile/route.ts` | Authenticated GET/PATCH; ownership/admin authority enforced in SQL. No mutation route based on a public slug. |
| Membership Settings | `src/app/app/settings/page.tsx` | Existing general/product/sources/plan/team tabs. No membership identity or public-profile consent editor. |
| Application identity | `src/components/dashboard/dashboard-shell.tsx`, `context-switchers.tsx` | Existing private workspace/product context and approved brand logo. No connected cohort badge/public identity slot. |
| Waitlist display | `src/components/waitlist/journey.ts`, `journey-views.tsx`, `membership-ladder.tsx` | Backend-derived Early Access/admission/Priority states; multiple inline badge representations rather than one Apex presentation contract. |
| Waitlist routes | `src/app/waitlist/{verified,status}/page.tsx`, `_lib/journey-data.ts` | Private HttpOnly status-cookie flow; unavailable sharing remains explicit. No 13B RPC dependency introduced. |
| Admission reveal | `src/app/invite/complete/route.ts`; waitlist admission modules | Server-produced HTML and authoritative acceptance result. Not a React page; shared artwork needs a server-compatible rendering path. |
| Master brand logo | `LogoMark` in `src/components/dashboard/nav-icons.tsx` | Existing inline master SVG, `viewBox="0 0 120 118"`; preserve geometry. This is not proof of an Apex 2.0 badge master. |
| SVG/build pipeline | `next.config.ts`, `package.json`, `public/` | Inline React SVG/static public assets; no custom SVG-import loader or SVGR requirement. No remote image optimization policy for arbitrary owner URLs. |
| Supabase generated types | `src/server/db/database.types.ts` | Current access/P2.1 RPC types exist, but cohort/public-profile tables and RPC entries are absent. Local runtime schemas mask that compile-time coverage gap. |

Tests include cohort/public-profile/normalization modules, benefits, wall server-render tests, static SQL/RLS contract tests and an opt-in PostgreSQL cohort test. The generated-types test covers access/P2.1, not the missing cohort/public-profile contracts.

## B. Complete compatibility matrix

“Direct” means a supplied, reviewed export can replace a visual leaf without authority changes; it does **not** mean an export currently exists. “Active SQL” means the pending active-workspace repair is a public-release dependency, not an asset-import dependency. None of the rows requires 13B to be imported into this branch.

| Component | Exists / contract | Direct asset fit | Dynamic authoritative values | Required variants supported now | Minimum frontend change | Backend change | Unapplied SQL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Founding 25 badge | Text `CohortBadge`; correct admitted-cohort enum | Visual leaf yes | Cohort; serial supplied separately | Text only; no size/tone artwork | Approved SVG leaf + size/tone adapter | None for existing values | None for private display; Active SQL for public release |
| Early 100 badge | Same component and separate namespace | Visual leaf yes | Cohort; serial supplied separately | Text only | Same adapter, preserve Early 100 name | None | Same as above |
| Early Access identity | Journey model/status reveal exists | No unified slot | Verified application's independent number | Existing waitlist UI only | Separate typed pre-admission presentation variant | None | None |
| Priority Access | Referral/current grant model exists | No unified slot | Current revocable grant; no cohort serial | Existing status/ladder text only | Explicit status variant, never permanent-cohort alias | None | None |
| Public company logo | `logoUrl` and selector exist | `<img>` slot yes | Explicit public-profile URL | Fixed tile, `cover` can crop logos | Size/fit contract; use approved logo fit | Harden public URL boundary before launch | URL enforcement may need additive SQL; Active SQL |
| Public profile avatar | `avatarUrl` and selector exist | `<img>` slot yes | Explicit public-profile URL | Fixed tile only | Approved frame/size adapter | Same URL boundary; uploads not implemented | Same as company logo |
| Persisted monogram | `IdentityFallback` exists | Approved background/frame yes | Saved 13A.4 value only | Plain text fallback | Keep text dynamic; style replaceable | None | None for asset import; Active SQL public |
| Neutral branded fallback | Structural em dash exists | Replace visual leaf | No member data | Not definitive branded artwork | Approved neutral SVG, decorative semantics | None | None |
| Members Wall | Complete bounded route/renderer | Card/badge leaves, not whole HTML mockup | Public cohort, number, name, headline, month, identity | Two cohorts + empty; responsive CSS | Skin import; retain tabs/empty/error semantics | No new fields; URL boundary hardening | Active SQL |
| Member card | Local `MemberCard` exists, public-only row | Visual composition adapter | Same wall row; no pass authority | Both cohorts; no clickable pass | Asset/size/serial-format adapters; keep non-clickable | None unless approved design requires pass-link eligibility | Active SQL; any pass-link DTO extension separately reviewed |
| Individual public profile | Route/data/metadata exist | Not directly connected to slots | Existing public DTO has all basic pass data | Text layout only; no image hierarchy | Wire selector + reusable pass surface | None for existing public fields | Active SQL |
| Founding Founder Pass | Route + unused structural `FounderPassArtwork` | No complete composition yet | Number/name/identity props exist; date/headline in DTO only | No definitive background/badge/layout | Extend presentation props with existing date/headline; wire route | None for these fields | Active SQL |
| Early 100 public pass | Same route/slot | Same limitation | Own cohort namespace/number | No separate composition; generic “founder pass” aria label | Approved Early 100 variant and accurate accessible label | None | Active SQL |
| Settings membership identity | UI absent; private queries/API exist | Needs a host slot | Workspace identity/profile from authorized server query | None | Add private membership section, real loading/error/none states | Existing contracts sufficient; mind PATCH replacement semantics | None for private base; Active SQL for publication behavior |
| Compact cohort badge | No common app-wide slot | Needs size contract | Use private workspace identity, never URL/local state | No compact/large/light/dark API | Typed size/tone adapter and app wiring | None | None |
| Workspace identity | Private switcher exists, no cohort wiring | Requires integration | Active member's selected workspace | Existing private name only | Keep private switcher distinct from public profile; server-authorized badge | None | None |
| Status indicator | Journey state branches exist | Needs common visual adapter | Application/admission/Priority state | Existing text styles; not Apex variants | Pure state-to-presentation adapter, preserve revoked/none | None | None |
| Admission/reveal identity | Server HTML and journey helpers exist | Not drop-in client component | Accepted transaction's cohort/number | Existing reveal, no Apex pass | Server-safe static SVG/text rendering; preserve flow | None | None |
| Identity share card (future) | Separate 13B typed renderer; absent here | Shared pure geometry possible | Narrow 13B variant/name/number/headline | Four identity variants on that branch | Later adapter, not a second badge engine | Only if adding unsupported identity/date fields | Four separate 13B migrations + runtime gates |
| 1200x630 OG (future) | Separate 13B `ImageResponse` renderer | Pure approved SVG subset only | Same revalidated publication DTO | Existing OG composition, no Apex assets | Later shared geometry adapter, render-test support | Same as above | Separate 13B release required |
| 1080x1350 portrait (future) | Same separate 13B renderer | Same geometry reuse | Same publication DTO | Portrait composition exists there | Later format/layout adapter | Same as above | Separate 13B release required |
| 1080x1080 square (future) | Same separate 13B renderer | Same geometry reuse | Same publication DTO | Square composition exists there | Later format/layout adapter | Same as above | Separate 13B release required |

No frontend calculates an official membership number. Formatting an already-authoritative number is allowed; allocation is not. Current formatting is inconsistent: wall `#0007`, Founding pass/admission/13B `#07`, Early 100 pass/admission/13B `#042`, Early Access `#0007`. Agree a pure presentation format with the approved design; do not alter saved numbers or namespaces.

## C. Existing slots and minimum missing work

The current component interfaces are:

```ts
CohortBadgeProps = {
  cohort: "founding_25" | "early_100";
  className?: string;
};
MemberIdentityProps = { identity: PublicMemberIdentity; className?: string };
IdentityFallbackProps = {
  asset: Extract<PublicMemberIdentityAsset, { kind: "monogram" | "placeholder" }>;
  className?: string;
};
FounderPassArtworkProps = {
  cohort: "founding_25" | "early_100";
  number: number;
  identity: PublicMemberIdentity;
  displayName: string;
  className?: string;
};
```

`FounderPassArtwork` currently only renders `MemberIdentity` with cohort/number data attributes and an aria label. It does not render a pass, serial, badge, date, headline or company layout and has no route consumer. Calling it “implemented final Founder Pass artwork” would be inaccurate.

Minimum presentation repairs after approved assets arrive:

1. Keep these public interfaces, adding compatible size/tone/fit and existing public date/headline inputs where necessary. Split approved pure artwork from the client-only image-failure wrapper; do not move authority into components.
2. Connect `/members/[slug]` to the same identity selector and pass surface; distinguish Founding and Early 100 labels/compositions. Add loading/error/unavailable behavior without reproducing hidden data.
3. Connect authorized private membership/profile data to Settings and compact workspace presentation. Add explicit, independent consent controls; profile editing is currently API-only.
4. Reuse one shared geometry/presentation family for admitted badges, with separately typed Early Access identity and revocable Priority status. Do not force waitlist variants into the permanent-cohort enum.
5. Agree serial formatting, logo containment versus avatar cropping, supported sizes, long-name handling, and reduced-motion rules from the approved exports. Do not invent these visuals.

Existing wall cards intentionally do not link to a pass. Adding links would require explicit, current pass-eligibility data in an approved narrow projection; `wall_visible` alone must never imply it. No such extension is needed to import badge/identity artwork.

## D. Actual design inventory and exact export manifest

### Available versus absent

The audited branch contains `docs/design/About.dc.html`, `Contact.dc.html`, `Wanterest Auth.dc.html`, and the Members identity handoff. It contains no definitive Apex 2.0 master, approved export manifest, or Apex badge/pass SVG collection. `public/*.svg` contains scaffold files (`file`, `globe`, `next`, `vercel`, `window`), not member artwork. Marketing avatar/source assets are not member consent or badge masters.

Read-only local inventory outside this branch found `Wanterest App Redesign.dc.html`, `Wanterest Early Access.dc.html`, `Wanterest Emails.dc.html`, and `Wanterest Homepage Access.dc.html` under `docs/design/claude/originals/` in the desktop and emails checkouts. They are not tracked in the audited integration branch. Older Early Access HTML includes inline badge geometry (including `viewBox="24 17 72 91"`); that does **not** establish the definitive Apex 2.0 geometry, approval, or export variants. These files were not copied or treated as final Apex masters.

Founder/Claude must supply the actual approved Apex 2.0 source document and editable vector exports, with revision/approval identity. A screenshot/PDF alone is not an SVG export. Preserve the source file's real name in `docs/design/claude/originals/`; do not invent an original artifact or reconstruct approved artwork from an old mockup.

### Import manifest

The following are **proposed exact engineering filenames**, not claims that exports already exist. Claude may supply an equivalent approved consolidated sprite/`currentColor` master; record the approved mapping rather than redrawing variants. All missing viewBoxes and certified minimum sizes must come from the approved source. Do not substitute the master-logo viewBox for an Apex badge viewBox.

Destination root: `public/identity/apex-2/`. Source/approval manifest: `docs/design/claude/apex-2/manifest.md`. Future pure React geometry wrapper: `src/components/identity/apex-artwork.tsx` (not created in this audit).

| Required filename(s) under destination root | Target | Required viewBox | Variants | Dynamic placeholders outside static file | Minimum size / accessibility | Export status |
| --- | --- | --- | --- | --- | --- | --- |
| `apex-mark-light.svg`, `apex-mark-dark.svg` | Shared approved artwork leaf for all badge/pass adapters | Exact approved master value, **not supplied** | Light/dark where approved | None | Certified minimum not supplied; decorative within labeled badge | Missing |
| `badge-founding-25-light.svg`, `badge-founding-25-dark.svg` | `CohortBadge`, compact/admission/pass adapters | Exact approved badge master, **not supplied** | Founding, required background tones | Official serial stays live text | Certify smallest app/ladder target (existing mark is 13px high); parent announces Founding 25 + actual serial if present | Missing |
| `badge-early-100-light.svg`, `badge-early-100-dark.svg` | Same | Exact approved badge master, **not supplied** | Early 100, required background tones | Own official serial stays live text | Same small-size certification; label Early 100, never Founding | Missing |
| `badge-early-access-light.svg`, `badge-early-access-dark.svg` | Waitlist identity/reveal adapter | Exact approved pre-admission master, **not supplied** | Permanent verified waitlist identity | Independent Early Access number | Certified minimum not supplied; announce Early Access, not admitted cohort | Missing |
| `badge-priority-access-light.svg`, `badge-priority-access-dark.svg` | Current Priority status adapter | Exact approved status master, **not supplied** | Active status; revoked/absent is not an active badge | No fabricated serial, rank or allocation | Certified minimum not supplied; text announces current/revoked status as appropriate | Missing |
| `identity-frame-light.svg`, `identity-frame-dark.svg` | `MemberIdentity` approved tile frame | Exact approved tile master, **not supplied** | Logo/avatar framing only where approved | Public image is separate | Existing wall tile 48x48; certify proposed compact sizes; frame decorative | Missing |
| `identity-placeholder-light.svg`, `identity-placeholder-dark.svg` | `IdentityFallback` neutral placeholder | Exact approved neutral master, **not supplied** | Light/dark; monogram composition if approved | Persisted monogram stays live text | Existing tile 48x48; accessible public name supplied alongside, no fake user image | Missing |
| `pass-founding-25-light.svg`, `pass-founding-25-dark.svg` | `FounderPassArtwork` Founding composition | Exact approved pass master, **not supplied** | Founding and approved tones | Public display name/identity, cohort number, headline, admission month | Minimum card width/aspect ratio from source, not supplied; semantic text alternative | Missing |
| `pass-early-100-light.svg`, `pass-early-100-dark.svg` | Same, Early 100 composition | Exact approved pass master, **not supplied** | Early 100 and approved tones | Same fields, independent serial | Same certification; accessible Early 100 pass label | Missing |
| `identity-og-1200x630.svg` | Later existing 13B renderer blueprint/background | `0 0 1200 630` only if author exports this full-canvas file; otherwise preserve actual master viewBox | Approved OG identity compositions | Existing revalidated 13B identity/name/number/headline | Exact output 1200x630; page/preview supplies textual equivalent | Missing; future 13B only |
| `identity-portrait-1080x1350.svg` | Same later renderer | `0 0 1080 1350` only for an approved full-canvas export | Portrait | Same supported DTO fields | Exact output 1080x1350; readable at intended social preview size | Missing; future 13B only |
| `identity-square-1080x1080.svg` | Same later renderer | `0 0 1080 1080` only for an approved full-canvas export | Square | Same supported DTO fields | Exact output 1080x1080; textual equivalent on destination | Missing; future 13B only |

A full-canvas export is optional if Claude supplies a composition specification using reusable masters. The three output dimensions are authoritative 13B requirements; other viewBoxes/aspect ratios/minimum sizes are genuinely unknown, not engineering guesses. Dark exports are required only for approved dark placements; a missing dark design is not permission to invert colors arbitrarily.

Each supplied export/manifest must include revision, source document, target placement, viewBox, dimensions/aspect ratio, safe-area and minimum-size guidance, approved colors, font/license requirements, light/dark mapping, variable-text slots, and accessibility/motion notes. Never bake names, numbers, dates, emails, private IDs or other member data into static assets.

### Safest vector implementation

Reuse the existing inline SVG/static asset approach without a new loader dependency. Preserve approved master-logo geometry separately from membership artwork. Review trusted design SVGs for scripts, event handlers, `foreignObject`, executable/external references and embedded tracking. Keep approved geometry intact; use live semantic text for variable fields. Avoid font dependencies unavailable to server image rendering; request licensed font files or approved outlined decorative lettering when needed.

Use unique DOM gradient/mask IDs (`useId` in a suitable DOM wrapper) and deterministic collision-free IDs for server image composition. Do not embed a client-hook component into `ImageResponse`. Keep a pure artwork leaf reusable by DOM and the existing future 13B renderer; browser image fallback remains a separate client wrapper. Confirm the actual SVG subset in rendered output before claiming Satori compatibility. Motion, if approved, must have a static `prefers-reduced-motion` fallback. Decorative SVGs should be hidden from assistive technology when equivalent visible text labels the identity.

## E. Authoritative identity contracts and flow

| Identity | System of record / allocation | UI source and restrictions |
| --- | --- | --- |
| Founding 25 | Immutable `workspace_cohort_memberships`, founding allocator capacity 25, unique `(cohort, cohort_number)` and workspace | Private workspace cohort query or consent-filtered public RPC. Permanent workspace historical identity, not subscription state. |
| Early 100 | Same table, separate early allocator capacity 100 and number namespace | Same flow; does not continue Founding serials or use waitlist numbers. |
| Early Access | `waitlist_applications.early_access_number`, independent sequence allocated on successful first email verification | Private verified/status application result, formatted by journey helpers. Application submission alone does not finalize a number. |
| Priority Access | `waitlist_priority_access`, granted/revoked status and referral qualification contract | Current referral/Priority result. Revocable status, no permanent cohort number or admission entitlement. |

Relevant migration sequence already present in the main reference: waitlist foundation `20260927100000`; cohort foundation `20260927202715`; qualified RPC repair `20260927212000`; cohort benefits `20260927212230`; Priority/referral `20260927231925`; public profiles `20260928004407`; monogram repair `20260928012224`; admission/reveal `20260928015335`; admission ambiguity repair `20260928025042`; launch access mode `20260928031157` (full filenames are in `supabase/migrations/`). These historical files were not changed.

The current canonical `provision_workspace_admission` transaction creates the workspace/owner membership, assigns entitlements, invokes the cohort/benefit assignment seam, initializes a private public profile when eligible, and records admission. Invite acceptance and legitimate OPEN signup use the existing authority; visual changes must not touch that transaction.

Important precision: admission-only allocation is enforced by the privileged application workflow and lack of public allocator execution. The low-level service-role allocator does not independently require an already-inserted admission row: admission is recorded later in the same transaction. Do not claim an additional database invariant that does not exist, or expose that allocator to frontend calls.

The allocator locks state in a consistent order, returns an existing workspace identity on repeat, enforces independent capacities/unique serials, and never recycles numbers. An immutable trigger rejects cohort membership updates/deletes. Subscription expiry or selected-member changes do not rewrite that row. Workspace inactivity should suppress publication, not erase provenance.

Public flow: consented SQL projection -> explicit repository mapping/Zod -> server selector -> serializable wall identity -> presentation. Pass flow: consented SQL projection -> cached public-pass service -> metadata/page. Private flow: authenticated query + SQL owner/admin/membership validation -> private presentation; never accept a browser-supplied cohort or serial as authority.

Monogram normalization is the existing Layer 13A.4 contract: NFKC, ASCII alphanumeric words, initials of first two words or first character of one word, uppercase, bounded length, fallback `WN`; the SQL repair matches the TypeScript helper. Explicit valid saved monograms remain authoritative. The presentation selector does not derive another monogram algorithm.

## F. Privacy, consent, URL safety and revocation

### Boundaries that exist

- Profile initialization defaults `wall_visible=false` and `pass_visible=false` independently. Presence of a private file/image is never used as publication approval.
- Public wall RPC filters only wall consent; public pass RPC filters only pass consent. Wall cards are not links and carry no pass-visible flag. Wall-only profiles cannot acquire public passes through the UI.
- Public projection has exactly slug, display name, logo/avatar URL, monogram, headline, website, cohort, serial, capacity and assignment time. It excludes workspace/profile/membership/user/application IDs, email, invitation/status tokens, private strategy, products, Actions, Experiments and connector payloads.
- Public profile is workspace-level, not product intelligence; there is no product selector or product-owned public data in these DTOs. Composite `(workspace_id, cohort_membership_id)` foreign keys and joins prevent a profile from referencing another workspace's identity.
- Private GET/PATCH require an authenticated session; SQL checks active owner/admin authority. Direct public table access is not granted. Public slugs are identifiers, not authorization credentials.
- Visibility mutations append internal cohort events. Revocation hides current public projections rather than deleting permanent identity history.
- Wall/pass routes are dynamic; public service uses request-level React memoization, not persistent authorization caching. An unavailable pass supplies generic noindex metadata and `notFound`, not the previous identity.

### Concrete gaps / minimum corrections

**Release gate: active-workspace hiding is not in the original deployed-reference 13A.4 functions.** The pending repair adds it to both public reads. Without that migration, consented suspended/archived workspace profiles can remain publicly readable. Do not implement a frontend-only filter as a substitute; anonymous RPC callers would bypass it.

**Release gate: public URL validation is inconsistent.** `publicProfileInputSchema` accepts HTTPS URLs, but does not reject URL username/password, private/local destinations, or secret-bearing query/fragment content. SQL only has a broad HTTPS/length rule. `safePublicImage` rejects username/password when selecting wall images; the repository's public projection still returns raw URLs, and the public pass uses the raw `websiteUrl` as its link. Selector tests therefore do not prove secrets cannot leave the public RPC. This is an owner-controlled unsafe publication input, not evidence that this audit found an actual leaked credential.

Minimum correction in a separately authorized repair: a documented credential-free public URL policy at input **and** authoritative SQL/public projection boundaries, covering website/logo/avatar; reject userinfo and known private/auth/signed access URLs; require owner confirmation of non-secret public endpoints, with clear query/fragment rules. Do not blindly strip query strings from otherwise valid public assets or pretend all secret URLs are machine-detectable. Test direct anonymous RPC output as well as DOM selection. Maintain no server-side fetch of arbitrary profile URLs. If database rules/projections change, use a reviewed additive migration and isolated runtime validation, not silent rewriting of historical files.

**Consent editor integration risk:** the HTTP method is PATCH, but the Zod input behaves like full replacement: absent visibility flags become false and optional profile fields become null. SQL itself can preserve null visibility parameters, but the repository sends concrete parsed defaults. A future editor must submit both current flags and the complete intended profile, or use a deliberately reviewed compatible partial-update contract. Do not assume a one-flag PATCH preserves the other. This currently fails private, rather than accidentally enabling consent.

**Type coverage gap:** generated Supabase types lack the cohort/public-profile contracts; the adapter's string RPC client and runtime schemas allow typecheck to pass. Reconcile generated types with approved, isolated schema output or add convention-compatible explicit typed RPC contracts and tests. Do not regenerate from an incomplete database or claim current generated types prove SQL parity.

Additional review notes, not a demand for broad repair here:

- Existing private-profile API responses do not explicitly add a private `no-store` header. Add that defensive boundary when integrating the editor; do not cache authenticated profile data or permissions.
- Identity fields are explicitly public-profile inputs, not independent per-file license/ownership proof. Owner/admin consent is the current publication model; no upload verification or separate image consent registry exists.
- Published images are fetched directly by visitors with `no-referrer`; the external host still receives the browser request/IP. Document that consequence or later use vetted public storage. Revoking a page cannot retract browser/third-party copies already downloaded.
- Live-page changes require a new authoritative response; an already-open tab/static external image is not actively recalled. No browser/runtime test proved revocation timing.
- Static schema review identifies `ON DELETE SET NULL` provenance/user foreign keys on immutable cohort rows. Their FK update may conflict with the reject-all-update trigger during source/account deletion. Verify this in isolation before defining an erasure workflow; do not weaken permanent identity immutability or claim an observed production failure.

## G. Pending SQL and security assessment

The integration-only SQL inventory is exactly:

`20261030000000_public_members_wall_active_workspace_repair.sql` — **NOT_RUNTIME_VALIDATED** and unapplied by this audit.

It depends on existing 13A.4 tables/functions and workspace status, not 13B. Its later timestamp does not imply a dependency on 13B migrations absent from this branch. Do not import those missing migrations to make timestamps contiguous.

It replaces, without adding overloads:

```sql
public.get_public_cohort_wall(p_cohort text)
public.get_public_cohort_profile(p_public_slug text)
-- Both return:
TABLE (
  public_slug text, display_name text, logo_url text, avatar_url text,
  monogram text, headline text, website_url text, cohort text,
  cohort_number integer, cohort_limit integer, assigned_at timestamptz
)
```

Both are PL/pgSQL `SECURITY DEFINER`, `SET search_path = public`; neither explicitly declares `STABLE` (default volatility remains unchanged). Both retain composite profile/membership joins, narrow fields and their independent consent predicate. Both add `workspaces.status='active'`. Wall sorting is by authoritative cohort number; caps/uniqueness bound its maximum rows (25 and 100), although the query has no explicit LIMIT. Pass slug is unique.

Static grants: revoke all function privileges from `PUBLIC`, `anon`, `authenticated`, then grant EXECUTE to `anon`, `authenticated`, `service_role`. This public execution is intentional for narrow public reads; it is not a public mutation grant. Base private profile read/update RPCs grant authenticated/service execution with owner/admin validation; initialization and cohort allocation remain service-only. Private tables have RLS and no anonymous/authenticated direct table grants. Function owners, effective schema CREATE privileges, RLS bypass behavior, actual signatures/grants and transaction behavior still require isolated PostgreSQL verification.

No likely output-signature mismatch was found in the pending replacement: its 11 columns/types match the 13A.4 public functions and repository mapping. Static tests cannot establish CREATE OR REPLACE execution success. No new table, column, storage bucket or migration was added in this audit.

Minimum runtime matrix before public rollout: complete schema parity; apply exact pending repair; anonymous/authenticated/service public read grants; unauthorized private mutation denial; owner/admin and cross-workspace failures; all four consent combinations; manual revocation; active -> suspended/archived -> active visibility; invariant permanent numbers/history; empty/unknown slug; independent public RPC access. Validate any subsequently approved URL repair in the same isolated environment. No paid environment or production SQL execution is authorized by this audit.

## H. Logo/avatar fallback and future uploads

Implemented hierarchy is **explicit public company logo -> explicit public profile avatar -> persisted 13A.4 monogram -> neutral placeholder**. Failed images advance to the next ordered asset; changing the chain resets the renderer via its key. Loading is lazy, decoding asynchronous, and there is no server image proxy/provider call. Empty identity ends in a placeholder. The wall does not display a fake verification label or invent a member image.

Current shortcomings: tile size is CSS-fixed at 48px; both avatars and logos use cover; no explicit compact/large/fit API; no runtime browser test of sequential failures; public pass bypasses the new hierarchy; fallback is an em dash, not approved branded art. Public display text supplies context while decorative identity images/fallbacks are aria-hidden. Pass accessible labeling needs an Early 100-specific wording when wired.

No authenticated upload endpoint, vetted public image bucket, private/public object policy, file-validation pipeline or image publication lifecycle exists for this feature. Do not assume marketing avatar PNGs or an external URL demonstrate upload readiness.

Minimum future upload infrastructure, only when separately approved:

1. Authenticated active owner/admin membership check against the selected workspace; server-owned object paths/ownership, bounded quotas and practical abuse limits. No browser-chosen cross-tenant storage paths.
2. Private staging by default; enforce actual decoded MIME/dimensions/byte limits, sanitize metadata and re-encode supported raster images; reject active SVG/HTML payloads for member uploads unless a dedicated safe SVG pipeline is approved. Never trust extensions or client MIME alone.
3. A separately authorized, explicit public publication step for vetted derivative images and their profile fields. Private signed URLs must not become public artwork merely because they load. A public bucket requires acknowledging public copies cannot be recalled.
4. Storage/database policies and object ownership, revocation/update semantics, versioned public derivatives, deletion/retention policy, and rollback cleanup that cannot delete another workspace's object. Align object publication with wall/pass consent; never conflate public-file existence with page consent.
5. Isolation/upload/content-validation/revocation tests and an operational abuse/takedown path. Server image rendering, if ever allowed, must use controlled assets and bounded processing, not arbitrary owner URLs.

This is an infrastructure requirement list, not a proposed speculative schema/bucket implementation. Existing external URLs can remain a supported explicit public-profile input after the URL boundary is repaired.

## I. Future 13B compatibility, read-only

The separate 13B branch has `/share/[slug]`, its OG route, portrait/square image endpoint and authenticated applicant/workspace management paths. It uses `src/components/share-cards/share-card-artwork.tsx`, a shared pure React composition across 1200x630, 1080x1350 and 1080x1080. Its typed identity variants are Early Access, Priority Access, Founding 25 and Early 100; intelligence variants use the same engine.

Reuse approved pure Apex geometry there later. The current local `member-identity.tsx` is a client module with image-failure state, so it is not a direct `ImageResponse` import. Extract shared presentation geometry when authorized; keep format adapters in the existing engine rather than introducing another card renderer/badge system.

13B's existing artwork data supports variant, public display name, headline and identity label/number; it does not carry the wall's logo/avatar/monogram/assignment date. Adding those fields is not an asset-only change: it requires a narrow authoritative DTO/publication/RPC review on the separately released 13B branch. Do not fabricate a join, private image or admission month in OG rendering. No arbitrary image-provider retrieval or permission cache is acceptable.

Separate unreleased 13B migration inventory, **not included or applied here**:

1. `20261026000000_layer13b1_dynamic_share_card_engine_v1.sql`
2. `20261027000000_layer13b2_intelligence_sharing_v1.sql`
3. `20261028000000_layer13b3_public_intelligence_attribution_v1.sql`
4. `20261029000000_layer13b_integration_repair_v1.sql`

Their runtime validation/release gates remain separate. Current F1 `_lib/journey-data.ts` explicitly returns unavailable sharing without touching these RPCs. Apex import must not activate sharing, change referral attribution, or bypass publication/revocation rules. Future images and destinations must revalidate the same publication; external OG caching remains unavoidable and must be disclosed.

## J. Exact ordered implementation plan and scope protection

1. Obtain approved definitive source/vector exports and manifest from Claude/founder. Confirm real viewBoxes, minimum sizes, typography/licenses, layouts and variants; decide serial formatting and whether one public display name suffices. No redraw from screenshots.
2. Repair the public URL authority boundary and reconcile missing cohort RPC type contracts in a separately approved focused change. Preserve existing fields, consent defaults and business rules. Treat any new SQL as unvalidated until executed in isolation.
3. Import reviewed static masters into the proposed identity namespace. Add pure geometry adapters using existing SVG support; preserve the official Wanterest master logo. No unnecessary packages or globals/homepage redesign.
4. Adapt the four existing slots with compatible size/tone/fit and pass text/date props from current DTOs. Add separately typed Early Access/Priority visual variants. Keep authority outside the components.
5. Wire public pass/profile and wall to those adapters. Keep wall cards non-clickable without independently authorized pass eligibility; test revoked/empty/error states and metadata privacy.
6. Wire authorized Settings membership/consent controls and compact private workspace badges. Make replacement-versus-partial PATCH semantics explicit and add private no-store responses. Do not make public data the authority for private workspace access.
7. Adapt existing waitlist/status/admission presentation only. Preserve the private cookie routes, invite acceptance, numbering and email triggers. Server HTML reveal must remain server-safe.
8. Add offline contract tests plus actual desktop/tablet/mobile browser checks: long names, missing image, sequential broken images, logo containment, keyboard tabs/controls, contrast, reduced motion, empty/ineligible/loading/error states, light/dark at certified small sizes. Do not use artificial production admissions.
9. Execute complete-schema isolated SQL validation of the pending active-workspace repair and any separately approved URL repair. Verify grants, composite tenancy, all consent combinations and current revocation against RPC callers. This is required before public release, not silently waived by a passing build.
10. Run focused identity/cohort/Early Access/Evidence Fidelity, typecheck, lint, clean build and full Vitest; inspect exact diff. Review and push an implementation branch. Merge/deployment require a separate authorization and release gate.
11. Integrate 13B artwork reuse only in its separately authorized, SQL-validated sharing rollout. Do not bring its routes/migrations into the current F1 integration as an Apex dependency.

Overlapping frontend targets needing coordination: `src/components/members/member-identity.tsx`, wall TSX/CSS, `/members/[slug]`, `/app/settings`, dashboard shell/switchers, waitlist journey views/ladder and invite-complete server HTML. No change is needed to qualification/Evidence Fidelity, 12A.6, P2.2B, referral thresholds, cohort allocation, entitlements, access-mode policy, waitlist numbering, admission transactions or transactional email triggering. Do not modify email templates merely to integrate web identity art; a separate approved email-artwork task can later reuse exports under email-safe constraints.

## K. Executed validation and remaining test gaps

All commands ran in the requested integration worktree. No environment file was created/read/changed and no runtime opt-in was enabled. The clean build removed only that worktree's verified generated `.next` directory before `npm run build`.

| Check | Actual result |
| --- | --- |
| Focused cohort/public identity/wall/benefits + Early Access/referral + Evidence Fidelity | **21 files, 153 tests passed** |
| Evidence Fidelity focused file | **39 tests passed**, also passed in full suite |
| `npm run typecheck` | **PASS**, exit 0 |
| `npm run lint` | **PASS**, zero errors; two existing unused `_message` warnings in `tests/modules/waitlist-admission.test.ts` at lines 17 and 89 |
| Clean `npm run build` | **PASS**, Next 16.3.5; wall and public pass remain dynamic; no sharing routes added |
| `npx vitest run` | **207 files passed, 13 skipped; 1,655 tests passed, 16 skipped; zero failures** |
| PostgreSQL runtime / effective grants / deployed parity | **NOT_RUNTIME_VALIDATED** |
| Real browser visual/consent/image-fallback behavior | **NOT PERFORMED** |

Focused invocation:

```text
npx vitest run
  tests/modules/cohort-public.test.ts
  tests/modules/cohort-public-identity.test.ts
  tests/modules/cohort-membership.test.ts
  tests/modules/cohort-benefits.test.ts
  tests/modules/cohort-benefit-cycles.test.ts
  tests/modules/cohort-benefit-provider.test.ts
  tests/components/public-members-wall.test.tsx
  tests/rls/cohort-public-migration.test.ts
  tests/rls/cohort-membership-migration.test.ts
  tests/rls/cohort-membership-rpc-repair.test.ts
  tests/rls/cohort-benefit-migration.test.ts
  tests/rls/public-members-wall-migration.test.ts
  tests/components/early-access-journey.test.ts
  tests/app/early-access-journey-routes.test.ts
  tests/components/waitlist-request-form.test.ts
  tests/modules/waitlist.test.ts
  tests/modules/waitlist-admission.test.ts
  tests/modules/waitlist-admission-route.test.ts
  tests/modules/referral-priority.test.ts
  tests/modules/referral-priority-policy.test.ts
  tests/modules/evidence-fidelity-regressions.test.ts
```

The focused wall tests server-render markup/empty states and inspect keyboard handlers; they do not dispatch real browser interactions. Identity tests establish hierarchy and basic URL rejection in the selector, not input/SQL publication safety. SQL tests inspect text contracts, not execution. Existing opt-in PostgreSQL/provider smoke tests remained skipped; they were not disabled by audit changes. No known baseline failures occurred in this checkout/run, so none were waived.

Required additional tests during implementation/runtime validation: generated cohort RPC signatures; both consent flags through real authenticated CRUD; unauthorized and cross-workspace profile access; direct-public-RPC URL safety; active/suspended/archived visibility; public metadata/page agreement after revocation; browser image fallback/reset; desktop/mobile pass/card rendering; no frontend serial spoofing; waitlist/Priority separation; SVG accessibility/small-size/reduced-motion; future 13B image output dimensions/DTO consistency on its own branch.

Performance assessment: wall uses two parallel, bounded-by-cohort RPCs, not per-card reads; pass uses a unique-slug lookup memoized within the request for page/metadata. Access mode is obtained server-side. No history load, demand analysis, provider retrieval or persistent permission cache was introduced. External images are browser requests per visible identity, not database N+1 queries. Approved asset import should retain these boundaries and existing P2.1 behavior.

## L. Final readiness decision

**READINESS_FIXES_REQUIRED**

Minimum import-readiness corrections: supply definitive editable Apex exports/manifest; connect the pass and missing private presentation slots through the existing contracts; reconcile cohort type coverage and the public URL boundary. None justifies redesigning identity, inventing assets, changing allocation rules or importing 13B.

Separately mandatory before public production release: isolated PostgreSQL/grant/revocation validation of `20261030000000_public_members_wall_active_workspace_repair.sql` and any approved URL repair; actual browser visual/consent/fallback tests; verified ownership/licensing of supplied image assets and an operational correction/takedown path. Secure uploads and future 13B sharing are separate optional infrastructure/releases, not permissions to build them now.

This audit changes documentation only. No merge, deployment, SEO implementation, production migration, paid database, or business-rule change is authorized or performed.
