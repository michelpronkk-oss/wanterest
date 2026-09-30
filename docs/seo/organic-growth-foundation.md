# SEO/GEO and organic growth foundation

**Audit and implementation date:** 2026-09-30
**Canonical public origin:** `https://www.wanterest.com`
**Application:** `https://app.wanterest.com`
**Private Admin:** `https://admin.wanterest.com`

## Current foundation

The repository already owns the public page metadata, canonical URLs, Organization/WebSite/SoftwareApplication JSON-LD, `robots.txt`, and an eight-URL marketing/legal sitemap. The implementation in this phase is limited to correcting hostname-specific crawler output, protecting the private host boundary, identifying example figures as examples, and adding a small public-site technical monitor.

- `www.wanterest.com` is the only host that receives the marketing sitemap and public crawl policy.
- `app.wanterest.com`, `admin.wanterest.com`, Vercel aliases, and other noncanonical hosts do not receive public sitemap URLs and receive an `X-Robots-Tag` noindex header on customer-host responses.
- The canonical marketing robots policy explicitly permits `OAI-SearchBot` while repeating the private route disallows. It does not add a `GPTBot` group; GPTBot therefore retains the site's existing wildcard behavior. Search discoverability and model-training policy remain separate decisions. No training-related crawler policy was changed.
- The Admin host publishes a host-specific `Disallow: /` robots response through its existing private rewrite. This is crawl control only; authentication, MFA, membership checks, authorization, and the Preview guard remain the access controls.
- The existing decorative dashboards, charts, and figures on the homepage, product page, and About page now carry visible notices that the values are examples rather than live customer or market measurements. The existing Daily Value and Comparison previews already label their examples.
- Public JSON-LD remains limited to facts already visible on the site. The health monitor parses the homepage JSON-LD and checks public page output without submitting product, customer, or account data to another service.

## Ongoing technical monitor

`.github/workflows/seo-technical-health.yml` runs daily at 08:23 UTC and can also be started manually. The dependency-free Node script checks:

- HTTP status, canonical host, title, description, one server-rendered H1, and homepage JSON-LD for the eight approved public routes;
- exact sitemap membership and the canonical marketing crawl policy;
- app/Admin host-specific robots and sitemap behavior;
- the Admin login's noindex response and 404/noindex responses for the private Admin namespace on other hosts.

On a failure, the workflow maintains one open GitHub issue titled **SEO technical health incident**, updating it in place. A successful run closes that incident. This avoids one issue or notification per route per day. The report only contains stable check identifiers and fixed technical status descriptions; it does not collect search queries, visitor analytics, page contents, or credentials. Workflow permissions are read-only for repository contents and limited to issue updates.

## Search Console and opportunity reports

The Search Console intelligence integration is implemented inside the authenticated Admin surface. It uses a production-only, server-side OAuth refresh token with the read-only scope, compares finalized Pacific-time windows, and marks provisional maturity separately. Query-level data stays inside Admin. The report is generated on request; it is not persisted or scheduled until production credentials and a retention decision are in place. See [SEO-1 implementation and configuration](./search-console-intelligence.md). Do not copy API output to a public workflow artifact or issue.
Google Search Console API access requires authorization; its query API distinguishes finalized from fresh/incomplete data. URL Inspection reports the version in Google's index, not a live indexability test. References: [Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [URL Inspection API](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect), and [URL Inspection result fields](https://developers.google.com/webmaster-tools/v1/urlInspection.index/UrlInspectionResult).

## Analytics and Bing setup still needed

- **Google Analytics 4:** no analytics property/scope is connected to the current read-only analytics integration. The current Privacy and Cookie policies say Wanterest does not use third-party website analytics or analytics cookies. Do not add GA4 or client-side tracking until the privacy/cookie policy and any consent requirements are reviewed and updated.
- **Vercel Web Analytics:** no production-project Web Analytics provider or supported API credential is configured in this repository. Visitor/page analytics must remain separate from database lifecycle measurements and from Search Console clicks/impressions.
- **Bing Webmaster Tools:** the read-only integration reports no API key/site connection. Verify the site in Bing Webmaster Tools, then provide a read-only supported integration before building its weekly report.
- **AI referrals:** report only observed referrals (including documented `utm_source=chatgpt.com` values) once an authorized analytics source exists. Do not infer referral traffic from crawler access.

## Crawl and index interpretation

Google, Bing, and other crawlers are allowed by the canonical wildcard rule for public content. The canonical robots file now has an explicit OAI-SearchBot group; GPTBot continues to inherit the wildcard policy. PerplexityBot also inherits the wildcard policy; no separate `PerplexityBot` rule was needed. Perplexity-User is a user-requested fetcher and its current documentation says it generally ignores robots.txt. Public HTTP checks confirm server-rendered pages are reachable, but a generic fetch cannot prove that Googlebot, Bingbot, OAI-SearchBot, or PerplexityBot is not challenged by a separate Vercel Firewall/Bot Management policy. Verify that with provider logs or each official crawler's verification process if a real crawl failure appears.

Robots rules manage crawling, not confidentiality or guaranteed de-indexing. Admin remains protected by server-side auth and the hostname/MFA/membership controls. Do not rely on robots.txt to secure data. Google documents that a crawler must be able to fetch a page to observe its `noindex` directive; host authentication and private route authorization remain primary.

## SEO-2 readiness work

The standalone **SEO & Organic Intelligence Growth System / Futureproof SEO Master Plan** was not present in the repository or supplied attachment set. The SEO-2 brief does define the nine page families and readiness requirements used in this phase; this implementation does not infer additional strategy beyond that brief. Keep the missing full plan visible as an input to later family design and launch calibration.

SEO-2 adds typed, deterministic maturity, family-specific eligibility, public-safe projection, canonical identity, uniqueness, freshness/decay, and publication-review contracts. It also adds a private Admin readiness page. The reviewed public-safe production projection and its read adapter do not exist, so that page reports an unavailable feed, presents no candidate rows, and shows no example metrics. Production workspace-owned demand is excluded from public SEO evaluation; global source conversations are not a publication projection because they retain original body and author fields.

SEO-1 remains a private Search Console read path. Its opportunity report may reprioritize an already-eligible candidate after settled/non-branded signals are available; it cannot create, qualify, or rescue an ineligible candidate. No live combination is shown while the public-safe candidate feed is absent.

No candidate intelligence route, sitemap entry, indexing request, publication action, migration, or new public template is enabled by SEO-2. A first 20–50 page cohort remains blocked until the public-safe projection, evidence independence calculations, Layer 13B.2/13B.3 privacy and runtime contracts, retention/methodology decisions, and human review process are independently validated. Do not alter discovery, qualification, Actions, Trigger.dev routing, billing, or 13B.1 lifecycle authority in this work.

See [SEO-2 foundation and current blockers](./seo2-foundation.md) for the implementation map and verification boundary.

## Official crawler references

- [Googlebot and crawl/index controls](https://developers.google.com/search/docs/crawling-indexing/googlebot)
- [Google's robots.txt introduction](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
- [OpenAI crawler controls](https://developers.openai.com/api/docs/bots) — OAI-SearchBot and GPTBot have independent controls.
- [Perplexity crawler controls](https://docs.perplexity.ai/docs/resources/perplexity-crawlers) — PerplexityBot search crawling, user-requested fetches, and published WAF IP guidance.
- [Bing Webmaster robots.txt tester](https://blogs.bing.com/webmaster/2020/9/Bing-Webmaster-Tools-makes-it-easy-to-edit-and-verify-your-robots-txt/)
- [Bing crawler host-specific robots lookup](https://blogs.bing.com/webmaster/2012/5/To-crawl-or-not-to-crawl%2C-that-is-BingBot-s-questi/)
