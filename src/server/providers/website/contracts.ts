import type { WebsitePageType } from "./types";

export type WebsiteLinkCandidate = {
  url: string;
  href: string;
  anchorText: string;
  contextText: string;
};

export type WebsiteRawPage = {
  url: string;
  status: number;
  contentType: string;
  text: string;
};

export type WebsitePage = {
  url: string;
  pageType: WebsitePageType;
  title: string | null;
  metaDescription: string | null;
  headings: string[];
  text: string;
  links: WebsiteLinkCandidate[];
};

export type WebsitePageSummary = {
  url: string;
  pageType: WebsitePageType;
  title: string | null;
  metaDescription: string | null;
  headings: string[];
  characterCount: number;
  contentHash: string;
};

export type WebsiteUnderstandingInput = {
  canonicalUrl: string;
  hostname: string;
  fetchedAt: string;
  pages: WebsitePage[];
  combinedText: string;
  userDescription: string | null;
};

export type WebsiteUnderstandingProvenance = {
  version: "website-understanding-v1";
  canonicalUrl: string;
  hostname: string;
  fetchedAt: string;
  websiteFetchSucceeded: boolean;
  pagesFetched: WebsitePageSummary[];
  pagesSelected: number;
  extractionCharacterCount: number;
  userDescriptionIncluded: boolean;
  understandingSource: "website_and_description" | "website_only" | "description_fallback";
  fallbackReason: string | null;
};

export type WebsiteFetchFailureKind = "invalid_url" | "dns" | "network" | "timeout" | "redirect" | "http" | "content_type" | "response_too_large" | "empty";

export class WebsiteFetchError extends Error {
  constructor(
    message: string,
    readonly kind: WebsiteFetchFailureKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "WebsiteFetchError";
  }
}

export interface WebsiteFetcher {
  fetchPage(url: string, options?: { allowedHostname?: string }): Promise<WebsiteRawPage>;
}

export interface WebsitePageExtractor {
  extract(raw: WebsiteRawPage, pageType: WebsitePageType): WebsitePage;
}

export interface WebsitePageSelector {
  select(homepage: WebsitePage, maximum: number): Array<{ url: string; pageType: WebsitePageType }>;
}
