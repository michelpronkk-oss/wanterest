import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(process.execPath, [vitest, "run", "tests/smoke/bluesky.test.ts", "--reporter=verbose"], {
  stdio: "inherit",
  env: { ...process.env, RUN_BLUESKY_SMOKE: "1" },
});
process.exit(result.status ?? 1);
