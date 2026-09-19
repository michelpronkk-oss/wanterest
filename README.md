# Wanterest

Wanterest is a demand-intelligence SaaS built as a modular Next.js monolith. Phase 1 provides
the backend foundation: Supabase auth/session clients, workspace tenancy, RLS, internal Free
entitlements, usage limits, audit logging, and the engine registry. Product UI and intelligence
pipeline features are intentionally not implemented yet.

## Local setup

Prerequisites: Node.js 20+ and the [Supabase CLI](https://supabase.com/docs/guides/cli).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the Supabase URL, anonymous key, and
   server-only service-role key. Never expose the service-role key to the browser.

3. For a local Supabase project, start Supabase and apply the migration:

   ```bash
   supabase start
   npm run db:reset
   ```

4. Run the backend-enabled Next.js app:

   ```bash
   npm run dev
   ```

Phase 1 API boundaries are available under `/api/auth/session` and `/api/workspaces`. They
require an authenticated Supabase session; there is no dashboard UI yet.

## Verification commands

```bash
npm run lint
npm run typecheck
npm test
npm run test:rls
```

`test:rls` always runs migration-contract checks. Live RLS checks run when the optional
`SUPABASE_RLS_*` variables in `.env.example` are configured.

Database workflow scripts:

```bash
npm run db:lint
npm run db:reset
```

The approved architecture and later-phase boundaries are documented in
[`docs/architecture.md`](docs/architecture.md).
