import { z } from "zod";

const PUBLIC_WEBSITE_ERROR = "Enter your product's public website or domain.";

export const onboardingWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a workspace name.").max(120),
});

export const onboardingProductInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a product name.").max(200),
  websiteUrl: z.string().trim().min(1, "Enter a website URL.").max(2_000),
  description: z
    .string()
    .trim()
    .min(15, "Describe your product in at least 15 characters.")
    .max(240, "Keep the description under 240 characters."),
});

export const productUnderstandingInputSchema = z.object({
  workspaceId: z.string().uuid(),
  productId: z.string().uuid(),
  description: z
    .string()
    .trim()
    .min(15, "Describe your product in at least 15 characters.")
    .max(240, "Keep the description under 240 characters."),
});

export const initialScanInputSchema = z.object({
  workspaceId: z.string().uuid(),
  productId: z.string().uuid(),
});

export type OnboardingWorkspaceInput = z.infer<typeof onboardingWorkspaceInputSchema>;
export type OnboardingProductInput = z.infer<typeof onboardingProductInputSchema>;

/**
 * The first-scan form does not fetch this URL. It is normalized for product
 * identity and snapshot provenance only; no unrestricted website fetch is
 * performed by onboarding.
 */
export function normalizeOnboardingWebsiteUrl(input: string): string {
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

export function onboardingRegistrableDomain(input: string): string {
  const normalized = normalizeOnboardingWebsiteUrl(input);
  const hostname = new URL(normalized).hostname.replace(/^www\./i, "").toLowerCase();
  const labels = hostname.split(".");
  const suffix = labels.slice(-2).join(".");
  const take = MULTI_LABEL_PUBLIC_SUFFIXES.has(suffix) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Derives the initial product label without trusting a browser-supplied name. */
export function deriveOnboardingProductName(input: string): string {
  const domain = onboardingRegistrableDomain(input);
  const label = domain.split(".")[0] ?? domain;
  return label
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function isPrivateAddress(hostname: string): boolean {
  if (hostname.includes(":") && (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:"))) return true;
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

export function slugifyOnboardingName(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "workspace";
}
