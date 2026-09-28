# Members Wall identity engineering handoff

## Implemented routes

- `/members` is the public, opt-in Members Wall. It loads the authoritative Founding 25 and Early 100 projections, renders cohort tabs, and uses the existing access-mode CTA contract.
- `/members/[slug]` remains the separate public cohort-pass route. It is never linked from a wall card: wall presence must not imply a public pass.

## Public cohort and consent contracts

- `workspace_cohort_memberships` is the authority for the permanent workspace-level `founding_25` and `early_100` identities. The wall neither assigns nor changes a cohort.
- `workspace_public_cohort_profiles` is an opt-in public projection. Its private profile record is not exposed directly.
- `wall_visible` controls `/members`; `pass_visible` independently controls `/members/[slug]`. Both default to false.
- The public RPC projections include only public slug, display data, limited public URLs, cohort provenance, and assignment date. They exclude workspace IDs, applicant data, invitations, and credentials.
- The active-workspace repair rechecks current eligibility at public-read time. An inactive workspace must disappear from both public surfaces even if historical consent remains stored.

## Identity selection

`selectPublicMemberIdentity` turns an already-authorized `PublicCohortRow` into a serializable `PublicMemberIdentity` fallback chain:

1. `company_logo` from explicitly public `logoUrl`
2. `profile_avatar` from explicitly public `avatarUrl`
3. `monogram` from the persisted Layer 13A.4 monogram
4. neutral `placeholder`

Only HTTPS image URLs without URL credentials are passed to client markup. Failed image loads advance through that same server-selected fallback chain. The selector never derives a monogram; the existing `derive_public_cohort_monogram` / `derivePublicMonogram` contract remains authoritative.

## Claude-facing component interfaces

`src/components/members/member-identity.tsx` provides stable, presentation-only integration points:

- `CohortBadge({ cohort, className })`
- `MemberIdentity({ identity, className })`
- `IdentityFallback({ asset, className })`
- `FounderPassArtwork({ cohort, number, identity, displayName, className })`

These components do not read databases, decide visibility, create public URLs, or assign cohorts. Claude can replace their visual implementation while retaining the prop contracts. `FounderPassArtwork` must be used only after the pass route has obtained a pass-visible public DTO.

## Asset targets

Claude-designed visual assets should target these files, not business logic or RPCs:

- `src/components/members/member-identity.tsx` — identity and pass-artwork slots
- `src/components/members/public-members-wall.tsx` — wall layout and card composition
- `src/components/members/public-members-wall.module.css` — current replaceable wall skin
- `src/app/members/[slug]/page.tsx` — public pass composition once definitive Founder Pass artwork is ready

## Image-upload boundary

There is currently no Supabase Storage bucket, upload adapter, signed-URL flow, or object-ownership model for cohort images. Do not add direct client uploads as part of visual work.

A future upload implementation needs a private bucket, workspace-owned object records, server-side ownership checks, MIME/size limits, file safety review, explicit publication promotion, and revocation-aware delivery. Until then, images remain owner-supplied public HTTPS references through the existing public-profile contract.

## Database migration and validation

`supabase/migrations/20261030000000_public_members_wall_active_workspace_repair.sql` is additive and follows the Layer 13A.4 cohort-profile migrations. It replaces these existing signatures without changing their return shape:

- `public.get_public_cohort_wall(text)`
- `public.get_public_cohort_profile(text)`

It is **NOT_RUNTIME_VALIDATED**. Before any production rollout, execute it in an isolated PostgreSQL/Supabase environment after the Layer 13A cohort migrations, then verify function definitions, `SECURITY DEFINER` search paths, revoked `PUBLIC` access, role grants, active-workspace revocation, independent wall/pass consent, and cross-workspace isolation. No migration has been applied by this work.
