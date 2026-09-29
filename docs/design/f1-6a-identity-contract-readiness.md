# F1.6A identity contract repairs

Date: 2026-09-29. Branch: `feature/f1-6a-identity-contract-readiness`.

Starting parent/remote audit SHA: `e460c2afa9517427c88cd69ba18117bbe626e9c2`.
Fetched main reference: `51ced7673cc4c94b1b1f792d864baecca0295edd`.

This implements the asset-independent repair portion of the [Apex audit](apex-2-pre-integration-audit.md). Final artwork, visual layouts, sharing, uploads and production rollout are not implemented. The historical audit/handoff remain unchanged; this document records the subsequent repairs.

## 1. One public URL policy

Policy V1 lives in `src/shared/public-profile-url.ts` and is mirrored by the forward SQL migration. It applies equally to public company logo, avatar and website references.

- HTTPS only, an ASCII DNS hostname with a multi-label name/alphabetic TLD, maximum hostname length 253 and total URL length 2048. Only absent/default `:443` ports. No userinfo, bracketed IPv6, literal IPv4 (including public IPs), alternate numeric host encodings, trailing-dot hosts, raw whitespace, control characters or backslashes. Use explicit ASCII/punycode hostnames; unsupported hostname forms are rejected, not silently rewritten.
- Reject known local/private/reserved suffixes: localhost, local, localdomain, internal, test, invalid, example, onion, home, lan and corp. This is a syntax policy, not a DNS-resolution/public-routability guarantee; public-looking names can resolve privately. No network/DNS lookup or arbitrary image proxy is introduced.
- Reject known auth/private route segments, `/app` and `/api/workspaces` application paths, signed/authenticated storage object/image paths, and signed Cloudinary path forms. Validate percent-decoded UTF-8 paths, including encoded private segments; reject dot-segment ambiguity, doubly encoded path escapes and encoded query/fragment delimiters. Malformed escapes, invalid UTF-8 and C0/C1 controls are rejected.
- Preserve benign query strings verbatim, including CDN width/height/fit/format/version, marketing parameters, valid UTF-8 values and repeated benign keys. Decode names before checking; names must be ASCII alphanumeric/underscore/dot/hyphen. Normalize separators/case for credential-key matching. Reject known token/auth/API-key/password/session/invite/verification/OAuth-code/signature/expiry/cloud signing keys, AWS/Google signing prefixes and Azure SAS keys. See the policy's exact key list; do not assume it detects every secret parameter.
- Permit simple human-readable fragment anchors such as `#team`; reject fragment parameter syntax, known credential names/prefixes, malformed or empty anchors. Do not use fragments to carry auth/session state.
- Input normalization only trims outer whitespace, as before. Accepted references are not otherwise normalized, stripped, rewritten or fetched.

Examples: `https://assets.example.com/logo.png?w=96&fit=contain&v=2` is preserved; `https://name:password@example.com/logo`, `...?access_token=...`, `...?X-Amz-Signature=...`, a Supabase signed-object path, a local/private host, or a private workspace API URL is rejected.

The conservative policy can reject a technically public signed transformation or unusual host/port. Use a permanent credential-free public reference instead; do not remove signature/query pieces blindly. Unknown opaque path/query values can still be secrets, and an apparently public resource may actually require cookies. Owners must supply genuinely public, non-secret, authorized references. URL validation does not establish licensing, redistribution permission, image safety or image ownership. Existing profile consent remains the publication authority; no image-upload/publication model was invented.

### Enforcement pipeline

1. `publicProfileInputSchema` rejects unsafe new values before the repository is called.
2. The SQL trigger rejects unsafe inserted or changed URL fields even through a direct privileged write/existing upsert RPC. Existing owner/admin checks, private table grants and consent defaults are unchanged.
3. Both public SQL RPCs mask unsafe legacy URL fields as `null` at read time. All three fields are checked, not just rendered images; the eleven-column DTO shape is unchanged.
4. `publicCohortRowSchema` applies the same read-time masking before RPC data becomes an application DTO; private-profile mapping also masks unsafe references. Other/private fields are not copied into public DTOs.
5. The rendering selector uses the same shared policy. It no longer has a weaker independent URL checker.

No legacy database rows are backfilled or deleted by the migration. An unsafe unchanged legacy URL must not block a visibility-only revocation; the write trigger checks each changed field independently. A later application edit must replace/clear unsafe values instead of resubmitting them. The existing PATCH contract is still replacement-style: omitted optional fields become null and omitted visibility flags false. A future consent editor must send its complete intended values; this repair does not silently change PATCH semantics.

Application masking works without new RPC signatures. **Direct anonymous database RPC masking and SQL write enforcement still require validation/application of the migration. They are not deployed guarantees from this branch alone.**

## 2. Migration-reviewed type coverage

`src/server/db/cohort-contracts.ts` provides an explicit `CohortDatabase` extension of the existing generated `Database`, plus table row/insert/update/composite-relationship contracts and RPC args/results. No database generation was attempted against an incomplete/unverified schema. The existing generated snapshot and its UTF-16 encoding are untouched.

Coverage:

- `workspace_cohort_memberships`, `workspace_cohort_allocation_state`, `workspace_cohort_membership_events`, `workspace_public_cohort_profiles`.
- Assignment, atomic benefit-assignment wrapper and authenticated private workspace cohort identity RPCs.
- Public wall/pass, private profile read/upsert/initialization and existing monogram RPCs.
- The new stateless URL validator/decoder functions (pending SQL).

`withCohortRpcContracts` is one documented structural SDK boundary over the existing client. Both cohort repositories use the explicit typed function names/args/results instead of string RPC names, `Record<string, unknown>` result casts or `as never` service calls. It does not recreate a client, change its role/session or grant authorization. Zod still validates runtime data.

Static signature tests check exact public column order/types, private/upsert argument/column order, initialization, cohort identity and benefit-wrapper outputs. In particular, the private cohort identity RPC has `workspace_id` and no invented `benefit_policy_key`; the benefit assignment wrapper really has its two extra benefit columns. SQL text outputs stay `string`; runtime schemas narrow cohort/status enums. Nullable/date/optional fields follow migration definitions and repository semantics.

Catalog-generated FK names and one-to-one metadata remain deliberately general rather than invented. Reconcile with verified generation after isolated runtime validation. Compile-time contracts, immutable-row insert/update types and successful typecheck do not grant mutation permissions or prove database execution.

## 3. Prepared presentation interfaces

Existing imports remain compatible. No Apex SVG, new geometry, placeholder brand asset, global CSS or final dark-mode styling was added.

| Boundary | Asset-independent additions |
| --- | --- |
| `CohortBadge` | Permanent admitted cohort only; optional actual number, compact/standard/large size hook, light/dark tone hook. Existing wall calls still render only their cohort label. |
| `MemberIdentity` | Optional pixel size (default existing 48px; bounded 16–256), tone, explicit company-logo/avatar fit. Defaults contain company logos and crop avatars; image failure still walks the server-selected chain/reset key. |
| `IdentityFallback` | Same saved monogram/neutral fallback, size/tone inputs; no new monogram algorithm or branded placeholder. |
| `FounderPassArtwork` | Same authoritative cohort/number/name/identity plus existing public headline/admission month and size/tone. Accurate Early 100/Founding public-pass label and live serial hooks; still structural, not final pass artwork. |

`member-identity-slots.tsx` separates simple server/client-safe badge/fallback presentation from the image-loading client wrapper. `src/shared/member-presentation.ts` supplies permanent-cohort label/serial validation and UTC month formatting. It formats existing numbers; it does not allocate any. It keeps separate Early Access and revocable Priority types. The existing waitlist formatter/authority remains unchanged; do not use a permanent-cohort enum or cap for waitlist numbers.

`publicMemberPassPresentation` takes an already-authorized pass-visible DTO, strips private extras, applies the existing public selector and maps current fields. `/members/[slug]` now uses this adapter and `FounderPassArtwork` in its existing layout; existing canonical/metadata/not-found checks, headline/date text and independent pass consent remain intact. The wall route/cards/layout/tab behavior are unchanged; cards remain non-clickable and do not imply public pass visibility.

`privateMembershipPresentation` prepares an authorized Settings public-profile preview and independent visibility values, without a public link or private IDs. **It is not the sole source for a private cohort badge.** `workspaceCohortPresentation`, exposed through the cohorts module, uses the authenticated permanent workspace identity query result separately. Missing public profiles, absent publication consent and suspended/archived workspace state do not erase private historical provenance. A genuine `none` cohort stays empty; no fallback number is fabricated.

Public-profile GET/PATCH responses now include `Cache-Control: private, no-store`, including error responses. No persistent permission/access-mode cache was added. This is defense in depth; authentication and SQL membership checks remain authoritative.

### Minimum subsequent wiring / components waiting for approved exports

| Surface / exact target | Prepared now | Still deferred |
| --- | --- | --- |
| `src/components/members/member-identity-slots.tsx`, `member-identity.tsx` | Typed size/tone/fit/text/serial slots | Approved badge/neutral/frame/pass vectors and certified small-size/light/dark styling |
| `src/app/members/[slug]/page.tsx` | Existing route connected to current public identity/pass adapter | Definitive Founder/Early pass composition and responsive visual QA |
| `src/components/members/public-members-wall.tsx`, `.module.css` | Existing behavior preserved; reusable slots available | Approved card/tile/badge skin; no pass links inferred from wall consent |
| `src/app/app/settings/page.tsx` | Authorized private profile and permanent cohort adapters available via existing module APIs | Membership section/consent editor visual composition; must respect existing replacement-style PATCH semantics |
| `src/components/dashboard/dashboard-shell.tsx`, `context-switchers.tsx` | `getWorkspaceCohortIdentityQuery` -> `workspaceCohortPresentation` -> compact badge props | Approved placement/size and explicit shell wiring; no per-card/dashboard query waterfall |
| `src/components/waitlist/journey-views.tsx`, `membership-ladder.tsx`, `journey.ts` | Existing authoritative journey models and separate pre-admission types retained | Approved Early Access/Priority visuals; no frontend requalification or renumbering |
| `src/app/invite/complete/route.ts` | Existing authoritative server-HTML admission result can feed the pure admitted-cohort formatter | Approved server-compatible artwork adapter, not a client image-hook import into static email/HTML/OG |

These are prepared inputs and minimum wiring points, not claims that a new Settings/editor/shell layout has shipped. This phase deliberately does not invent those layouts. Final exports must provide the Apex masters, four identity/status badge treatments, neutral/tile framing and two public pass compositions with viewBoxes, safe areas, size/tone guidance and approved typography/licenses; see the complete manifest in the audit. Future 13B artwork adapters remain on their separate unreleased branch.

## 4. Forward SQL inventory and runtime gate

Required unapplied F1.5/F1.6A execution order after the existing complete 13A schema:

1. `20261030000000_public_members_wall_active_workspace_repair.sql` — existing pending active-workspace repair.
2. `20261031000000_f1_6a_public_identity_url_authority.sql` — new forward URL authority repair.

**Both: NOT_RUNTIME_VALIDATED. SQL_RUNTIME_VALIDATION = PENDING. No migration was applied.**

The CLI initially created the new empty unpublished file with today's timestamp. It was deliberately ordered after the existing future-dated active-workspace repair before adding content; no pushed historical migration was renamed or rewritten. This migration depends only on existing 13A.4 objects and the active-workspace read behavior, not unreleased 13B or P2.2B.

New helpers are bounded, immutable, `SECURITY INVOKER`, empty search path: `decode_public_cohort_url_component(text)` -> nullable text, `is_public_cohort_url(text)` -> boolean. They are explicitly executable by anon/authenticated/service for stateless validation only; neither reads tables or grants publication/access authority. The URL guard is an invoker trigger function with PUBLIC/anon/authenticated execution revoked and service execution granted.

Public wall/pass replacement signatures/eleven result columns remain identical. They retain `SECURITY DEFINER` for the existing narrow opt-in read architecture, now with empty search paths and fully qualified relations/helpers. Explicit PUBLIC revocation and anon/authenticated/service read grants remain. Existing active-workspace, composite membership and independent consent predicates are preserved. No private table grant, allocation RPC grant, identity mutation, consent rewrite or new storage surface is introduced. Volatility of the public reads is not changed to an unproven STABLE declaration.

Before production rollout, validate against the complete isolated schema: actual function execution/signatures/grants; all URL vectors in the TS tests against SQL; harmless query preservation; malformed/UTF-8/NUL/double-encoding cases; unsafe legacy masking in all three fields through direct anonymous RPC calls; insert/update rejection; unchanged-legacy visibility-only revocation; independent consent combinations; authorized owner/admin versus unrelated/removed members; composite cross-tenant references; active/suspended/archived public visibility; immutable historical numbers and audit history. The audit's account-erasure/immutable-FK cleanup concern remains separate and unmodified.

SQL source tests establish contracts, not execution equivalence. Effective runtime grants, catalog metadata, RLS and TS/SQL semantic parity remain release gates. No paid database or production operation is authorized here.

## 5. Scope, performance and validation

Unchanged: waitlist/admission/email implementations and triggers, F1.4 form/homepage, Early Access/priority/cohort numbering, referral qualification, entitlement/access-mode policy, monogram normalization, Evidence Fidelity, 12A.6 and P2.2B. No 13B imports/sharing routes, upload infrastructure, new dependency or environment changes. `WANTEREST_LOCAL_HANDOFF.md` is not edited/staged. Production mode/data are untouched.

Public wall still has two parallel bounded-by-cohort RPC reads, not per-member queries. Pass lookup remains one request-memoized unique-slug RPC for page/metadata. URL checks are local and bounded; no provider/DNS retrieval, product-history recomputation, new cache or background job. Private presentation adapters perform no reads themselves, so future callers must use existing authorized queries once per workspace rather than add a rendering waterfall.

Final executed validation:

| Check | Result |
| --- | --- |
| Focused URL/public-profile/identity/RPC/wall/consent + cohort/Early Access/referral/email/Evidence Fidelity | 28 files, **259 tests passed** |
| Public URL policy/DTO vectors | **77 tests passed** |
| Evidence Fidelity regression | **39 tests passed** |
| Typecheck | PASS, exit 0 |
| Lint | PASS, zero errors; only the two existing unused `_message` warnings in unchanged `tests/modules/waitlist-admission.test.ts`, lines 17/89 |
| Clean Next production build | PASS; Next 16.3.5; generated `.next` removed only in the verified integration worktree before build |
| Full Vitest | **213 files passed, 13 skipped; 1,756 tests passed, 16 skipped; zero failures** |
| FULL_SUITE_BRANCH_REGRESSION | **NONE** against the audited passing baseline |
| SQL runtime / effective grants / deployed schema parity | **PENDING / NOT_RUNTIME_VALIDATED** |
| Real browser interactions/visual QA | Not performed in this contract repair |

Skipped tests are existing opt-in PostgreSQL/provider checks; no opt-in was enabled and no test was newly disabled. Browser interactions/image fallback and isolated PostgreSQL are not claimed by static markup/mocked-RPC tests. The positive hierarchy fixture moved from reserved `.example` to `assets.example.com`; assertions were not weakened. Both original handoff documents, the generated type snapshot, historical migrations and protected business-flow files have no changes.

## 6. Readiness verdict

**F1.6A: CONTRACT_IMPLEMENTATION_READY_FOR_REVIEW / SQL_RUNTIME_VALIDATION_PENDING.**

The asset-independent URL/type/presentation boundaries are prepared for approved artwork. This is not production approval or a claim that final Apex integration is complete. Remaining gates: isolated SQL/grant/parity validation, approved Claude exports/layout decisions, real browser responsive/accessibility/revocation/image-fallback verification, and image ownership/licensing/operational takedown review. Optional upload infrastructure and separate 13B release remain out of scope.
