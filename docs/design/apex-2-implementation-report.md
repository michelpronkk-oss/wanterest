# F1.6B — Apex 2.0 visual integration report

Date: 2026-09-29. Branch: `feature/f1-6b-apex-visual-integration`. Asset manifest:
[`docs/design/claude/apex-2/manifest.md`](claude/apex-2/manifest.md).

**Verdict: `APEX_VISUAL_INTEGRATION_PARTIAL_WITH_EXPLICIT_BLOCKERS`** — every approved surface that
existing contracts can support is implemented, rendered by its real route and browser-verified with
labeled fixtures; the remaining items (§17) are blocked by missing source exports, by contracts this
task was told not to invent, by the unreleased 13B layer, or by SQL/real-data release validation.
Nothing here is production approval.

## 1. Verified starting point

| Reference | SHA |
| --- | --- |
| Remote/local branch HEAD before work | `7451ede1a5b43c8cdf74dafaf71923ee6624f9cb` ("docs: add approved Apex 2.0 design source") |
| F1.6A parent (ancestor, verified) | `88a24b178394837cab1a287a9f72d970aeb687f6` |
| F1.5 audit (ancestor, verified) | `e460c2afa9517427c88cd69ba18117bbe626e9c2` |

Worktree was clean. The design source was present and is unchanged. The commit containing this
report is reported with the delivery (embedding it here would be circular).

## 2. Complete design inventory

The source was rendered in Chromium and every board inspected, plus all 216 inline SVGs (24 unique).

| Board | Content | Class | Implemented as / consumer |
| --- | --- | --- | --- |
| 00 Cover | Pass hero, badge row | A geometry, B layout | Reference only (not a product surface) |
| 01 Geometric exploration | Apex 1.0, A, B, **C · Keystone (selected)** | A (C only) | `APEX_GEOMETRY` |
| 02 Definitive system | Construction, 4 identity cards, specs | A/B | Geometry, tokens, pre-admission marks |
| 03 Badge variants | Plate ladder 16–64, 4 surfaces, sm/md pills, status, activity, publication | A/B | `ApexPlate`, `CohortBadge`, `AccessStatusChip`, `WorkspaceActivity`, `PublicationChip` |
| 04 Fallbacks | Logo/photo/monogram ink·ivory·neutral/round/neutral 20–96, type specs | B | `IdentityFallback`, `IdentityImageFrame`, `MemberIdentity` |
| 05 Member card | A serial-led (selected), states, compact, expanded | B | `MemberWallCard` (default, compact) |
| 06/07 Wall | Founding / Early 100 tabs, grid, CTA band | B | `PublicMembersWall` → `/members` |
| 08 Empty states | Desktop + mobile | B | `PublicMembersWall` empty panel |
| 09 Founder Pass | Horizontal 960×420, vertical 340w, monogram-only, compact, expanded 1120×520 | B (composition); C (static SVG) | `FounderPassArtwork` horizontal/vertical/compact |
| 10 Early 100 Pass | Horizontal, vertical, compact | B / C | Same component, Early 100 edition |
| 11 Profile desktop | Breadcrumb, header, pass hero, fact tiles, wall-only note | B | `MemberProfileView` → `/members/[slug]` |
| 12 Profile mobile | 375pt column, 46px actions | B | Same, ≤767px |
| 13 Early Access / Priority | Reveal, Priority, compact/expanded rows, promotion, revoked | B | `EarlyAccessPill`, `PriorityPill`, `EarlyAccessNumber` → waitlist views |
| 14 Reveals | Founding 1200ms / Early 800ms timelines, 4 cards, motion notes | B | `admissionHtml` → `/invite/complete` |
| 15 Social sharing | 1200×630, 1080×1350, 1080×1080 for 4 variants | C | **Not implemented** (13B, out of scope) |
| 16 Compact app | Sidebar identity, topbar, switcher, tooltip, Settings, toggles, list rows, mobile nav | B | Shell, top bar, Settings |
| 17 Responsive | Wall 4/2/1 columns, "when to use what" | B | CSS breakpoints 1120/640 |
| 18 Tokens & handoff | Colours, type, shape, motion, component APIs, asset library | B / D (files) | Tokens used verbatim; asset library regenerated |

## 3. Artwork extracted from the source

Both Apex cuts (standard 3u, micro 7u), their four approved fills, and the master logo geometry —
verbatim, viewBox `18 18.65 84 84` / `0 0 120 118`. Cut switching follows board 03 exactly
(glyph < 24px → micro). See manifest table "Extracted geometry".

## 4. Artwork not extractable

`founder-pass-artwork.svg`, `early100-pass-artwork.svg`, `share-og-founding-artwork.svg` (C: file
contents never defined); licensed/outlined typography for server image rendering (D). All 16 board-18
files are referenced as `<img>` but absent from the source bundle; 13 are reproduced from explicit
geometry (B) and labeled as such, 3 are not invented.

## 5. Source-to-component mapping

See manifest. The four stable handoff components keep their prop contracts (extended compatibly):
`CohortBadge` (+`micro` size; unused `large` removed — it had no consumer or approved design),
`MemberIdentity` (same props; frame/shape per board 04), `IdentityFallback` (branded neutral tile
replaces the em dash), `FounderPassArtwork` (+`layout`, `admissionMonthLong`, `animate`).
`member-identity.tsx` stays the import boundary; pure artwork lives in `member-identity-slots.tsx`,
`founder-pass.tsx`, `apex-artwork.tsx`; the only client module is the image-failure wrapper
`member-identity-client.tsx`.

## 6. Consuming routes

| Route | Components | Authority |
| --- | --- | --- |
| `/members` | `PublicMembersWall` → `MemberWallCard`, `ApexMark`, `ApexPlate` | Existing two parallel bounded `getPublicCohortWallsQuery` reads; unchanged mapping |
| `/members/[slug]` | `MemberProfileView` → `FounderPassArtwork`, `CohortBadge`, `MemberIdentity` | Current `getPublicCohortPassQuery` (pass-visible RPC) per request; `notFound()` + noindex metadata unchanged |
| `/app/settings` (new Membership tab) | `MembershipSection`, `PublicProfileEditor` | `getWorkspaceCohortIdentityQuery` + `getWorkspacePublicCohortProfileQuery`, existing PATCH API |
| `/app/**` shell | `WorkspaceCohortIdentity` (sidebar + mobile brand), `CohortBadge` micro (top bar) | `getWorkspaceCohortIdentityQuery(selectedWorkspace)` in parallel with billing |
| `/waitlist` (ladder), `/waitlist/verified`, `/waitlist/status` | `CohortBadge` (no number), `PriorityPill`, `EarlyAccessPill`, `EarlyAccessNumber` | Existing private status cookie + journey models |
| `/invite/complete` | `admissionHtml`, `reviewHtml` (pure strings) | Existing `acceptInvite` result only |

## 7. Founding 25

Ink plate/card/pass, lit keystone (only lime Apex in the system), two-digit serial `01–25`
(`07 /25`, `#07`, `No. 07 of 25`), "FOUNDING" pill / "FOUNDING MEMBER" pass label. Serial always
comes from the server; `admittedCohortPresentation` formats and range-checks, never allocates.

## 8. Early 100

White outlined plate/card/pass, ink keystone (paper on dark surfaces), three-digit serial `001–100`,
"EARLY" pill / "EARLY 100 MEMBER" pass label, separate namespace, accessible label "Early 100 #042".

## 9. Early Access / Priority

Kept as separate typed presentations, never passed to `CohortBadge`. Early Access: hollow-ring
family pill and Archivo number with muted `#` via the existing `earlyAccessLabel` (4-digit minimum,
grows). Priority: signal-dot pill with the original Early Access number, rendered only while
`granted`; revoked/absent returns quietly to Early Access (verified in browser). Membership ladder
and invite-state cohort preview now use the Apex badge family without numbers. Admitted status shows
the admission record's cohort badge. Sharing remains the truthful unavailable notice; no 13B import.
Waitlist numbering, verification, cookies, referral qualification and invitation handling unchanged.

## 10. Members Wall and public pass

Wall: board 06/07 hero, Apex tabs (ARIA tablist, arrow/Home/End unchanged), serial-led cards
4/2/1 columns (≥1120 / 640–1119 / <640), consent-safe empty state, dark CTA band using the existing
access-mode CTA. Cards are **not links** and never show "View pass" (wall DTO has no pass
eligibility). No extra queries. Pass/profile: breadcrumb, 96/64px identity, badge, horizontal pass
(≥900px) / vertical pass (<900px), fact tiles (desktop), Copy link, provenance note, website link.
"Share pass" is omitted (13B). Unavailable/unknown slug keeps the existing generic 404.

## 11. Settings and compact identity

Settings → Membership: Identity (badge + "Permanent"), Access ("Admitted", only when a permanent
cohort exists), Activity (workspace status — inactivity does not erase identity), Publication (wall
and pass chips independently). Public profile editor: two independent `role="switch"` controls,
display name, address, headline, monogram, logo/photo/website URL fields, explicit "uploads aren't
available yet" copy, save/discard/saving/saved/error states. **Every save sends the complete profile
including both flags** (`completeProfilePayload`), so the replacement-style PATCH can never reset the
other flag. Saved preview (wall card + compact pass) is re-rendered server-side after save. No
upload button, no new fields, no client URL validator (server policy + 422 message).

Compact identity: sidebar compact pill with keyboard/hover tooltip, mobile brand pill, top-bar
micro "#07" (hidden <1100px to avoid crowding). One request-memoized private read per render.

## 12. Admission reveal

`/invite/complete` POST success renders board 14 cards from the transaction result: Founding
(ink card, "You're Founding 07.", `07 /25`), Early 100 (white, "You're Early 042."), no cohort
("Welcome to Wanterest.", "Admitted" chip, no mark). Motion: keystone → peak → serial → label rises
(Founding 120/360/640/900/1200ms; Early 200/520/800ms), opacity + 8px only; reduced motion shows the
final state with a 200ms fade. Invite review uses the "Invitation ready" chip. HTML builders moved
to `admission-html.ts`; token handling, cookies, redirects, headers and `acceptInvite` unchanged.

## 13. Screenshot evidence

Real Chromium (Playwright, `/opt/pw-browsers`) against `next dev` with the gated fixture harness
`/dev/apex-fixtures` (404 unless `APEX_FIXTURES=1` in development; verified 404 in `next start`
even with the flag). All fixture data is fictional and labeled on-screen.

16 views × 7 viewports (1440×900, 1280×800, 1024×768, 768×1024, 390×844, 375×812, 320×700) = 112
captures: **zero horizontal overflow, zero page errors**. 27 curated captures are committed in
`docs/design/claude/apex-2/screenshots/`.

| State | Evidence |
| --- | --- |
| Founding wall / Early wall / empty wall | `wall-*`, `wall-early-tab-1280x800`, `wall-empty-*`; tab click, ArrowLeft and End exercised in Chromium (selection, focus and visible 2px focus ring asserted) |
| Logo / avatar only / monogram 1-2-3 / neutral | `index-1440x900`, `crop-fallback` |
| Failed logo → avatar; failed logo + avatar → monogram | `crop-fallback` (after fix, §14) |
| Long display name / absent headline | `wall-*`, `profile-long-768x1024` |
| Founding pass / Early 100 pass / unavailable | `profile-founding-*`, `profile-early-*`, `profile-unavailable-1440x900` |
| Settings membership, independent consent | `settings-*`; in Chromium, toggling only the Pass switch kept Wall on and the intercepted PATCH body was the complete profile with `wallVisible: true, passVisible: true` (API response mocked at the network layer) |
| Compact dashboard badge | `index-1440x900` (component fixture; real shell not rendered — needs auth) |
| Early Access / Priority active / revoked / admitted | `verified-*`, `status-*` |
| Admission reveals | `admission-*` |

Not browser-verified: real `/members`, `/members/[slug]`, `/app/**`, `/waitlist/status` and
`/invite/complete` with a real database/session (no Supabase environment here); real save round-trip
of the editor against the real API/SQL; clipboard permission; screen-reader output.

## 14. Deviations and fixes found in visual QA

Fixed during QA: (1) a pre-hydration image error left a broken logo instead of walking the chain —
now detected on mount; (2) that detection plus `onError` double-advanced and skipped the avatar —
advance is now idempotent per failed asset; (3) 20px plate glyph rounded to 13px instead of the
approved 12px; (4) stretched "Admitted" chip in the no-cohort reveal.

Adaptations (source lacks the decision, or a constraint applies):

- Monogram tile tone follows the boards' consistent usage (1 char ink, 2 ivory, 3 neutral).
- Avatars use the board 04 circle; board 10 once shows a square "photo" placeholder.
- Names wrap instead of truncating in compact rows ("no clipped names"); headlines clamp to 3 lines.
- No card hover lift: cards are not interactive.
- Wall hero/tabs/cards live inside the existing marketing shell (nav/footer not redesigned).
- CTA band subtitle shows only for the Request access mode.
- Profile tablet (768–899px) uses the vertical pass; horizontal from 900px.
- Workspace switcher shows no per-workspace badges (would need one query per workspace).
- "Show company logo" toggle not built (no backend field; logo publication = the logo URL field).
- Expanded 1120×520 card/pass variants not built (no consuming surface).

## 15. Validation

| Check | Result |
| --- | --- |
| New `tests/components/apex-artwork.test.tsx` | **32 passed** |
| Focused identity/wall/pass/journey/admission/cohort/paywall/perf (12 files) | **96 passed** |
| Evidence Fidelity regression | **39 passed** |
| Typecheck (`npm run typecheck`) | PASS (after build generated Next route types) |
| Lint | PASS — 0 errors; the 2 existing `_message` warnings in `tests/modules/waitlist-admission.test.ts` |
| Clean build (`rm -rf .next && npm run build`) | PASS, Next 16.3.5. In this sandbox `next/font/google` needs `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`; without it the pre-existing font fetch fails (environmental) |
| Full Vitest (container `GITHUB_TOKEN` unset) | **214 files passed, 13 skipped; 1,788 passed, 16 skipped, 0 failed** (F1.6A: 1,756 / 16) |

Environment notes, reproduced identically on an untouched `7451ede` worktree: the GitHub adapter
tests fail when the container's `GITHUB_TOKEN` is set, and the 12A.2 frozen-systems test needs commit
`241ae56` (fetched read-only for the run). Latent flake, not caused or fixed here (out of scope):
`adaptive-allocator` "is deterministic" compares telemetry containing wall-clock
`computationDurationMs`; it failed once under dev-server + browser load, passed 6/6 on baseline and
on this branch without load. Skipped tests are the existing opt-in PostgreSQL/provider tests and are
not equivalent to runtime SQL validation.

## 16. SQL / runtime dependencies (unchanged, unapplied)

1. `20261030000000_public_members_wall_active_workspace_repair.sql` — NOT_RUNTIME_VALIDATED.
2. `20261031000000_f1_6a_public_identity_url_authority.sql` — NOT_RUNTIME_VALIDATED.

Not edited, executed or applied. Until validated, the deployed public RPCs do not recheck workspace
activity or mask unsafe legacy URLs at the database boundary; the UI adds no substitute check. No
migration, storage or schema change was added.

## 17. Completeness gate and remaining blockers

| Component | Design | Artwork file | Component | Route | Data source | Variants | Responsive | Tests | Browser | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Apex mark / plates | 01–03 | 8 files | `ApexMark`, `ApexPlate` | all | — | cuts, 4 fills, 16–64 | n/a | ✓ | fixture | COMPLETE |
| Cohort badge | 03, 17 | — | `CohortBadge` | wall, profile, settings, shell, waitlist | server | micro/sm/md × light/dark × 2 cohorts | ✓ | ✓ | fixture | COMPLETE |
| Identity fallbacks | 04 | 3 files | `IdentityFallback`, `MemberIdentity` | wall, profile, settings, pass | public selector | logo/avatar/mono/neutral, failures | ✓ | ✓ | fixture | COMPLETE |
| Member card | 05 A | — | `MemberWallCard` | `/members`, settings | wall RPC | default, compact, both cohorts | ✓ | ✓ | fixture | COMPLETE (no "View pass": needs pass-eligibility contract) |
| Members Wall | 06–08, 17 | — | `PublicMembersWall` | `/members` | 2 parallel RPCs | tabs, empty | 4/2/1 | ✓ | fixture | COMPLETE — BLOCKED BY RUNTIME VALIDATION for release |
| Founder Pass / Early 100 Pass | 09, 10 | C (not supplied) | `FounderPassArtwork` | `/members/[slug]`, settings | pass RPC | horizontal/vertical/compact | ✓ | ✓ | fixture | PARTIALLY COMPLETE (expanded variant; static SVG exports BLOCKED BY SOURCE ASSET) |
| Public profile | 11, 12 | — | `MemberProfileView` | `/members/[slug]` | pass RPC | desktop/mobile | ✓ | ✓ | fixture | PARTIALLY COMPLETE ("Share pass" awaits 13B) |
| Early Access / Priority | 02, 13 | 2 files | pills, number | waitlist | journey models | EA, Priority active/revoked | ✓ | ✓ | fixture | COMPLETE |
| Admission reveal | 14 | — | `admissionHtml` | `/invite/complete` | `acceptInvite` result | Founding/Early/none, review | ✓ | ✓ | fixture | COMPLETE |
| Settings membership | 16 | — | `MembershipSection`, editor | `/app/settings` | private queries + PATCH | member/none/unavailable | ✓ | ✓ | fixture | PARTIALLY COMPLETE (no logo toggle — no contract; real save not browser-run) |
| Compact app identity | 16 | — | `WorkspaceCohortIdentity`, micro | `/app/**` shell | private query | sidebar, top bar, mobile | ✓ | ✓ | component fixture only | PARTIALLY COMPLETE (switcher per-workspace badges not built) |
| Social share cards | 15 | C | — | — | 13B | — | — | — | — | NOT IMPLEMENTED (13B; DTO lacks image/month) |

Decisions/assets still needed: the three composition SVG exports (or confirmation they are
unnecessary); licensed/outlined fonts for 13B server images; an approved narrow pass-eligibility
projection before cards may link to passes; whether the switcher should show other workspaces'
cohorts (needs a batched private query); a backend decision for a separate "show logo" consent.

## 18. Final readiness verdict

**APEX_VISUAL_INTEGRATION_PARTIAL_WITH_EXPLICIT_BLOCKERS**

Open release gates: isolated SQL/grant/revocation validation of both pending migrations; real-data
browser verification of the authenticated and database-backed routes; screen-reader review; image
ownership/licensing review. Not merged, not deployed, no SQL applied, 13B sharing not enabled.
