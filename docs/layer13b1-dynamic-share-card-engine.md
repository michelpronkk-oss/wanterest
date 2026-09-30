# Layer 13B.1 — Dynamic Share Card Engine

## Boundary

13B.1 shares only authoritative, already-earned identities: verified Early Access, currently granted Priority Access, permanent Founding 25, and permanent Early 100. Intelligence variants remain reserved for 13B.2. The engine does not assign cohorts, verify applications, issue invitations, admit workspaces, grant Priority, change access mode, or create referral credit.

## Typed engine

`src/server/modules/share-cards/share-card.schemas.ts` defines the closed `ShareCardVariant` union and narrow snapshot/public DTOs. Authority adapters resolve eligibility from the existing waitlist, referral, cohort, and 13A.4 public-profile sources. Repository methods persist or read publications through service-role RPCs. Rendering consumes only the typed allowlist and never receives database rows directly.

The four V1 variants are `EARLY_ACCESS`, `PRIORITY_ACCESS`, `FOUNDING_25`, and `EARLY_100`. The contract intentionally leaves future variants additive. Founding and Early cards use the existing 13A.4 `pass_visible` opt-in; applicant cards use the private status-token session and require verified Early Access identity. Priority is checked live at publication and public-read time.

## Publication lifecycle and privacy

`share_card_publications` is private by default because no row exists until explicit publish consent. It stores one owner-scoped publication per variant, an opaque random slug, publication/revocation state, a narrow public snapshot, timestamps, and actor audit metadata. Publish and revoke are idempotent. Revoked rows remain private history, while the public RPC returns no row for revoked cards. Permanent identity cards may remain historical; Priority cards disappear when the authoritative state is revoked. A newly acquired status never auto-publishes.

`share_card_events` is append-only, service-role stored, and best-effort for public distribution events. It contains no email, auth/invite token, referral credential, or private intelligence. The existing referral `/r/[code]` destination is reused for consented applicant-card CTAs while access mode remains waitlist/invite-only. In `open`, the CTA is `/signup` and no referral credit is created.

## Routes and rendering

- Private applicant controls: `/waitlist/status`, the `/waitlist/verified` reveal and `/waitlist/share-cards` (under the status cookie's `/waitlist` path).
- Private admitted-workspace controls: `/app/settings?tab=sharing` and `/api/share-cards/workspace/[workspaceId]`.
- Public canonical page: `/share/[slug]`, always `noindex`.
- Dynamic OG image: `/share/[slug]/opengraph-image`, 1200×630 PNG.
- Download image: `/share/[slug]/image?format=portrait|square`, 1080×1350 or 1080×1080 PNG.

All formats consume the same `ShareCardArtwork` composition and public DTO. Public reads are dynamic and `no-store` so Wanterest-controlled routes stop advertising revoked Priority promptly. Social networks may retain previews already fetched before revocation.

## Performance and security

Private reads use one narrow authority lookup plus one bounded publication lookup; there is no dashboard-wide waterfall or N+1 card query. Public reads use one narrow RPC and recheck live Priority/pass visibility. Private tables have no browser table grants. The public RPC exposes only allowlisted display fields, current access-mode CTA, and publication metadata. Slugs are high-entropy and grant no mutation authority. Analytics errors never block page access.

## Migration inventory

`supabase/migrations/20261101000000_layer13b1_dynamic_share_card_engine_v1.sql` adds the private publication/event tables, service-role publication/revocation/list RPCs, the narrow public card RPC, public event recording, RLS, grants, and append-only/update triggers. It is additive and has no backfill.

## Current production verification

Read-only inspection of the existing production project confirmed migration version `20261101000000` is recorded. The share-card publication/event tables exist with RLS enabled; `anon` and `authenticated` have no direct table grants; the expected service-role table access, public DTO RPC, and append-only event trigger are present. The publication table contains a row, but the inspection did not read its contents or exercise production publish/revoke operations. The public RPC was not called with a real slug, so live content privacy and page rendering were not re-certified by this catalog inspection.

The remote migration history and current `main` migration inventory contain no 13B.2, 13B.3, or 13B Integration Repair migration. Those migrations exist on separate unmerged feature branches and are explicitly marked not runtime validated. No intelligence-card adapter or public SEO projection is active on `main` or in production. Keep 13B.1 identity-card authority isolated from SEO candidate publication.

## Future extension

13B.2 may add intelligence-specific authority adapters and variants without changing the publication, public DTO, rendering, or consent lifecycle. 13B.3 owns any future public intelligence pages and indexing policy.
