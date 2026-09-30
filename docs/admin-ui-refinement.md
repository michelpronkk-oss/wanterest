# Admin presentation refinement

## Baseline and scope

Branch: `codex/admin-premium-ui`.

Based on `origin/main`, `c03809c16292acaf28509d60c984073233276f48` (SEO-1,
PR #9). This is a presentation change. The homepage also removes the two
illustrative-example disclosure paragraphs beneath the hero preview and the
“Beyond Signals” preview. Their examples, metrics, other copy and layout remain
unchanged. The user has approved the PR, merge and production deployment.

The original checkout and its named stash are untouched. Work is isolated in the
existing managed `admin-main-baseline` worktree.

## Visual decisions

- An ink sidebar gives navigation a clear boundary against the warm paper canvas.
  The approved `@wanterest/brand/logo-mark` geometry and Inter, Sora and Archivo
  font files remain unchanged. Lime marks navigation selection, not service health.
- Larger page titles, section headings and metric values establish a reading order.
  Source, range and refresh details stay visible with stronger contrast. The
  Applications card anchors Overview without adding a calculated metric.
- The account area presents the existing role and sign-out action; the initials
  avatar has been removed. A skip link, native mobile navigation disclosure and
  visible focus states support keyboard use without additional client state.
- Early Access filters, diagnostic lists, incident details and data tables gain
  room and readable type. Wide tables keep their own keyboard-accessible scroll
  regions instead of widening the page.
- System Map separates source adapters, ordered pipeline stages and dependencies.
  Numbered stages and connecting bands make the direction clear. Health labels
  and their existing observations are unchanged; unknown remains unknown.
- Search Console gains section navigation, more prominent measurements and
  comparisons, clearer maturity context, readable opportunity evidence, and
  intentional disconnected/error layouts. The error page offers a normal GET
  retry through the existing authorized route.
- Login and the shared recovery/MFA shell use the same ink/paper identity,
  larger fields, readable feedback and restrained focus/hover behavior.

All application CSS remains under `.admin-scope`. A pre-existing broad
`.unavailable` layout rule was removed: it also matched small unavailable badges
and imposed empty-panel sizing on them. Absence layout now belongs to the
existing `.data-state` component. Redundant overridden CSS declarations were
removed; before/after screenshots were pixel-identical.

## Intentionally unchanged

No changes to Search Console provider/OAuth, authorization, opportunities or
thresholds, query normalization, data maturity, hostname routing, membership,
MFA actions or enrollment state, database migrations, SEO monitoring, customer
features, or production jobs. The existing permission filter is reused for both
desktop and mobile navigation. No new data dependency or runtime fixture route
has been added.

## Verification

| Check | Result |
| --- | --- |
| Root and Admin TypeScript | Pass |
| Root lint | Pass; two existing `_message` warnings in `tests/modules/waitlist-admission.test.ts` |
| Admin lint | Pass |
| Root optimized build | Pass |
| Admin optimized build | Pass |
| Full Vitest suite | 1,914 passed, 16 skipped; 236 passed files, 13 skipped files |
| New presentation tests | 13 passed |
| Responsive browser review | 72 render checks across 1440, 768, 390 and 320px; no page overflow or missing fonts |
| Keyboard/browser behavior | Skip link, native mobile disclosure, horizontal table scrolling, section anchors and reduced motion pass |
| Protected implementation diff | No changes under Admin server modules, host routing, root proxy, integrated route wrappers, root server modules or Supabase migrations |

The presentation tests render the real components with isolated test inputs.
They cover configured Search Console data, missing configuration, no settled
rows, provisional maturity, provider errors, genuine returned zero values,
permission-filtered navigation, unavailable lifecycle/operations sources,
unknown map observations, login feedback, recovery and MFA presentation.
Synthetic populated fixtures are confined to tests, clearly labelled in every
generated review page, and never substituted for production data.

### Live local browser evidence

The existing standalone Admin production build was served on loopback port 3102,
without production credentials. At desktop and mobile sizes:

- `/login` returned 200 with CSP, `noindex, nofollow, noarchive` and
  `private, no-store, max-age=0`.
- Native email validation and navigation to password recovery worked.
- An unauthenticated `/search-console` request redirected to `/login`.
- An unregistered internal path returned 404. This is not a production hostname
  isolation test; the existing hostname/security regression tests remain in the
  full suite.
- No hydration or CSP errors occurred in the production build. The deliberately
  requested 404 produced the one expected console resource error.

The root development-server attempt on `admin.localhost:3100` returned an empty
404 with a rewrite targeting `localhost:3100/admin-internal/login`. Routing was
not changed to make a visual preview work. Development mode also emitted inline
style CSP warnings, which were absent in the local production build.

Authenticated production Search Console/dashboard access was not exercised.
No production writes, enrollment actions, deployments or merge were performed.

## Reproduce the review

From the repository root, in PowerShell:

```powershell
$env:ADMIN_DESIGN_REVIEW = '1'
npx vitest run tests/admin/presentation.test.tsx
Remove-Item Env:ADMIN_DESIGN_REVIEW
node scripts/verify-admin-presentation.mjs
node scripts/preview-admin-presentation.mjs
```

Open `http://127.0.0.1:3101` for the labelled presentation gallery. Forms in this
static review do not submit; this is not an authenticated application session.
HTML, local font copies, browser results and desktop/mobile PNGs are generated
under ignored `out/admin-design-review`, not shipped with the application.

To serve the actual local Admin login separately:

```powershell
npm --workspace @wanterest/admin run build
npm --workspace @wanterest/admin run start -- --port 3102
```

Open `http://127.0.0.1:3102/login`. The preview keeps the existing access boundary;
it does not unlock private pages or connect production credentials.

Release approval: the user authorized the focused PR, merge and production
deployment on 2026-09-30.
