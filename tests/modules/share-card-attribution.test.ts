import { describe, expect, it, vi } from "vitest";

import {
  createShareCardAttributionToken,
  SHARE_CARD_ATTRIBUTION_TTL_SECONDS,
  verifyShareCardAttributionToken,
} from "../../src/server/modules/share-cards/share-card-attribution";

vi.mock("server-only", () => ({}));

describe("13B first-party share attribution", () => {
  const slug = "abcdefghijklmnopqrstuvwxyz1234567890ABCD";
  const secret = "test-only-share-attribution-secret";
  const now = Date.parse("2026-09-28T12:00:00.000Z");

  it("signs an opaque bounded handoff and rejects tampering", () => {
    const token = createShareCardAttributionToken(slug, now, secret);
    expect(token).toBeTruthy();
    expect(verifyShareCardAttributionToken(token, now, secret)).toBe(slug);
    expect(verifyShareCardAttributionToken(`${token}x`, now, secret)).toBeNull();
    expect(verifyShareCardAttributionToken(token?.replace(slug, `${slug.slice(0, -1)}x`), now, secret)).toBeNull();
  });

  it("expires and never accepts malformed or client-selected identifiers", () => {
    const token = createShareCardAttributionToken(slug, now, secret);
    expect(verifyShareCardAttributionToken(token, now + (SHARE_CARD_ATTRIBUTION_TTL_SECONDS + 1) * 1000, secret)).toBeNull();
    expect(createShareCardAttributionToken("not-a-public-slug", now, secret)).toBeNull();
    expect(verifyShareCardAttributionToken("9999999999.fake.fake", now, secret)).toBeNull();
  });
});
