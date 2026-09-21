import type { ConversationRow, Json, SourceItemRow } from "../../db/database.helpers";
import { sha256Text } from "../ingestion/hash";

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
  "source",
  "campaign",
]);

export type SignalContentIdentity = {
  destinationUrls: string[];
  normalizedText: string;
  textFingerprint: string;
  titleFingerprint: string | null;
  promotionalEditorial: boolean;
  promotionalProbability: number;
};

function record(value: Json | null | undefined): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : {};
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedText(value: string): string {
  return compact(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b(?:www\.)?[a-z0-9-]+\.(?:com|io|co|net|org|ai|dev)(?:\/[^\s]*)?/gi, " ")
    .replace(/#[\p{L}\p{N}_-]+/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDestinationUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const originalProtocol = url.protocol;
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.username = "";
    url.password = "";
    if ((originalProtocol === "https:" && url.port === "443") || (originalProtocol === "http:" && url.port === "80")) url.port = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    const query = [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right));
    url.search = "";
    for (const [key, item] of query) url.searchParams.append(key, item);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function explicitDestinationUrls(sourceItem: SourceItemRow): string[] {
  const metadata = record(sourceItem.metadata);
  const values: string[] = [];
  for (const key of ["externalUrl", "external_url", "destinationUrl", "destination_url", "outboundUrl", "outbound_url"]) {
    if (typeof metadata[key] === "string") values.push(metadata[key] as string);
  }
  for (const key of ["outboundUrls", "outbound_urls"]) {
    if (Array.isArray(metadata[key])) values.push(...metadata[key].filter((item): item is string => typeof item === "string"));
  }
  return [...new Set(values.map(normalizeDestinationUrl).filter((value): value is string => Boolean(value)))];
}

function bodyUrls(body: string): string[] {
  const matches = body.match(/https?:\/\/[^\s<>]+/gi) ?? [];
  return [...new Set(matches.map((value) => normalizeDestinationUrl(value.replace(/[),.;!?]+$/, ""))).filter((value): value is string => Boolean(value)))];
}

function hasAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

export function inspectSignalContent(input: { conversation: ConversationRow; sourceItem: SourceItemRow }): SignalContentIdentity {
  const metadata = record(input.sourceItem.metadata);
  const firstLine = compact((input.sourceItem.body || input.conversation.body).split(/\r?\n/)[0] ?? "");
  const title = compact(input.sourceItem.title ?? input.conversation.title ?? (typeof metadata.externalTitle === "string" ? metadata.externalTitle : firstLine));
  const body = compact(input.sourceItem.body || input.conversation.body);
  const value = `${title} ${body}`.toLowerCase();
  const destinationUrls = [...new Set([...explicitDestinationUrls(input.sourceItem), ...bodyUrls(body)])];
  const externalEmbed = typeof metadata.embedType === "string" && metadata.embedType.toLowerCase().includes("external");
  const articleHeading = firstLine.length >= 12 && firstLine.length <= 150 && hasAny(firstLine, [
    /\bhow does\b/i,
    /\bcomplete guide\b/i,
    /\bwhy .+ (?:switch|move|choose)/i,
    /\bvs\.?\b/i,
    /\bin 20\d{2}\b/i,
  ]);
  const seoMarkers = [
    /\blearn how\b/i,
    /\bcomplete guide\b/i,
    /\bpricing\b/i,
    /\bintegrat(?:ion|ions)\b/i,
    /\bwhy .+ (?:switch|move|choose)/i,
    /\bwork in 20\d{2}\b/i,
    /\bwhat .+ gets right\b/i,
  ].filter((pattern) => pattern.test(value)).length;
  const editorialMarkers = [
    /\btracked how\b/i,
    /\bover \w+ (?:sprints|weeks|months)\b/i,
    /\bhere is what\b/i,
    /\bread the (?:full|complete)\b/i,
    /\bclick here\b/i,
    /\b(?:guide|review|comparison)\b/i,
  ].filter((pattern) => pattern.test(value)).length;
  const firstPersonDemand = hasAny(value, [
    /\b(?:i|we|our team|my team|for our company)\b[^.!?]{0,180}\b(?:need|looking for|switching|replacing|alternative|evaluating|struggling|wish|problem|pain|too expensive|too complex)\b/i,
    /\b(?:need|looking for|switching from|replacing|evaluating)\b[^.!?]{0,160}\b(?:our team|our company|my team|we|i)\b/i,
  ]);
  const socialPromotion = hasAny(value, [
    /(?:👉|🔗|read more|learn more|link in bio)/i,
    /(?:#\w+\s*){2,}/i,
  ]);
  const editorialPromotion = externalEmbed && ((articleHeading && seoMarkers >= 1) || seoMarkers >= 2 || editorialMarkers >= 2);
  const promotionalEditorial = editorialPromotion || (externalEmbed && socialPromotion && !firstPersonDemand);
  const promotionalProbability = promotionalEditorial ? 0.9 : 0;

  return {
    destinationUrls,
    normalizedText: normalizedText(`${title} ${body}`),
    textFingerprint: sha256Text(normalizedText(`${title} ${body}`)),
    titleFingerprint: title ? sha256Text(normalizedText(title)) : null,
    promotionalEditorial,
    promotionalProbability,
  };
}

export function isDuplicateSignalContent(left: SignalContentIdentity, right: SignalContentIdentity): boolean {
  if (left.destinationUrls.some((url) => right.destinationUrls.includes(url))) return true;
  if (!(left.promotionalEditorial || right.promotionalEditorial)) return false;
  if (left.titleFingerprint && left.titleFingerprint === right.titleFingerprint) return true;
  if (left.textFingerprint === right.textFingerprint) return true;
  return tokenSimilarity(left.normalizedText, right.normalizedText) >= 0.86;
}
