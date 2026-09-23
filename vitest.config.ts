import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Mirrors tsconfig.json's "@/*" -> "./src/*" path mapping. Without this, any test
// that imports a module using the "@/..." alias (the app's normal internal import
// style) fails to resolve at all, which silently excluded most server modules from
// direct unit testing.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
