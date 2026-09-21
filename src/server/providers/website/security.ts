import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { WebsiteFetchError } from "./contracts";

type DnsLookupResult = { address: string; family?: number };
export type DnsLookup = (hostname: string) => Promise<DnsLookupResult[]>;

const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "com.au",
  "net.au",
  "co.nz",
  "co.jp",
  "com.br",
  "co.in",
  "com.cn",
]);

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isBlockedIpv4(value: string): boolean {
  const octets = parseIpv4(value);
  if (!octets) return true;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || (first === 100 && second >= 64 && second <= 127) || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && (second === 0 || second === 168)) || (first === 198 && (second === 18 || second === 19)) || first >= 224 || (first === 203 && second === 0 && octets[2] === 113) || (first === 198 && second === 51 && octets[2] === 100);
}

function isBlockedIpv6(value: string): boolean {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.includes(".")) {
    const mappedIpv4 = normalized.slice(normalized.lastIndexOf(":") + 1);
    if (parseIpv4(mappedIpv4)) return isBlockedIpv4(mappedIpv4);
  }
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:") || normalized.startsWith("ff") || normalized.startsWith("2001:db8") || normalized.startsWith("2001:10");
}

export function isBlockedAddress(value: string): boolean {
  const family = isIP(value);
  return family === 4 ? isBlockedIpv4(value) : family === 6 ? isBlockedIpv6(value) : true;
}

function hostnameLabels(hostname: string): string[] {
  return hostname.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
}

function isRegistrableLookingHostname(hostname: string): boolean {
  const labels = hostnameLabels(hostname);
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return false;
  const tld = labels[labels.length - 1] ?? "";
  return tld.length >= 2 || tld.startsWith("xn--");
}

export function registrableHostname(hostname: string): string {
  const labels = hostnameLabels(hostname);
  const suffix = labels.slice(-2).join(".");
  return labels.slice(-(MULTI_LABEL_PUBLIC_SUFFIXES.has(suffix) ? 3 : 2)).join(".");
}

export function isSamePublicSite(first: string, second: string): boolean {
  return registrableHostname(first) === registrableHostname(second);
}

export function parsePublicWebsiteUrl(input: string): URL {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new WebsiteFetchError("Website URL is invalid.", "invalid_url");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!/^https?:$/.test(parsed.protocol) || !hostname || parsed.username || parsed.password || parsed.port || isIP(hostname) || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname === "metadata.google.internal" || hostname === "metadata" || hostname === "instance-data" || !isRegistrableLookingHostname(hostname)) {
    throw new WebsiteFetchError("Website URL is not a public HTTP(S) address.", "invalid_url");
  }
  parsed.hash = "";
  parsed.hostname = hostname;
  return parsed;
}

export async function assertPublicHostname(hostname: string, lookup: DnsLookup = async (value) => (await dnsLookup(value, { all: true, verbatim: true }))): Promise<void> {
  if (isIP(hostname) || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new WebsiteFetchError("Website host is not public.", "invalid_url");
  }
  let addresses: DnsLookupResult[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new WebsiteFetchError("Website host could not be resolved.", "dns");
  }
  if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new WebsiteFetchError("Website host does not resolve to a public address.", "invalid_url");
  }
}
