import { describe, expect, it } from "vitest";

import { canonicalTimestamp, TIMESTAMP_CANONICALIZATION_VERSION } from "../../src/server/modules/intelligence/timestamp";

describe("canonicalTimestamp (timestamp_canonicalization_v1)", () => {
  it("has the expected version tag", () => {
    expect(TIMESTAMP_CANONICALIZATION_VERSION).toBe("timestamp_canonicalization_v1");
  });

  it("canonicalizes a PostgREST timestamptz string (no fractional seconds) to strict ISO-8601 Z", () => {
    expect(canonicalTimestamp("2026-09-21T16:15:53+00:00")).toBe("2026-09-21T16:15:53.000Z");
  });

  it("canonicalizes a PostgREST timestamptz string with fractional seconds to strict ISO-8601 Z", () => {
    expect(canonicalTimestamp("2026-09-03T05:37:14.123456+00:00")).toBe("2026-09-03T05:37:14.123Z");
  });

  it("leaves an already-Z-suffixed ISO string semantically identical (same instant)", () => {
    const result = canonicalTimestamp("2026-09-03T05:37:14Z");
    expect(result).toBe("2026-09-03T05:37:14.000Z");
    expect(new Date(result!).getTime()).toBe(new Date("2026-09-03T05:37:14Z").getTime());
  });

  it("converts an explicit non-UTC offset to UTC while preserving the exact instant", () => {
    const result = canonicalTimestamp("2026-09-03T07:37:14+02:00");
    expect(result).toBe("2026-09-03T05:37:14.000Z");
    expect(new Date(result!).getTime()).toBe(new Date("2026-09-03T07:37:14+02:00").getTime());
  });

  it("accepts a Date object and preserves the exact instant", () => {
    const date = new Date("2026-09-03T05:37:14.000Z");
    expect(canonicalTimestamp(date)).toBe("2026-09-03T05:37:14.000Z");
  });

  it("passes null through as null", () => {
    expect(canonicalTimestamp(null)).toBeNull();
  });

  it("passes undefined through as null", () => {
    expect(canonicalTimestamp(undefined)).toBeNull();
  });

  it("fails safely to null on a malformed non-null timestamp - never invents 'now'", () => {
    const before = Date.now();
    expect(canonicalTimestamp("not-a-timestamp")).toBeNull();
    expect(canonicalTimestamp("2026-13-45T99:99:99Z")).toBeNull();
    expect(canonicalTimestamp("")).toBeNull();
    // Sanity: a bug that fell back to "now" would produce a timestamp >= `before`; null has no time to compare, so this just documents intent.
    expect(Date.now()).toBeGreaterThanOrEqual(before);
  });

  describe("the exact three production candidates from canary scan 6b3b0e02-d844-40ba-950b-ccd0d9fed99a", () => {
    it("candidate 1 (youtube, 86e13b9e...): 2024-03-21T05:17:04+00:00", () => {
      expect(canonicalTimestamp("2024-03-21T05:17:04+00:00")).toBe("2024-03-21T05:17:04.000Z");
    });
    it("candidate 2 (github, c8fe4aaf...): 2026-09-03T05:37:14+00:00", () => {
      expect(canonicalTimestamp("2026-09-03T05:37:14+00:00")).toBe("2026-09-03T05:37:14.000Z");
    });
    it("candidate 3 (x, a19804df...): 2026-09-26T14:51:03+00:00", () => {
      expect(canonicalTimestamp("2026-09-26T14:51:03+00:00")).toBe("2026-09-26T14:51:03.000Z");
    });
  });
});
