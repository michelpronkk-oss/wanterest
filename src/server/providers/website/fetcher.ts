import "server-only";

import { assertPublicHostname, isSamePublicSite, parsePublicWebsiteUrl, type DnsLookup } from "./security";
import { WebsiteFetchError, type WebsiteFetcher, type WebsiteRawPage } from "./contracts";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const USER_AGENT = "WanterestWebsiteUnderstanding/1.0 (+https://wanterest.com)";
const DEFAULT_TIMEOUT_MS = 9_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 512_000;
const ACCEPTED_CONTENT_TYPES = new Set(["text/html", "text/plain", "application/xhtml+xml"]);

export type SafeWebsiteFetcherOptions = {
  fetchImpl?: FetchLike;
  lookupImpl?: DnsLookup;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

async function readBoundedBody(response: Response, maximum: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > maximum) throw new WebsiteFetchError("Website response is too large.", "response_too_large");
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximum) throw new WebsiteFetchError("Website response is too large.", "response_too_large");
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new WebsiteFetchError("Website response is too large.", "response_too_large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export class SafeWebsiteFetcher implements WebsiteFetcher {
  private readonly fetchImpl: FetchLike;
  private readonly lookupImpl?: DnsLookup;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: SafeWebsiteFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.lookupImpl = options.lookupImpl;
    this.timeoutMs = Math.min(10_000, Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    this.maxResponseBytes = Math.min(1_000_000, Math.max(32_000, options.maxResponseBytes ?? MAX_RESPONSE_BYTES));
  }

  async fetchPage(input: string, options: { allowedHostname?: string } = {}): Promise<WebsiteRawPage> {
    let current = parsePublicWebsiteUrl(input);
    const initialHostname = options.allowedHostname ?? current.hostname;
    if (!isSamePublicSite(initialHostname, current.hostname)) throw new WebsiteFetchError("Website redirect left the public site.", "redirect");
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      await assertPublicHostname(current.hostname, this.lookupImpl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(current, {
          method: "GET",
          headers: { Accept: "text/html,text/plain;q=0.9", "User-Agent": USER_AGENT },
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof WebsiteFetchError) throw error;
        throw new WebsiteFetchError(error instanceof Error && error.name === "AbortError" ? "Website request timed out." : "Website request could not be completed.", error instanceof Error && error.name === "AbortError" ? "timeout" : "network");
      } finally {
        clearTimeout(timeout);
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount === MAX_REDIRECTS) throw new WebsiteFetchError("Website redirect could not be followed safely.", "redirect", response.status);
        let redirected: URL;
        try {
          redirected = parsePublicWebsiteUrl(new URL(location, current).toString());
        } catch {
          throw new WebsiteFetchError("Website redirect target is not public.", "redirect", response.status);
        }
        if (!isSamePublicSite(initialHostname, redirected.hostname)) throw new WebsiteFetchError("Website redirect left the public site.", "redirect", response.status);
        current = redirected;
        continue;
      }
      if (!response.ok) throw new WebsiteFetchError(`Website returned HTTP ${response.status}.`, "http", response.status);
      const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
      if (!ACCEPTED_CONTENT_TYPES.has(contentType)) throw new WebsiteFetchError("Website response is not readable text.", "content_type", response.status);
      const text = await readBoundedBody(response, this.maxResponseBytes);
      if (!text.trim()) throw new WebsiteFetchError("Website response was empty.", "empty", response.status);
      return { url: current.toString(), status: response.status, contentType, text };
    }
    throw new WebsiteFetchError("Website redirect could not be followed safely.", "redirect");
  }
}
