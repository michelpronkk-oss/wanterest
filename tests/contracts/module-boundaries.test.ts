import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Phase 1 module boundaries", () => {
  it("keeps the browser Supabase client free of server-only imports", () => {
    const browserClient = readFileSync(
      path.resolve(process.cwd(), "src/lib/supabase/browser.ts"),
      "utf8",
    );
    expect(browserClient).not.toContain("server-only");
    expect(browserClient).not.toContain("@/server/");
  });

  it("keeps the service-role client server-only", () => {
    const serviceClient = readFileSync(
      path.resolve(process.cwd(), "src/server/providers/supabase/service.ts"),
      "utf8",
    );
    expect(serviceClient).toContain('import "server-only"');
  });
});
