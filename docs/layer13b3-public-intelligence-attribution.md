# Layer 13B.3 — Public intelligence pages and attribution

## Canonical architecture

13B.3 keeps `/share/[slug]` as the only public destination. Identity cards and explicitly published intelligence cards share the same opaque slug, public RPC, revocation behavior, OG renderer, download renderer, and event endpoint. The route is dynamic, `no-store`, and `noindex`; it is not an SEO publication system.

The intelligence page is a server-rendered presentation of the same narrow DTO used by the page, OG image, and downloads. It adds a finding section, observation/evidence/interpretation labels, evidence-strength and freshness context, observation period, uncertainty copy, a safe original-source link where the authoritative signal has an HTTPS/HTTP canonical URL, source-issue contact, and one access-mode CTA. The page does not run demand analysis or provider retrieval.

## Claim integrity

Signal cards distinguish an observed excerpt from Wanterest interpretation. Gap cards use the persisted gap interpretation and snapshot evidence; drift cards use the persisted direction and current/previous counts. Public copy explicitly avoids market-wide demand, independent-episode, causal, financial, forecast, and purchase-intent claims. Unsupported source diversity and percentages are omitted.

The public projection is allowlisted. It never returns workspace IDs, product IDs, source IDs, evidence-node IDs, connector payloads, private configuration, recommendations, Actions, Experiments, or authentication data. React escaping handles text/HTML injection, and source links are restricted to valid HTTP(S) URLs without embedded credentials.

## Source policy

The existing schema contains no machine-readable provider redistribution or license decision. 13B.3 therefore presents only a bounded Wanterest excerpt and an original-source link when the authoritative signal URL is safe; it does not expose raw payloads or reproduce long source content. A source correction/takedown link uses the existing support contact. Operational review of source permissions remains required before broad publication.

## Attribution and conversion

The existing first-party events remain distribution analytics: publication, opened, shared, downloaded, and CTA clicked. Known social crawlers are filtered by the existing event route. No conversion is inferred from opens, clicks, or OG requests. The CTA uses the live access-mode RPC: `/waitlist?source=share_card` for waitlist/invite-only and `/signup?source=share_card` for open. The waitlist flow already records `source=share_card`; no referral code is fabricated and no Priority/referral rule changes.

## Revocation and cache behavior

Every public request rechecks publication state, product activity, signal lifecycle, evidence identity, and source row existence in the existing security-definer public RPC. Invalidated/retracted/archived signals, removed evidence, inactive products, and revoked publication consent return no DTO, so the page and Wanterest-controlled OG/download routes return 404. `dynamic = force-dynamic`, `revalidate = 0`, and `no-store` headers prevent intentional Wanterest-side stale claims; X/LinkedIn and other social platforms may retain their own cached previews.

## Migration chronology

13B.2 is `20261027000000_layer13b2_intelligence_sharing_v1.sql` and remains unchanged. 13B.3 adds `20261028000000_layer13b3_public_intelligence_attribution_v1.sql`, which is chronologically after 13B.2 and only replaces the narrow public RPC projection. It is **NOT RUNTIME VALIDATED** and was not applied to production or a paid database.
