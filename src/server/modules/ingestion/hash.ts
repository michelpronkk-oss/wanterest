import { createHash } from "node:crypto";

import { jsonValueSchema, type Json } from "../../db/database.helpers";

function canonicalize(value: Json): Json {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, item === undefined ? undefined : canonicalize(item)]),
    );
  }
  return value;
}

function omitUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : omitUndefined(item)));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, omitUndefined(item)]),
    );
  }
  return value;
}

export function stableJsonStringify(value: unknown): string {
  const parsed = jsonValueSchema.parse(omitUndefined(value));
  return JSON.stringify(canonicalize(parsed));
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Json(value: unknown): string {
  return sha256Text(stableJsonStringify(value));
}

export function contentHash(input: {
  title?: string;
  body: string;
}): string {
  return sha256Json({
    title: input.title ?? null,
    body: input.body,
  });
}

export function deterministicUuid(seed: string): string {
  const digest = Buffer.from(sha256Text(seed), "hex");
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  return url.toString().replace(/\/$/, "");
}
