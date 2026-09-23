import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
