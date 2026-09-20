import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(process.execPath, [vitest, "run", "tests/smoke/github.test.ts", "--reporter=verbose"], {
  stdio: "inherit",
  env: { ...process.env, RUN_GITHUB_SMOKE: "1" },
});
process.exit(result.status ?? 1);
