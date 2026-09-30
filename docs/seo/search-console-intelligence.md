# SEO-1 — private Search Console intelligence

SEO-1 adds a server-rendered Search Console surface at /search-console inside Wanterest Admin. The customer application and marketing routes do not expose an SEO API or page. The Admin page calls requireAdminPermission("analytics.read"), which enforces the existing production Admin hostname, active membership, and AAL2 checks before contacting Google.

The provider is server-only and uses OAuth refresh-token exchange with the exact https://www.googleapis.com/auth/webmasters.readonly scope. It verifies the fixed sc-domain:wanterest.com property via sites.get and requires Search Console's Restricted user permission. No Google SDK, browser token, mutation endpoint, database migration, customer data write, public workflow artifact, or query-data log was added. The access token exists only in memory for one page request. Vercel Preview deployments do not use the provider, even if similarly named variables are present.

## Production configuration

Set all three values as server-only Production environment variables on the existing Wanterest Vercel project:

- SEARCH_CONSOLE_OAUTH_CLIENT_ID
- SEARCH_CONSOLE_OAUTH_CLIENT_SECRET
- SEARCH_CONSOLE_OAUTH_REFRESH_TOKEN

Do not define NEXT_PUBLIC_* variants. Do not add values to Git, a Preview environment, public GitHub Actions, or issue output. With all three variables absent, Admin shows “Search Console not configured” and makes no Google request. Partial credentials produce a sanitized configuration error.

Google-side setup:

1. In a Google Cloud project, enable the Google Search Console API and create an OAuth client.
2. Use a dedicated valid Google identity for this connection. In Search Console, add that identity to the sc-domain:wanterest.com property as a Restricted user. The Restricted role is required by the verifier.
3. In the OAuth consent configuration, publish the External app or use an allowed organization-internal app. Google currently limits refresh tokens for an External app left in Testing to seven days for these non-profile scopes. Then open the official OAuth 2.0 Playground, choose its setting to use your own OAuth client, enter this client ID and secret, and temporarily allow the redirect URI https://developers.google.com/oauthplayground on the client. Authorize only https://www.googleapis.com/auth/webmasters.readonly as the Restricted identity, exchange the authorization code, and copy the returned refresh token directly into the Vercel Production variable. Remove the Playground redirect URI after issuing the token; add it temporarily again only if you later need to rotate authorization.
4. Redeploy the existing Vercel project after setting Production variables. Sign in to https://admin.wanterest.com with an explicitly provisioned Admin member who has completed MFA, then open /search-console. A successful connection displays the fixed property and “Restricted property access.” OAuth material and raw Google errors are never displayed.

Google requires OAuth 2.0 and documents webmasters.readonly as the read-only scope. Search Analytics requires read access on the property. Offline refresh tokens require access_type=offline; Google says an External OAuth consent screen left in Testing issues seven-day refresh tokens for non-profile scopes. See [Search Console OAuth authorization](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing), [API prerequisites](https://developers.google.com/webmaster-tools/v1/prereqs), [Search Console user permissions](https://support.google.com/webmasters/answer/7687615), [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), and [Google OAuth token lifetime rules](https://developers.google.com/identity/protocols/oauth2).

## Periods and maturity

Search Console query dates are Pacific Time. The dashboard requests a current 28-day finalized period and the immediately preceding 28-day comparison period. The current window ends four Pacific calendar days before today, leaving a conservative buffer beyond Google's usual 2–3 day reporting delay. Both report queries explicitly request dataState=final.

A separate ten-day dataState=all date query reads only freshness metadata. The UI shows the latest returned date and Google's firstIncompleteDate marker when available. If the latest date is older than the finalized window, maturity is marked unknown and the date remains visible. Provisional data never enters finalized metrics or opportunity rules. If Google returns no rows, the UI says the result is empty and leaves metric values blank; it does not turn absence into zero. A zero is shown only when Google returns a metric row whose value is actually zero.

The headline metrics and query rows are for the whole sc-domain property, which includes subdomains and protocols; only landing-page rows are filtered to canonical www.wanterest.com URLs. The API request limit is 1,000 rows per dimension for bounded payloads. Search Console may omit anonymized, low-volume, or lower-ranked rows. The query/page comparison and branded totals therefore describe returned rows, not an exhaustive query universe. Page tables retain only canonical https://www.wanterest.com landing pages and strip query strings and fragments. CTR is shown as returned by Google. Position is shown as an average and is not treated as a linear score. Official API details: [Search Analytics query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [query examples and row limits](https://developers.google.com/webmaster-tools/v1/how-tos/search_analytics), and [Search Console data freshness](https://support.google.com/webmasters/answer/96568).

## Classification and report rules

Brand matching is deterministic and limited to case-insensitive, Unicode-normalized whole-word wanterest and wanterest.com spellings. It does not match longer unrelated tokens. The branded/non-branded figures are sums of returned query rows and carry an explicit partial-coverage note.

The private report is generated on each authorized page request from the current Google response, compares the two 28-day windows, and retains each opportunity's exact metrics, periods, reason, and review action. At most eight signals are shown, ordered by current impressions. Rules require:

- Impressions without clicks: at least 200 impressions and CTR at or below 1.5% for a returned query or canonical page.
- Near page one: a non-branded query with at least 100 impressions and average position above 10 through 20.
- Rising query: a non-branded query with at least 100 current and 50 comparison impressions, and growth of at least 25 impressions and 30%.
- Declining page: at least 100 comparison impressions and a decrease of at least 30 impressions and 30%.

Duplicates are removed within a report using a stable rule/entity key. Reports are not persisted, and no scheduled job runs yet. This keeps the initial integration migration-free and avoids retaining query-level data without an approved retention policy. The interface presents query-to-canonical-page pairs as evidence but does not guess that a pair is semantically mismatched.

## Verification state

With production OAuth values absent, verify that the page reports “Search Console not configured,” the current production bundle contains no Google credential values, and Vercel Preview cannot access Admin or use the provider. After configuration, verify the connection only while signed in through the Admin hostname as a member with AAL2. Do not publish screenshots or logs containing private query rows outside the Admin surface.
