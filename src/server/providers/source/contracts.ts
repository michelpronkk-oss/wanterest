import { z } from "zod";

import { jsonObjectSchema, jsonValueSchema, type Json, type JsonObject } from "../../db/database.helpers";

export const sourceKeySchema = z.string().regex(/^[a-z][a-z0-9_-]*$/);
export const timestampSchema = z.string().datetime({ offset: true });

export const sourceDiscoveryRequestSchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  windowStart: timestampSchema.optional(),
  windowEnd: timestampSchema.optional(),
  query: z.string().trim().max(200).optional(),
  expandThreads: z.boolean().default(false),
  requestMetadata: jsonObjectSchema.default({}),
});

export type SourceDiscoveryRequest = z.infer<typeof sourceDiscoveryRequestSchema>;

export const rawSourceItemEnvelopeSchema = z.object({
  sourceKey: sourceKeySchema,
  externalId: z.string().trim().min(1).max(500),
  fetchedAt: timestampSchema,
  payload: jsonValueSchema,
  payloadUri: z.string().url().optional(),
  requestMetadata: jsonObjectSchema.default({}),
  cursorContext: jsonObjectSchema.default({}),
});

export type RawSourceItemEnvelope = {
  sourceKey: string;
  externalId: string;
  fetchedAt: string;
  payload: unknown;
  payloadUri?: string;
  requestMetadata: JsonObject;
  cursorContext: JsonObject;
};

export const sourceItemCandidateSchema = z.object({
  sourceKey: sourceKeySchema,
  externalId: z.string().trim().min(1).max(500),
  externalConversationId: z.string().trim().max(500).optional(),
  canonicalUrl: z.string().url().optional(),
  authorExternalId: z.string().trim().max(500).optional(),
  authorDisplayName: z.string().trim().max(500).optional(),
  authorProfileUrl: z.string().url().optional(),
  title: z.string().max(1000).optional(),
  body: z.string().max(100_000),
  publishedAt: timestampSchema.optional(),
  capturedAt: timestampSchema,
  language: z.string().trim().max(32).optional(),
  metadata: jsonObjectSchema.default({}),
  status: z.enum(["active", "removed", "unavailable"]).default("active"),
});

export type SourceItemCandidate = z.infer<typeof sourceItemCandidateSchema>;

export const rateLimitMetadataSchema = z.object({
  provider: z.string().trim().max(120).optional(),
  mode: z.enum(["public", "authenticated"]).optional(),
  resource: z.string().trim().max(120).optional(),
  remaining: z.number().int().nonnegative().nullable().optional(),
  limit: z.number().int().positive().nullable().optional(),
  retryAfterMs: z.number().int().nonnegative().nullable().optional(),
  resetAt: timestampSchema.nullable().optional(),
});

export type RateLimitMetadata = z.infer<typeof rateLimitMetadataSchema>;

export type SourceDiscoveryPage = {
  items: RawSourceItemEnvelope[];
  nextCursor?: string;
  rateLimit?: RateLimitMetadata;
  estimatedCost?: number;
  providerMetrics?: JsonObject;
  diagnostics: {
    accepted: number;
    rejected: number;
    messages: string[];
    resolutions?: Array<{
      status: "resolved" | "no_match" | "ambiguous_match";
      targetKey: string;
      targetFingerprint: string;
      productId?: string;
      matchedBy?: "domain" | "name" | "slug" | "vendor_product_metadata";
      candidateProductIds: string[];
      resolvedAt: string;
      resolverVersion: string;
    }>;
  };
};

export type SourceHealthResult = {
  sourceKey: string;
  ok: boolean;
  latencyMs: number;
  rateLimit?: RateLimitMetadata;
  degradationState: "healthy" | "degraded" | "blocked";
  errorCode?: string;
  errorSummary?: string;
};

export type SourceAdapter = {
  readonly key: string;
  readonly capabilities: {
    supportsSearch: boolean;
    supportsIncrementalCursor: boolean;
    supportsThreadExpansion: boolean;
  };
  discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage>;
  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate;
  healthCheck(): Promise<SourceHealthResult>;
};

export class SourceAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly providerDetails?: { status?: number; message?: string },
  ) {
    super(message);
    this.name = "SourceAdapterError";
  }
}

export function asJson(value: unknown): Json {
  return jsonValueSchema.parse(value);
}
