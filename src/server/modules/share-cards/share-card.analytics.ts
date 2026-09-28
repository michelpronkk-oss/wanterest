const KNOWN_SHARE_CRAWLER = /(bot|crawler|spider|slackbot|twitterbot|linkedinbot|facebookexternalhit|bingpreview|discordbot|whatsapp|skypeuripreview|pinterest|telegrambot)/i;

/** Social preview fetches are distribution infrastructure, not human engagement. */
export function isKnownShareCrawler(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && KNOWN_SHARE_CRAWLER.test(userAgent);
}
