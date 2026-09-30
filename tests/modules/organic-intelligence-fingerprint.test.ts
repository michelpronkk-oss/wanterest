import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fingerprintPublicIdentity } from "../../src/server/modules/organic-intelligence/public-identity-fingerprint";

describe("server-only public identity fingerprints", () => {
  const base = { value: "provider-author-42", secret: "s".repeat(40), keyVersion: "v1" };

  it("uses deterministic HMAC fingerprints and never returns the source identifier", () => {
    const first = fingerprintPublicIdentity({ ...base, kind: "author" });
    const again = fingerprintPublicIdentity({ ...base, kind: "author" });
    expect(first).toEqual(again);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.fingerprint).not.toContain(base.value);
    expect(first.keyVersion).toBe("v1");
  });

  it("domain-separates different identity kinds and key versions", () => {
    const author = fingerprintPublicIdentity({ ...base, kind: "author" });
    const episode = fingerprintPublicIdentity({ ...base, kind: "episode" });
    const rotated = fingerprintPublicIdentity({ ...base, kind: "author", keyVersion: "v2" });
    expect(author.fingerprint).not.toBe(episode.fingerprint);
    expect(author.fingerprint).not.toBe(rotated.fingerprint);
  });

  it("fails closed for missing secrets and invalid identities", () => {
    expect(() => fingerprintPublicIdentity({ ...base, kind: "author", secret: "short" })).toThrow("public_identity_hmac_secret_unavailable");
    expect(() => fingerprintPublicIdentity({ ...base, kind: "author", value: " " })).toThrow("public_identity_value_invalid");
    expect(() => fingerprintPublicIdentity({ ...base, kind: "author", keyVersion: "version with spaces" })).toThrow("public_identity_key_version_invalid");
  });
});
