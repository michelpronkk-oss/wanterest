import { describe, expect, it } from "vitest";

import { formatScore, safeExternalUrl, sourceLabel } from "../../src/components/dashboard/dashboard-utils";

describe("dashboard display helpers", () => {
  it("formats backend scores without changing their meaning", () => {
    expect(formatScore(0.82)).toBe("82%");
  });

  it("only allows safe HTTP(S) source links", () => {
    expect(safeExternalUrl("https://example.com/post")).toBe("https://example.com/post");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("not a URL")).toBeNull();
  });

  it("keeps provider labels generic", () => {
    expect(sourceLabel("hacker_news")).toBe("Hacker News");
  });
});
