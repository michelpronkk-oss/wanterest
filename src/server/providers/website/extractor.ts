import "server-only";

import { createHash } from "node:crypto";
import type { WebsitePageExtractor, WebsitePage, WebsiteRawPage, WebsiteLinkCandidate } from "./contracts";
import type { WebsitePageType } from "./types";

const MAX_PAGE_TEXT = 18_000;
const MAX_HEADINGS = 16;
const BLOCKED_TAGS = /<(?:script|style|noscript|svg|template|nav|footer|form|iframe|canvas)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg|template|nav|footer|form|iframe|canvas)>/gi;

function decodeEntities(value: string): string {
  return value
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
      const parsed = code.toLowerCase().startsWith("x") ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(Math.min(parsed, 0x10ffff)) : " ";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function textContent(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, " ")).replace(/[ \t\f\v]+/g, " ").replace(/\n\s+/g, "\n").trim();
}

function uniqueLines(value: string, maximum: number): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of value.split(/\n+/).map((item) => item.trim()).filter((item) => item.length >= 2)) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.join(" ").length >= maximum) break;
  }
  return lines.join(" ").slice(0, maximum).trim();
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  return match?.[1] ? decodeEntities(match[1]).trim() : null;
}

function extractMetaDescription(html: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = attribute(tag, "name")?.toLowerCase() ?? attribute(tag, "property")?.toLowerCase();
    if (name === "description" || name === "og:description") return attribute(tag, "content")?.slice(0, 1_000) ?? null;
  }
  return null;
}

function extractLinks(html: string, pageUrl: string): WebsiteLinkCandidate[] {
  const links: WebsiteLinkCandidate[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attribute(match[1], "href");
    if (!href || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      const url = new URL(href, pageUrl);
      if (!/^https?:$/.test(url.protocol)) continue;
      url.hash = "";
      const anchorText = textContent(match[2]).slice(0, 300);
      links.push({ url: url.toString(), href, anchorText, contextText: anchorText });
    } catch {
      continue;
    }
  }
  return links;
}

export class HtmlWebsitePageExtractor implements WebsitePageExtractor {
  extract(raw: WebsiteRawPage, pageType: WebsitePageType): WebsitePage {
    const html = raw.text.replace(/<!--[\s\S]*?-->/g, " ");
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ? textContent(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").slice(0, 500) : null;
    const metaDescription = extractMetaDescription(html);
    const headings = [...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((match) => textContent(match[1])).filter(Boolean).slice(0, MAX_HEADINGS);
    const body = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
    const cleaned = body.replace(BLOCKED_TAGS, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:h[1-3]|p|li|section|article)\s*>/gi, "\n");
    const text = uniqueLines(textContent(cleaned), MAX_PAGE_TEXT);
    return { url: raw.url, pageType, title, metaDescription, headings: [...new Set(headings)], text, links: extractLinks(html, raw.url) };
  }
}

export function summarizeWebsitePage(page: WebsitePage): { characterCount: number; contentHash: string } {
  return { characterCount: page.text.length, contentHash: createHash("sha256").update(page.text, "utf8").digest("hex") };
}
