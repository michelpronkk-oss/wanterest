import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const configured = ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USER_AGENT"]
  .every((name) => typeof process.env[name] === "string" && process.env[name].trim().length > 0);

if (!configured) {
  console.log("Reddit live smoke skipped: credentials not configured.");
  process.exit(0);
}

const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(process.execPath, [vitest, "run", "tests/smoke/reddit.test.ts", "--reporter=verbose"], {
  stdio: "inherit",
  env: { ...process.env, RUN_REDDIT_SMOKE: "1" },
});
process.exit(result.status ?? 1);
