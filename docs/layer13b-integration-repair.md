# Layer 13B targeted integration repair

This repair addresses two integration defects on `layer13b3-public-intelligence-attribution`:

1. `get_public_share_card(text)` now revalidates an applicant publication against the current
   verified waitlist application and excludes `declined` and `withdrawn` applications. Permanent
   cohort publications remain eligible when they have no `waitlist_application_id` and still have
   their cohort-profile authority.
2. An eligible public-card CTA enters through `/api/share-cards/cta`. The route revalidates the
   public card, issues a signed HttpOnly `wanterest_share_attribution` cookie with a 30-day bound,
   and redirects to the current access-mode CTA. The cookie is not an authorization credential.

The existing 13A.6 `provision_workspace_admission` contract remains the admission authority. The
forward-only repair migration adds a nine-argument wrapper for OPEN signup that delegates to the
exact eight-argument 13A.6 function, validates the signed handoff's public slug against a currently
published card, and records the resulting publication ID on `workspace_admissions`. That provenance
is used only for attribution and never grants access, referral credit, cohort status, or product
authorization. The wrapper records `verified_conversion` only after the canonical admission returns.

`signup_started` is recorded only for a revalidated public-card CTA whose destination is `/signup`.
`signup_completed` is recorded only after a successful Supabase auth-code exchange (or an
authenticated direct-session callback). Existing browser `cta_clicked` remains non-authoritative.
No share view, download, CTA click, or analytics event qualifies a referral.

Migration order remains:

1. `20261026000000_layer13b1_dynamic_share_card_engine_v1.sql`
2. `20261027000000_layer13b2_intelligence_sharing_v1.sql`
3. `20261028000000_layer13b3_public_intelligence_attribution_v1.sql`
4. `20261029000000_layer13b_integration_repair_v1.sql`

The repair SQL is **NOT RUNTIME VALIDATED**. No production or paid database was changed. Before
rollout, apply the four migrations on an isolated PostgreSQL database and verify RPC signatures,
grants, function security/search paths, RLS, applicant revocation, and the OPEN admission contract.

Broader public analytics hardening remains a pre-launch gate: add bounded event deduplication,
request rate limiting, and crawler exclusion without treating user-agent filtering as proof of a
human. Source licensing/takedown review and real-browser share/OG/download validation also remain
required.
