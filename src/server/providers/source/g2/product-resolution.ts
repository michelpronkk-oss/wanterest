import { z } from "zod";

import type { JsonObject } from "../../../db/database.helpers";
import { SourceAdapterError } from "../contracts";
import { fetchJson, type SourceFetch } from "../http";

const catalogResponseSchema = z.object({
  data: z.array(z.unknown()).default([]),
}).passthrough();

export const g2ProductResolutionTargetSchema = z.object({
  key: z.string().trim().min(1).max(180).optional(),
  kind: z.enum(["product", "competitor", "alternative"]).default("product"),
  name: z.string().trim().max(200).optional(),
  domain: z.string().trim().max(253).nullable().optional(),
  slug: z.string().trim().max(200).optional(),
  vendor: z.string().trim().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export type G2ProductResolutionTarget = z.infer<typeof g2ProductResolutionTargetSchema>;

export const g2ProductMappingSchema = z.object({
  status: z.enum(["resolved", "no_match", "ambiguous_match"]),
  targetKey: z.string().trim().min(1).max(180),
  targetFingerprint: z.string().trim().min(1).max(500),
  productId: z.string().trim().min(1).max(200).optional(),
  matchedBy: z.enum(["domain", "name", "slug", "vendor_product_metadata"]).optional(),
  candidateProductIds: z.array(z.string().trim().min(1).max(200)).max(25).default([]),
  resolvedAt: z.string().datetime({ offset: true }),
  resolverVersion: z.literal("g2-product-resolution-v1"),
}).strict();

export type G2ProductMapping = z.infer<typeof g2ProductMappingSchema>;
export type G2ProductMappings = Record<string, G2ProductMapping>;

export type G2ResolutionDiagnostic = G2ProductMapping;

type CatalogProduct = {
  id: string;
  name?: string;
  domain?: string;
  slug?: string;
  vendor?: string;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizedName(value: unknown): string {
  return text(value)?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";
}

function normalizedSlug(value: unknown): string {
  return normalizedName(value).replace(/\s+/g, "-");
}

export function normalizedDomain(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return hostname || undefined;
  } catch {
    return raw.toLowerCase().replace(/^www\./, "").replace(/\.$/, "").split(/[/?#]/, 1)[0] || undefined;
  }
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const result = text(value);
    if (result) return result;
  }
  return undefined;
}

function catalogProduct(value: unknown): CatalogProduct | null {
  const root = object(value);
  const attributes = object(root.attributes);
  const source = { ...root, ...attributes };
  const vendorObject = object(source.vendor);
  const id = firstText(root.id, source.id);
  if (!id) return null;
  return {
    id,
    name: firstText(source.name, source.product_name, source.productName),
    domain: normalizedDomain(firstText(source.domain, source.website_domain, source.website_url, source.websiteUrl)),
    slug: firstText(source.slug, source.product_slug, source.productSlug),
    vendor: firstText(source.vendor_name, source.vendorName, vendorObject.name, vendorObject.display_name),
  };
}

function metadataValue(target: G2ProductResolutionTarget, keys: string[]): unknown {
  for (const key of keys) {
    if (target.metadata && target.metadata[key] !== undefined) return target.metadata[key];
  }
  return undefined;
}

function targetName(target: G2ProductResolutionTarget): string | undefined {
  return firstText(target.name, metadataValue(target, ["productName", "product_name", "name"]));
}

function targetDomain(target: G2ProductResolutionTarget): string | undefined {
  return normalizedDomain(firstText(target.domain, metadataValue(target, ["domain", "website", "websiteUrl", "website_url"])));
}

function targetSlug(target: G2ProductResolutionTarget): string | undefined {
  return firstText(target.slug, metadataValue(target, ["slug", "productSlug", "product_slug"]));
}

function targetVendor(target: G2ProductResolutionTarget): string | undefined {
  return firstText(target.vendor, metadataValue(target, ["vendor", "vendorName", "vendor_name"]));
}

export function g2TargetKey(target: G2ProductResolutionTarget): string {
  if (target.key?.trim()) return target.key.trim();
  const identity = targetDomain(target) ?? normalizedSlug(targetSlug(target)) ?? normalizedName(targetName(target));
  return `${target.kind}:${identity || "unknown"}`;
}

export function g2TargetFingerprint(target: G2ProductResolutionTarget): string {
  return [
    target.kind,
    normalizedDomain(targetDomain(target)) ?? "",
    normalizedName(targetName(target)),
    normalizedSlug(targetSlug(target)),
    normalizedName(targetVendor(target)),
  ].join("|");
}

function candidateMatches(candidates: CatalogProduct[], predicate: (candidate: CatalogProduct) => boolean): CatalogProduct[] {
  return candidates.filter(predicate);
}

function uniqueCandidates(candidates: CatalogProduct[]): CatalogProduct[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

function vendorProductMetadataMatches(candidate: CatalogProduct, target: G2ProductResolutionTarget): boolean {
  const vendor = targetVendor(target);
  const name = firstText(metadataValue(target, ["productName", "product_name"]), targetName(target));
  return Boolean(vendor && name && normalizedName(candidate.vendor) === normalizedName(vendor) && normalizedName(candidate.name) === normalizedName(name));
}

function cachedMapping(target: G2ProductResolutionTarget, cached: G2ProductMapping | undefined): G2ResolutionDiagnostic | null {
  if (!cached || cached.status !== "resolved" || !cached.productId) return null;
  if (cached.targetFingerprint !== g2TargetFingerprint(target)) return null;
  return { ...cached, targetKey: g2TargetKey(target) };
}

export class G2ProductResolver {
  private readonly inFlight = new Map<string, Promise<G2ResolutionDiagnostic>>();
  private readonly catalogCache = new Map<string, Promise<CatalogProduct[]>>();

  constructor(
    private readonly options: {
      apiKey: string;
      productsBaseUrl: string;
      fetchImpl: SourceFetch;
      timeoutMs: number;
      maxCatalogRequests?: number;
    },
  ) {}

  resolve(targetInput: G2ProductResolutionTarget, cached?: G2ProductMapping): Promise<G2ResolutionDiagnostic> {
    const target = g2ProductResolutionTargetSchema.parse(targetInput);
    const cachedResult = cachedMapping(target, cached);
    if (cachedResult) return Promise.resolve(cachedResult);

    const key = `${g2TargetKey(target)}:${g2TargetFingerprint(target)}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = this.resolveUncached(target).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private async resolveUncached(target: G2ProductResolutionTarget): Promise<G2ResolutionDiagnostic> {
    const targetKey = g2TargetKey(target);
    const targetFingerprint = g2TargetFingerprint(target);
    const resolvedAt = new Date().toISOString();
    if (!this.options.apiKey) {
      throw new SourceAdapterError("CONFIGURATION_MISSING", "G2 API access is not configured.");
    }

    const attempts: Array<{ filter: "domain" | "name" | "slug"; value: string; match: (candidate: CatalogProduct) => boolean }> = [];
    const domain = targetDomain(target);
    const name = targetName(target);
    const slug = targetSlug(target);
    if (domain) attempts.push({ filter: "domain", value: domain, match: (candidate) => candidate.domain === domain });
    if (name) attempts.push({ filter: "name", value: name, match: (candidate) => normalizedName(candidate.name) === normalizedName(name) });
    if (slug) attempts.push({ filter: "slug", value: slug, match: (candidate) => normalizedSlug(candidate.slug) === normalizedSlug(slug) });

    const vendor = targetVendor(target);
    const metadataName = firstText(metadataValue(target, ["productName", "product_name"]), name);
    if (vendor && metadataName) {
      attempts.push({
        filter: "name",
        value: metadataName,
        match: (candidate) => normalizedName(candidate.name) === normalizedName(metadataName) && normalizedName(candidate.vendor) === normalizedName(vendor),
      });
    }

    const maxRequests = Math.max(1, Math.min(4, this.options.maxCatalogRequests ?? 4));
    for (const attempt of attempts.slice(0, maxRequests)) {
      const candidates = await this.catalog(attempt.filter, attempt.value);
      const matches = uniqueCandidates(candidateMatches(candidates, attempt.match));
      if (matches.length === 1) {
        if (vendor && metadataName && matches[0]!.vendor && normalizedName(matches[0]!.vendor) !== normalizedName(vendor)) continue;
        return {
          status: "resolved",
          targetKey,
          targetFingerprint,
          productId: matches[0]!.id,
          matchedBy: vendor && attempt.filter === "name" && normalizedName(matches[0]!.vendor) === normalizedName(vendor) ? "vendor_product_metadata" : attempt.filter,
          candidateProductIds: [matches[0]!.id],
          resolvedAt,
          resolverVersion: "g2-product-resolution-v1",
        };
      }
      if (matches.length > 1) {
        const metadataMatches = matches.filter((candidate) => vendorProductMetadataMatches(candidate, target));
        if (metadataMatches.length === 1) {
          return {
            status: "resolved",
            targetKey,
            targetFingerprint,
            productId: metadataMatches[0]!.id,
            matchedBy: "vendor_product_metadata",
            candidateProductIds: [metadataMatches[0]!.id],
            resolvedAt,
            resolverVersion: "g2-product-resolution-v1",
          };
        }
        return {
          status: "ambiguous_match",
          targetKey,
          targetFingerprint,
          candidateProductIds: matches.slice(0, 25).map((candidate) => candidate.id),
          resolvedAt,
          resolverVersion: "g2-product-resolution-v1",
        };
      }
    }

    return { status: "no_match", targetKey, targetFingerprint, candidateProductIds: [], resolvedAt, resolverVersion: "g2-product-resolution-v1" };
  }

  private catalog(filter: "domain" | "name" | "slug", value: string): Promise<CatalogProduct[]> {
    const key = `${filter}:${value.toLowerCase()}`;
    const cached = this.catalogCache.get(key);
    if (cached) return cached;
    const promise = this.fetchCatalog(filter, value);
    this.catalogCache.set(key, promise);
    if (this.catalogCache.size > 64) this.catalogCache.delete(this.catalogCache.keys().next().value as string);
    return promise;
  }

  private async fetchCatalog(filter: "domain" | "name" | "slug", value: string): Promise<CatalogProduct[]> {
    const params = new URLSearchParams({ [`filter[${filter}]`]: value, "page[size]": "25", "page[number]": "1" });
    const response = await fetchJson(this.options.fetchImpl, `${this.options.productsBaseUrl}/products?${params.toString()}`, {
      provider: "g2-products-api",
      mode: "authenticated",
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      timeoutMs: this.options.timeoutMs,
    });
    const parsed = catalogResponseSchema.safeParse(response.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "G2 product catalog response failed validation.");
    return parsed.data.data.map(catalogProduct).filter((candidate): candidate is CatalogProduct => Boolean(candidate));
  }
}

export function readG2ProductMappings(value: unknown): G2ProductMappings {
  const objectValue = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result: G2ProductMappings = {};
  for (const [key, candidate] of Object.entries(objectValue)) {
    const parsed = g2ProductMappingSchema.safeParse(candidate);
    if (parsed.success) result[key] = parsed.data;
  }
  return result;
}

export function g2MappingsFromSourceFilters(value: unknown): G2ProductMappings {
  const filters = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return readG2ProductMappings(filters.g2ProductMappings);
}

export function g2SourceFiltersWithMappings(filtersValue: unknown, mappings: G2ProductMappings): JsonObject {
  const filters = filtersValue && typeof filtersValue === "object" && !Array.isArray(filtersValue) ? filtersValue as JsonObject : {};
  return { ...filters, g2ProductMappings: mappings };
}
