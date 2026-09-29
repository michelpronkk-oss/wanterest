/**
 * Writes the static Apex 2.0 library from the single geometry module so the
 * files can never drift from the React/server artwork. Run with:
 *   npx vite-node scripts/generate-apex-assets.ts
 * `tests/components/apex-artwork.test.tsx` fails if a committed file differs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { APEX_STATIC_ASSETS } from "../src/shared/apex-artwork";

const directory = join(process.cwd(), "public/identity/apex-2");
mkdirSync(directory, { recursive: true });
for (const [name, build] of Object.entries(APEX_STATIC_ASSETS)) {
  writeFileSync(join(directory, name), `${build()}\n`);
  console.log(`wrote public/identity/apex-2/${name}`);
}
