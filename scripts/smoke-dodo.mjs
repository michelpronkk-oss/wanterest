import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// `npm run smoke:dodo` always runs the read-only /products connectivity check.
// Set RUN_DODO_CHECKOUT_SMOKE=1 as well to additionally exercise the real POST
// /checkouts route (creates one uncompleted, non-billed checkout session, never
// confirmed/visited — see tests/smoke/dodo.test.ts for what that does and doesn't do).
const configured = ["DODO_PAYMENTS_API_KEY", "DODO_PAYMENTS_ENVIRONMENT"]
  .every((name) => typeof process.env[name] === "string" && process.env[name].trim().length > 0);

if (!configured) {
  console.log("Dodo live smoke skipped: DODO_PAYMENTS_API_KEY / DODO_PAYMENTS_ENVIRONMENT not configured.");
  process.exit(0);
}

const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(process.execPath, [vitest, "run", "tests/smoke/dodo.test.ts", "--reporter=verbose"], {
  stdio: "inherit",
  env: { ...process.env, RUN_DODO_SMOKE: "1" },
});
process.exit(result.status ?? 1);
