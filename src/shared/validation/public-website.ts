const PUBLIC_WEBSITE_ERROR = "Enter your product's public website or domain.";

/**
 * Shared public-website normalization used by the marketing entry point and
 * the authoritative onboarding schema. It intentionally contains the same
 * destination checks as onboarding, so the browser can give early feedback
 * without creating a second URL policy.
 */
export function normalizePublicWebsiteUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    throw new Error(PUBLIC_WEBSITE_ERROR);
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error(PUBLIC_WEBSITE_ERROR);
  }
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(PUBLIC_WEBSITE_ERROR);
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.port) {
    throw new Error(PUBLIC_WEBSITE_ERROR);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".local") || isIpAddress(hostname) || isPrivateAddress(hostname) || !isRegistrableLookingHostname(hostname)) {
    throw new Error(PUBLIC_WEBSITE_ERROR);
  }
  return `https://${hostname}`;
}

function isIpAddress(hostname: string): boolean {
  if (hostname.includes(":")) return true;
  const labels = hostname.split(".");
  return labels.length === 4 && labels.every((label) => /^\d+$/.test(label));
}

function isRegistrableLookingHostname(hostname: string): boolean {
  const labels = hostname.split(".");
  if (labels.length < 2) return false;
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return false;
  const tld = labels[labels.length - 1] ?? "";
  return tld.length >= 2 || tld.startsWith("xn--");
}

function isPrivateAddress(hostname: string): boolean {
  if (hostname.includes(":") && (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:"))) return true;
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

export function tryNormalizePublicWebsiteUrl(input: string | null | undefined): string | null {
  if (!input?.trim()) return null;
  try {
    return normalizePublicWebsiteUrl(input);
  } catch {
    return null;
  }
}
