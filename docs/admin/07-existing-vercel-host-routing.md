# Admin on the existing Wanterest Vercel project

`apps/admin` remains the source package for the already implemented Admin pages, authentication, MFA, authorization, and read models. The root Wanterest Next.js application imports those modules into the existing Vercel project; there is no second Vercel project or `apps/admin` Vercel root deployment.

## Routing boundary

- `src/proxy.ts` checks the incoming hostname against the exact `admin.wanterest.com` hostname.
- In Production, requests for that hostname rewrite to the private `/admin-internal` route namespace. Public paths stay clean (`/login`, `/operations`, and so on).
- Any direct request to `/admin-internal` or a case/encoded variant is denied on every host.
- The Admin hostname on Vercel Preview/development is denied. Preview builds cannot expose Admin pages even if Production credentials exist in the project.
- Existing customer domains continue through their existing routes and Supabase session refresh. The internal prefix never resolves on those domains.
- Auth actions and server Admin authorization check the original `Host` again. A customer-host action replay cannot use an Admin server action.

## Security behavior

Admin responses are dynamic and `private, no-store`, include `X-Robots-Tag: noindex, nofollow, noarchive`, deny framing, apply a per-request nonce CSP, disable MIME sniffing, and set a restrictive Permissions Policy. Admin CSS is scoped beneath `.admin-scope`; fonts use the existing local Wanterest brand assets. The customer root layout and stylesheet are unchanged.

Admin authorization still requires a verified Supabase Auth user, an explicitly provisioned active `admin_memberships` row, and `aal2` TOTP assurance. The read-only role permission map is unchanged. The service role is read only within protected server read models and never crosses into a client component. Founder provisioning remains an operator-controlled separate approval.

## Existing Vercel project requirements

Use project `wanterest` in the production team; retain its existing root directory, framework/build settings, Git connection, and customer domains. The Admin domain `admin.wanterest.com` must be assigned to this same project. Admin uses Production-scoped server variables already belonging to the existing Supabase project: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The URL must resolve to the approved production project. `SUPABASE_SERVICE_ROLE_KEY` is server-only; it must not use a `NEXT_PUBLIC_` prefix or reach a browser bundle. The existing shared Vercel project also has the server-only key in Preview for the customer app; this integration does not change that existing customer Preview scope, and Admin code rejects every non-production environment before client construction. `ADMIN_AUTH_RECOVERY_REDIRECT_URL=https://admin.wanterest.com/auth/callback?next=/recover` is configured in Production; allow that callback in Supabase Auth.

Never print credential values while inspecting Vercel configuration. If a required Production variable is missing, stop and ask the operator to set its Production scope in Vercel before deploying. Do not substitute a placeholder. Optional Trigger.dev/Vercel analytics integrations may remain unavailable without their separate tokens.

## Release verification

Before merge, run root and Admin typecheck/lint, the full test suite, Admin security tests, and the optimized root Next build. Inspect generated client output and Preview behavior for credential leakage. After the existing project produces a Production deployment for the merged commit:

1. Confirm `admin.wanterest.com` resolves to the `wanterest` Vercel project and serves `/login` with CSP, noindex, no-store and security headers.
2. Confirm unauthenticated `/operations`, `/early-access`, and `/system-map` redirect to `/login`; do not attempt a bypass or claim authenticated dashboard validation before explicit Founder provisioning and completed TOTP.
3. Confirm `wanterest.com` and `app.wanterest.com` continue serving the customer application.
4. Confirm the internal namespace returns not-found on those customer domains and the Admin hostname returns not-found for Preview deployments.
5. Record the production deployment ID, deployment commit, and all three domain checks. Do not apply migrations or provision membership as part of this release.
