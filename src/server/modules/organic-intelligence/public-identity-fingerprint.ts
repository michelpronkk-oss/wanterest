import "server-only";

import { createHmac } from "node:crypto";

export type PublicIdentityKind = "author" | "episode" | "viral_event" | "canonical_url" | "exact_content";

/**
 * Produces a domain-separated pseudonymous identity for internal grouping.
 * The caller must supply a server-held secret; source identifiers are never
 * returned, logged, or suitable for public projection.
 */
export function fingerprintPublicIdentity(input: {
  kind: PublicIdentityKind;
  value: string;
  secret: string;
  keyVersion: string;
}): { fingerprint: string; keyVersion: string } {
  if (input.value.trim().length === 0 || input.value.length > 4_096) throw new Error("public_identity_value_invalid");
  if (input.secret.length < 32) throw new Error("public_identity_hmac_secret_unavailable");
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(input.keyVersion)) throw new Error("public_identity_key_version_invalid");
  const fingerprint = createHmac("sha256", input.secret)
    .update(`wanterest:seo26:${input.keyVersion}:${input.kind}:`, "utf8")
    .update(input.value, "utf8")
    .digest("hex");
  return { fingerprint, keyVersion: input.keyVersion };
}
