import { z } from "zod";

export const onboardingWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a workspace name.").max(120),
});

export const onboardingProductInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a product name.").max(200),
  websiteUrl: z.string().trim().min(1, "Enter a website URL.").max(2_000),
  description: z.string().trim().max(5_000, "Keep the description under 5,000 characters.").optional().default(""),
});

export const productUnderstandingInputSchema = z.object({
  workspaceId: z.string().uuid(),
  productId: z.string().uuid(),
  description: z.string().trim().min(1, "Add a short product description.").max(5_000),
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
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error("Enter a valid public http(s) website URL.");
  }
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Enter a valid public http(s) website URL.");
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error("Enter a valid public http(s) website URL.");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".local") || isPrivateAddress(hostname)) {
    throw new Error("Use a public http(s) website URL.");
  }
  return parsed.toString();
}

function isPrivateAddress(hostname: string): boolean {
  if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:")) return true;
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
