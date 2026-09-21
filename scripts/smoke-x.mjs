import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function loadLocalXEnvironment() {
  try {
    const source = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*(X_(?:BEARER_TOKEN|API_BASE_URL|MAX_POSTS_PER_SCAN|POST_READ_COST_USD|COST_CONFIG_VERSION))\s*=\s*(.*?)\s*$/);
      if (!match) return [];
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      return [[match[1], value]];
    }));
  } catch {
    return {};
  }
}

const smokeEnvironment = { ...loadLocalXEnvironment(), ...process.env };
const configured = typeof smokeEnvironment.X_BEARER_TOKEN === "string" && smokeEnvironment.X_BEARER_TOKEN.trim().length > 0;
if (!configured) {
  console.log("X live smoke skipped: X_BEARER_TOKEN is not configured.");
  process.exit(0);
}

const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(process.execPath, [vitest, "run", "tests/smoke/x.test.ts", "--reporter=verbose"], {
  stdio: "inherit",
  env: { ...smokeEnvironment, RUN_X_SMOKE: "1" },
});
process.exit(result.status ?? 1);
