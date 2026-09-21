import "server-only";

import { WebsiteFetchError, type WebsiteFetcher, type WebsitePage, type WebsitePageExtractor, type WebsitePageSelector, type WebsiteUnderstandingInput, type WebsiteUnderstandingProvenance } from "./contracts";
import { SafeWebsiteFetcher } from "./fetcher";
import { HtmlWebsitePageExtractor, summarizeWebsitePage } from "./extractor";
import { DeterministicWebsitePageSelector } from "./selector";
import { parsePublicWebsiteUrl } from "./security";

const MAX_SECONDARY_PAGES = 4;
const MAX_COMBINED_TEXT = 48_000;

export type WebsiteUnderstandingResult = {
  input: WebsiteUnderstandingInput;
  provenance: WebsiteUnderstandingProvenance;
  diagnostics: { homepageSucceeded: boolean; selectedPages: number; fetchedPages: number; fallbackUsed: boolean; fallbackReason: string | null };
};

function safeFailureReason(error: unknown): string {
  if (error instanceof WebsiteFetchError) return error.kind;
  return "failed";
}

function compact(value: string | null | undefined, maximum: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function pageBlock(page: WebsitePage): string {
  const parts = [`[Source page: ${page.url}]`];
  if (page.title) parts.push(`Title: ${page.title}`);
  if (page.metaDescription) parts.push(`Meta description: ${page.metaDescription}`);
  if (page.headings.length) parts.push(`Headings: ${page.headings.join(" | ")}`);
  if (page.text) parts.push(page.text);
  return parts.join("\n");
}

export class WebsiteUnderstandingService {
  constructor(
    private readonly fetcher: WebsiteFetcher = new SafeWebsiteFetcher(),
    private readonly extractor: WebsitePageExtractor = new HtmlWebsitePageExtractor(),
    private readonly selector: WebsitePageSelector = new DeterministicWebsitePageSelector(),
  ) {}

  async understand(input: { websiteUrl: string; userDescription?: string | null }): Promise<WebsiteUnderstandingResult> {
    const parsedUrl = parsePublicWebsiteUrl(input.websiteUrl);
    const canonicalUrl = parsedUrl.toString();
    const hostname = parsedUrl.hostname;
    const userDescription = compact(input.userDescription, 240) || null;
    const fetchedAt = new Date().toISOString();
    let homepage: WebsitePage;
    try {
      homepage = this.extractor.extract(await this.fetcher.fetchPage(canonicalUrl, { allowedHostname: hostname }), "homepage");
      if (!homepage.text && !homepage.title && !homepage.metaDescription && !homepage.headings.length) throw new WebsiteFetchError("Website homepage had no readable content.", "empty");
    } catch (error) {
      const fallbackReason = safeFailureReason(error);
      const fallbackText = userDescription ?? "";
      if (process.env.NODE_ENV !== "production") console.info("[website-understanding]", { hostname, homepageSucceeded: false, pagesSelected: 0, pagesFetched: 0, extractionCharacterCount: fallbackText.length, fallbackUsed: true, fallbackReason });
      return {
        input: { canonicalUrl, hostname, fetchedAt, pages: [], combinedText: fallbackText, userDescription },
        provenance: { version: "website-understanding-v1", canonicalUrl, hostname, fetchedAt, websiteFetchSucceeded: false, pagesFetched: [], pagesSelected: 0, extractionCharacterCount: 0, userDescriptionIncluded: Boolean(userDescription), understandingSource: "description_fallback", fallbackReason },
        diagnostics: { homepageSucceeded: false, selectedPages: 0, fetchedPages: 0, fallbackUsed: true, fallbackReason },
      };
    }

    const selected = this.selector.select(homepage, MAX_SECONDARY_PAGES);
    const pages = [homepage];
    for (const candidate of selected) {
      try {
        const page = this.extractor.extract(await this.fetcher.fetchPage(candidate.url, { allowedHostname: hostname }), candidate.pageType);
        const duplicate = pages.some((existing) => existing.url === page.url || (page.text.length > 0 && existing.text === page.text));
        if (!duplicate && (page.text || page.title || page.metaDescription || page.headings.length)) pages.push(page);
      } catch (error) {
        if (process.env.NODE_ENV !== "production") console.info("[website-understanding] secondary page skipped", { hostname, pageType: candidate.pageType, reason: safeFailureReason(error) });
      }
    }
    const websiteText = pages.map(pageBlock).join("\n\n").slice(0, MAX_COMBINED_TEXT).trim();
    const combinedText = [websiteText, userDescription ? `[Supplemental user description]\n${userDescription}` : ""].filter(Boolean).join("\n\n").slice(0, MAX_COMBINED_TEXT).trim();
    const summaries = pages.map((page) => ({ url: page.url, pageType: page.pageType, title: page.title, metaDescription: page.metaDescription, headings: page.headings.slice(0, 8), ...summarizeWebsitePage(page) }));
    const provenance: WebsiteUnderstandingProvenance = {
      version: "website-understanding-v1",
      canonicalUrl,
      hostname,
      fetchedAt,
      websiteFetchSucceeded: true,
      pagesFetched: summaries,
      pagesSelected: selected.length,
      extractionCharacterCount: websiteText.length,
      userDescriptionIncluded: Boolean(userDescription),
      understandingSource: userDescription ? "website_and_description" : "website_only",
      fallbackReason: null,
    };
    if (process.env.NODE_ENV !== "production") console.info("[website-understanding]", { hostname, homepageSucceeded: true, pagesSelected: selected.length, pagesFetched: pages.length, extractionCharacterCount: websiteText.length, fallbackUsed: false, fallbackReason: null });
    return { input: { canonicalUrl, hostname, fetchedAt, pages, combinedText, userDescription }, provenance, diagnostics: { homepageSucceeded: true, selectedPages: selected.length, fetchedPages: pages.length, fallbackUsed: false, fallbackReason: null } };
  }
}
