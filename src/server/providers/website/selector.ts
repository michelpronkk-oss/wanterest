import "server-only";

import { isSamePublicSite } from "./security";
import type { WebsitePageSelector, WebsitePage } from "./contracts";
import type { WebsitePageType } from "./types";

const PRIORITY: Array<{ type: WebsitePageType; terms: string[]; weight: number }> = [
  { type: "product", terms: ["product", "product overview"], weight: 100 },
  { type: "features", terms: ["feature", "capabilities"], weight: 95 },
  { type: "solutions", terms: ["solution", "solutions"], weight: 90 },
  { type: "pricing", terms: ["pricing", "plans", "cost"], weight: 88 },
  { type: "use_cases", terms: ["use case", "use-cases", "use_cases"], weight: 84 },
  { type: "customers", terms: ["customer", "customers", "case stud"], weight: 78 },
  { type: "integrations", terms: ["integration", "integrations"], weight: 74 },
  { type: "platform", terms: ["platform"], weight: 72 },
  { type: "about", terms: ["about", "company"], weight: 60 },
];
const AVOID = /(?:login|log-in|sign[- ]?up|sign[- ]?in|careers?|jobs?|privacy|terms|legal|cookie|changelog|archive|author|feed|rss)/i;

function classify(value: string): { type: WebsitePageType; weight: number } | null {
  const lower = value.toLowerCase();
  const match = PRIORITY.find((candidate) => candidate.terms.some((term) => lower.includes(term)));
  return match ? { type: match.type, weight: match.weight } : null;
}

export class DeterministicWebsitePageSelector implements WebsitePageSelector {
  select(homepage: WebsitePage, maximum: number): Array<{ url: string; pageType: WebsitePageType }> {
    const homepageUrl = new URL(homepage.url);
    const candidates = new Map<string, { url: string; pageType: WebsitePageType; score: number }>();
    for (const link of homepage.links) {
      let target: URL;
      try {
        target = new URL(link.url, homepage.url);
      } catch {
        continue;
      }
      if (!isSamePublicSite(homepageUrl.hostname, target.hostname) || target.hostname === homepageUrl.hostname && target.pathname === homepageUrl.pathname) continue;
      const pathText = `${target.pathname} ${target.search}`;
      const match = classify(`${pathText} ${link.anchorText} ${link.contextText}`);
      if (!match || AVOID.test(`${pathText} ${link.anchorText}`)) continue;
      target.hash = "";
      const url = target.toString();
      const score = match.weight + (target.pathname.split("/").filter(Boolean).length === 1 ? 12 : 0) + (link.anchorText ? 6 : 0);
      const previous = candidates.get(url);
      if (!previous || score > previous.score) candidates.set(url, { url, pageType: match.type, score });
    }
    return [...candidates.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url)).slice(0, Math.max(0, maximum)).map(({ url, pageType }) => ({ url, pageType }));
  }
}
