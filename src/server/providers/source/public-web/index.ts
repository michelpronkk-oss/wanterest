import { createHash } from "node:crypto";
import { z } from "zod";

import {
  rawSourceItemEnvelopeSchema,
  sourceDiscoveryRequestSchema,
  sourceItemCandidateSchema,
  SourceAdapterError,
  type RawSourceItemEnvelope,
  type SourceAdapter,
  type SourceDiscoveryPage,
  type SourceDiscoveryRequest,
  type SourceHealthResult,
  type SourceItemCandidate,
} from "../contracts";
import type { WebsiteFetcher, WebsitePage, WebsitePageExtractor, WebsiteRawPage } from "../../website/contracts";
import type { SafeWebsiteFetcherOptions } from "../../website/fetcher";

const publicWebPayloadSchema = z.object({
  url: z.string().url(),
  status: z.number().int(),
  contentType: z.string(),
  title: z.string().nullable().optional(),
  metaDescription: z.string().nullable().optional(),
  text: z.string().max(100_000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).passthrough();

const genericTerms = new Set(["a", "an", "and", "best", "for", "from", "how", "in", "looking", "need", "of", "or", "the", "to", "tool", "with"]);

function cursorOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const match = /^index:(\d+)$/.exec(cursor);
  if (!match) throw new SourceAdapterError("INVALID_CURSOR", "Public Web cursor is invalid.");
  return Number(match[1]);
}

function requestedUrls(request: SourceDiscoveryRequest): string[] {
  const metadata = request.requestMetadata as Record<string, unknown>;
  const raw = Array.isArray(metadata.urls) ? metadata.urls : Array.isArray(metadata.publicUrls) ? metadata.publicUrls : [];
  return [...new Set(raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0))].slice(0, 10);
}

function matchesQuery(page: WebsitePage, query: string | undefined): boolean {
  if (!query) return true;
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3 && !genericTerms.has(term));
  if (!terms.length) return true;
  const haystack = `${page.title ?? ""} ${page.metaDescription ?? ""} ${page.headings.join(" ")} ${page.text}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function canonicalUrl(input: string): string {
  const parsed = new URL(input);
  if (!/^https?:$/.test(parsed.protocol)) throw new SourceAdapterError("INVALID_URL", "Public Web returned a non-HTTP URL.");
  parsed.hash = "";
  return parsed.toString();
}

function localExtract(raw: WebsiteRawPage): WebsitePage {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(raw.text)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) ?? null;
  const metaDescription = /<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']*)["'][^>]*>/i.exec(raw.text)?.[1]?.slice(0, 1_000) ?? null;
  const headings = [...raw.text.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((match) => match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 16);
  const text = raw.text.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/li>|<\/section>|<\/article>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 18_000);
  return { url: raw.url, pageType: "homepage", title, metaDescription, headings, text, links: [] };
}

export type PublicWebSourceAdapterOptions = {
  fetcher?: WebsiteFetcher;
  extractor?: WebsitePageExtractor;
  fetcherOptions?: SafeWebsiteFetcherOptions;
};

export class PublicWebSourceAdapter implements SourceAdapter {
  readonly key = "public-web";
  readonly capabilities = { supportsSearch: false, supportsIncrementalCursor: true, supportsThreadExpansion: false } as const;

  private fetcher?: WebsiteFetcher;
  private extractor?: WebsitePageExtractor;
  private readonly fetcherOptions?: SafeWebsiteFetcherOptions;
  private readonly useLocalExtractor: boolean;

  constructor(options: PublicWebSourceAdapterOptions = {}) {
    this.fetcher = options.fetcher;
    this.extractor = options.extractor;
    this.fetcherOptions = options.fetcherOptions;
    this.useLocalExtractor = Boolean(options.fetcher);
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    const urls = requestedUrls(request);
    if (!urls.length) {
      return { items: [], diagnostics: { accepted: 0, rejected: 0, messages: ["Public Web discovery requires explicit public URLs supplied by an approved search/discovery adapter; arbitrary crawling is disabled."] } };
    }
    const offset = cursorOffset(request.cursor);
    const selected = urls.slice(offset, offset + Math.min(request.limit, 5));
    const items: RawSourceItemEnvelope[] = [];
    const messages: string[] = [];
    let rejected = 0;
    for (const inputUrl of selected) {
      try {
        const raw = await this.getFetcher().then((fetcher) => fetcher.fetchPage(inputUrl));
        const page = await this.getExtractor().then((extractor) => extractor.extract(raw, "homepage"));
        if (!matchesQuery(page, request.query)) {
          rejected += 1;
          continue;
        }
        const normalized = canonicalUrl(raw.url);
        const contentHash = createHash("sha256").update(page.text, "utf8").digest("hex");
        items.push({
          sourceKey: this.key,
          externalId: normalized,
          fetchedAt: new Date().toISOString(),
          payload: { url: normalized, status: raw.status, contentType: raw.contentType, title: page.title, metaDescription: page.metaDescription, text: page.text, contentHash },
          payloadUri: normalized,
          requestMetadata: { provider: "safe-public-web-fetch", query: request.query ?? null },
          cursorContext: { sourceCategory: "public_web", pageType: "web_page" },
        });
        if (items.length >= request.limit) break;
      } catch (error) {
        rejected += 1;
        messages.push(error instanceof Error ? error.message.slice(0, 180) : "Public Web page was rejected by the safe fetch boundary.");
      }
    }
    const nextOffset = offset + selected.length;
    return {
      items,
      nextCursor: nextOffset < urls.length ? `index:${nextOffset}` : undefined,
      diagnostics: { accepted: items.length, rejected, messages: ["Fetched only explicit public URLs through the existing SSRF-safe website adapter; no site-wide crawling is performed.", ...messages] },
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    const envelope = rawSourceItemEnvelopeSchema.parse(raw);
    const parsed = publicWebPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Public Web page failed validation.");
    const page = parsed.data;
    return sourceItemCandidateSchema.parse({
      sourceKey: this.key,
      externalId: envelope.externalId,
      externalConversationId: envelope.externalId,
      canonicalUrl: page.url,
      title: page.title ?? undefined,
      body: page.text,
      capturedAt: envelope.fetchedAt,
      metadata: {
        sourceCategory: "public_web",
        providerType: "web_page",
        contentType: page.contentType,
        metaDescription: page.metaDescription ?? null,
        contentHash: page.contentHash,
        pageType: raw.cursorContext.pageType ?? "web_page",
        authorLocation: typeof raw.requestMetadata.authorLocation === "string" ? raw.requestMetadata.authorLocation : null,
        countryCode: typeof raw.requestMetadata.countryCode === "string" ? raw.requestMetadata.countryCode : null,
        country: typeof raw.requestMetadata.country === "string" ? raw.requestMetadata.country : null,
      },
      status: "active",
    });
  }

  async healthCheck(): Promise<SourceHealthResult> {
    return { sourceKey: this.key, ok: true, latencyMs: 0, degradationState: "healthy" };
  }

  private async getFetcher(): Promise<WebsiteFetcher> {
    if (this.fetcher) return this.fetcher;
    const { SafeWebsiteFetcher } = await import("../../website/fetcher");
    this.fetcher = new SafeWebsiteFetcher(this.fetcherOptions);
    return this.fetcher;
  }

  private async getExtractor(): Promise<WebsitePageExtractor> {
    if (this.extractor) return this.extractor;
    if (this.useLocalExtractor) {
      this.extractor = { extract: localExtract };
      return this.extractor;
    }
    const { HtmlWebsitePageExtractor } = await import("../../website/extractor");
    this.extractor = new HtmlWebsitePageExtractor();
    return this.extractor;
  }
}

export const publicWebSourceAdapter = new PublicWebSourceAdapter();

export type { WebsiteRawPage };
