# SEO/GEO production baseline — 2026-09-30

This is a dated, read-only baseline. Google Search Console and URL Inspection data can lag; values below are attributed to their source and are not treated as live traffic or guaranteed current index state.

## Public host HTTP audit

Read-only production GET checks were run on the canonical marketing pages and host boundaries:

| Surface | Observed result |
| --- | --- |
| `https://wanterest.com/` | HTTP 308 redirect to `https://www.wanterest.com/` |
| Eight sitemap URLs on `www.wanterest.com` | HTTP 200 HTML, self-canonical, one server-rendered H1, `index, follow` |
| Canonical marketing cache headers | `private, no-cache, no-store, max-age=0, must-revalidate`; retained because the shared marketing header personalizes access-state CTAs |
| `www.wanterest.com/robots.txt` | Allowed public root; disallowed selected app/auth/API paths; sitemap points to canonical `www` |
| `www.wanterest.com/sitemap.xml` | Exactly 8 canonical public marketing/legal URLs; no app/auth/API/Admin entries |
| `app.wanterest.com/` | Redirects to `/login`; initial response was missing a host-wide noindex response header |
| `app.wanterest.com/robots.txt` and `/sitemap.xml` | Previously exposed the marketing-host robots policy and eight `www` sitemap URLs |
| `app.wanterest.com/admin-internal/login` | HTTP 404, `noindex, nofollow, noarchive`, private no-store response |
| `admin.wanterest.com/` | Redirects to `/login`; noindex and no-store |
| `admin.wanterest.com/login` | HTTP 200 secured Admin login with noindex |
| `admin.wanterest.com/robots.txt` | Previously returned generic marketing HTML with HTTP 404 rather than a host-specific text policy |
| Direct `/admin-internal/**` on customer hosts | HTTP 404, noindex/no-store; no Admin content served |

The app/Admin robots and sitemap host mismatch and missing app-wide noindex header were confirmed issues and are corrected in this branch. The canonical marketing cache remains private/no-store because `SiteHeader` renders account/access-specific CTAs; globally making these responses public-cacheable would risk sharing personalized content.

The public host audit proves ordinary HTTP reachability only. It does not certify Core Web Vitals, assistive-technology behavior, image quality, or WAF treatment of verified search-crawler IP ranges. Those need their own measured follow-up.

## Search Console baseline

**Property:** `sc-domain:wanterest.com`
**Read window from Search Analytics connector:** 2026-08-31 through 2026-09-27; comparison window 2026-08-03 through 2026-08-30.

| Measure | API output | Interpretation |
| --- | ---: | --- |
| Clicks | 0 | Returned as zero for this API request; not yet a confirmed settled zero |
| Impressions | 0 | Returned as zero for this API request; not yet a confirmed settled zero |
| CTR | 0 | Derived API field with no returned rows |
| Average position | 0 | API output with no returned rows |
| Settled-through date / maturity source | unavailable / null | The connector did not provide a settled-through date; recent reporting is unresolved |

Search Analytics returned no rows and could not establish data maturity. Do not use these values as proof that the site received no organic traffic.

**Sitemap report:** Google Search Console reported `https://www.wanterest.com/sitemap.xml`, submitted 2026-09-29 23:00:24 UTC, downloaded 2026-09-29 23:00:25 UTC, 0 errors, 0 warnings, 8 URLs submitted, and 0 indexed in the sitemap report. That `indexed: 0` value conflicts with URL Inspection for the homepage and About page, so it is recorded as a Search Console report discrepancy, not as the site's total indexed URL count.

**Latest URL Inspection history available at audit time:**

| Canonical URL | Inspection result |
| --- | --- |
| `/` | Submitted and indexed; mobile crawl; last crawl 2026-09-29 23:02:39 UTC |
| `/about` | Submitted and indexed; last crawl 2026-09-29 23:50:07 UTC |
| `/product` | Discovered, currently not indexed; no crawl reported |
| `/contact` | Discovered, currently not indexed |
| `/cookies` | Discovered, currently not indexed |
| `/pricing` | URL unknown to Google |
| `/privacy` | URL unknown to Google |
| `/terms` | URL unknown to Google |

These inspections were run September 30, soon after the sitemap's September 29 submission. Preserve the current content and wait for ordinary crawl/index processing before requesting manual re-indexing. Google explains that URL Inspection reflects its index version and that crawling is distinct from indexing.

## Other measurement access

- GA4: no property/read-only scope configured.
- Bing Webmaster: no API key/site integration configured.
- Durable Search Console credentials for a server-side Admin report: not configured at the time of this baseline. SEO-1 now implements a private Admin read path; activation still requires the production OAuth variables described in the SEO-1 runbook.
- Vercel Web Analytics: no supported production-project API integration configured in this repository.
- Current Privacy and Cookie policies state that Wanterest does not use third-party website analytics or analytics cookies. Analytics tracking was not added.

## Indexing scope and follow-up

The sitemap intentionally remains the eight public marketing/legal routes. `/members` is publicly reachable and indexable but is not in the sitemap; review its public cohort-wall content and intended indexation separately before adding it. No additional URLs were submitted for indexing and no customer data or production lifecycle state was modified.
