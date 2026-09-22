import { z } from "zod";
import { normalizePublicWebsiteUrl } from "../../../shared/validation/public-website";

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
  return normalizePublicWebsiteUrl(input);
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
