# Wanterest Admin — Local Setup and Production Access

The local preview is at `http://127.0.0.1:3001`. Wanterest Admin will eventually authenticate against and read from the **existing Wanterest production Supabase project**. There is no staging, disposable, or second Supabase project in this plan.

## Local preview

1. Start with `npm run admin:dev`; the local preview is `http://127.0.0.1:3001/login`.
2. Without admin Supabase variables, the sign-in/recovery UI and public-safe errors still render, while credential submission and operational reads remain unavailable. This local preview currently has no credentials configured, so it is a visual/route preview rather than an authenticated production-data session.
3. The Supabase adapter rejects any hostname other than the existing production project `hudjhlkbizngahpadqpt.supabase.co`. For future operator-managed local authentication, populate ignored `apps/admin/.env.local` only after the migration and membership grant are separately approved. Keep the recovery callback on the local admin origin.
4. Optional operations integrations are server-only: `TRIGGER_SECRET_KEY` must be a production-scoped key; `VERCEL_API_TOKEN` is read-only and queries the existing Vercel `wanterest` project IDs in `.env.example`. Missing integrations render unavailable. No values are simulated.
5. Never add a production service-role key to a public Vercel Preview environment. Service-role credentials are server-only and must never use a `NEXT_PUBLIC_` variable or appear in browser bundles. Code hard-disables Supabase session and service clients whenever `VERCEL=1` and `VERCEL_ENV` is anything other than `production`.

## Existing Vercel project and admin hostname

Use the existing Vercel project `wanterest`; do not create or link a second project. `admin.wanterest.com` routes through the root Next.js 16 Proxy to `/admin-internal` only in Production. Direct requests to that internal prefix on `wanterest.com`, `www.wanterest.com`, `app.wanterest.com`, or Preview hosts receive not-found. Preview and other Vercel non-production deployments also deny the admin hostname. The admin app’s UI and CSS are mounted from `apps/admin` and scoped to `.admin-scope`.

The existing project must have the current production Supabase URL and anon key, plus `SUPABASE_SERVICE_ROLE_KEY`, available to server code only. Never expose the service key through a `NEXT_PUBLIC_` name or client bundle. The shared project currently has that server key in Preview as part of the existing customer app configuration; Admin Proxy and client factories refuse Admin traffic/client creation on every non-production deployment. This Admin integration leaves the customer Preview scope unchanged. Set `ADMIN_AUTH_RECOVERY_REDIRECT_URL` to `https://admin.wanterest.com/auth/callback?next=/recover` in Production and allow that callback in Supabase Auth. Trigger and Vercel analytics tokens remain optional server-only integrations and their panels remain explicitly unavailable without them. Before deployment, verify the existing project’s domain assignment, the Production environment variable names/scopes without printing values, and the generated production build configuration.

## Current verification

- `npm run typecheck`: passed with 0 diagnostics.
- `npm run build`: passed; Next.js 16.3.5 optimized production build completed.
- `npm run lint`: passed with 0 errors and two existing unused-parameter warnings in `tests/modules/waitlist-admission.test.ts` (`_message`).
- `npm run admin:typecheck`, `npm run admin:lint`, and `npm run admin:build`: all passed.
- `npm test -- --reporter=dot`: 231 files passed, 13 skipped; 1,852 tests passed, 16 skipped. Skips are configured integration/smoke tests.
- Isolated clean `origin/main` at `6fc94b2`: build passed; typecheck passed after Next generated types; suite passed with 218 files, 1,812 tests, 13 skipped files, and 16 skipped tests. The previously named stash remains untouched.
- Screens inspected: desktop/mobile sign-in, password-recovery form, and sign-in error/unavailable states. Current authenticated Control Center routes are membership/MFA gated; the local preview has no Supabase credentials, so these routes render only after authorized sign-in. No auth bypass, synthetic production-looking metrics, credentials, or recovery email are used for screenshots.
- At 390×844, DOM layout measured 390px viewport/body width with no horizontal overflow; form content width was 340px. The browser viewport override was cleared after inspection.
- Screenshots: [desktop login](screenshots/admin-login-desktop.png) and [mobile login](screenshots/admin-login-mobile.png). Local preview: `http://127.0.0.1:3001/login`.
- Production Supabase catalog/grant verification was read-only after the approved foundation migration was applied. No customer rows/Auth identities were enumerated; no account, membership, or lifecycle mutation was performed. See `06-production-auth-runbook.md` for the migration result and still-gated operator procedure.

## Production access gate

The admin foundation migration at `supabase/migrations/20261102000000_admin_console_foundation.sql` was applied to the existing production project on 2026-09-30 after an isolated CLI preflight. Its recorded version is `20261102000000`; its SHA-256 and catalog results are in `06-production-auth-runbook.md`. No Auth account or membership was created. Production sign-in remains unavailable until the existing Auth identity receives a separately approved Founder membership and the existing Vercel project has the required Production configuration.

After approval and application, access must be granted to the UUID of the **existing Wanterest Supabase Auth identity**. Do not create a duplicate account. An operator must explicitly insert an active row into `public.admin_memberships`; without that row, login is denied. The first authorized sign-in must enroll TOTP and verify AAL2. No default membership is seeded. The initial production permission set is read-only, and customer lifecycle actions must not be used as tests.

Any later local production connection must be deliberate and read-only, use operator-managed server environment variables in an ignored local `.env.local`, and remain behind the same membership and TOTP checks. Use only narrowly selected records. No production write, migration application, membership grant, or public-preview secret is authorized by this guide.
