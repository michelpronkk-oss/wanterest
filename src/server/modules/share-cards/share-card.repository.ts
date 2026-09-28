import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { SITE_ORIGIN } from "@/shared/config/site";
import {
  publicShareCardSchema,
  shareCardSnapshotSchema,
  shareCardVariantSchema,
  type PublicShareCard,
  type ShareCardPublication,
  type ShareCardSnapshot,
  type ShareCardVariant,
} from "./share-card.schemas";

type RawRecord = Record<string, unknown>;
type ShareCardClient = SupabaseClient;

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function providerError(message: string, error: { code?: string; message?: string } | null): AppError {
  return new AppError("INTERNAL_ERROR", message, 500, error?.message ? { providerMessage: error.message, providerCode: error.code } : undefined);
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value) throw new AppError("INTERNAL_ERROR", message);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function snapshot(raw: unknown): ShareCardSnapshot {
  const value = raw && typeof raw === "object" ? raw as RawRecord : {};
  const parsed = shareCardSnapshotSchema.safeParse({
    displayName: value.displayName,
    headline: value.headline ?? null,
    identityLabel: value.identityLabel,
    identityNumber: value.identityNumber ?? null,
    tone: value.tone,
    isPermanent: value.isPermanent,
  });
  if (!parsed.success) throw new AppError("INTERNAL_ERROR", "The share-card snapshot is invalid.");
  return parsed.data;
}

function publication(raw: RawRecord): ShareCardPublication {
  const variant = shareCardVariantSchema.safeParse(raw.variant);
  if (!variant.success) throw new AppError("INTERNAL_ERROR", "The share-card variant is invalid.");
  return {
    id: requiredString(raw.id, "The share-card publication has no ID."),
    workspaceId: optionalString(raw.workspace_id),
    waitlistApplicationId: optionalString(raw.waitlist_application_id),
    variant: variant.data,
    publicSlug: requiredString(raw.public_slug, "The share-card publication has no public slug."),
    publicationState: raw.publication_state === "revoked" ? "revoked" : "published",
    snapshot: snapshot(raw.snapshot),
    publishedAt: requiredString(raw.published_at, "The share-card publication has no publication timestamp."),
    revokedAt: optionalString(raw.revoked_at),
  };
}

export type ShareCardRepository = {
  listPublications(owner: { workspaceId?: string | null; waitlistApplicationId?: string | null }): Promise<ShareCardPublication[]>;
  publish(input: { workspaceId?: string | null; waitlistApplicationId?: string | null; variant: ShareCardVariant; publicSlug: string; snapshot: ShareCardSnapshot; actorUserId?: string | null }): Promise<ShareCardPublication>;
  revoke(input: { workspaceId?: string | null; waitlistApplicationId?: string | null; variant: ShareCardVariant; actorUserId?: string | null }): Promise<ShareCardPublication | null>;
  getPublic(publicSlug: string): Promise<PublicShareCard | null>;
  recordEvent(input: { publicSlug: string; eventType: string; source?: string | null }): Promise<void>;
};

export function createSupabaseShareCardRepository(client: ShareCardClient = createSupabaseServiceClient() as unknown as ShareCardClient): ShareCardRepository {
  return {
    async listPublications(owner) {
      const { data, error } = await client.rpc("get_share_card_publications", {
        p_workspace_id: owner.workspaceId ?? null,
        p_waitlist_application_id: owner.waitlistApplicationId ?? null,
      });
      if (error) throw providerError("Share-card publications could not be loaded.", error);
      return ((data ?? []) as RawRecord[]).map(publication);
    },

    async publish(input) {
      const { data, error } = await client.rpc("publish_share_card", {
        p_workspace_id: input.workspaceId ?? null,
        p_waitlist_application_id: input.waitlistApplicationId ?? null,
        p_variant: input.variant,
        p_public_slug: input.publicSlug,
        p_snapshot: input.snapshot,
        p_actor_user_id: input.actorUserId ?? null,
      });
      if (error) throw providerError("The share card could not be published.", error);
      const row = first(data as RawRecord | RawRecord[] | null);
      if (!row) throw new AppError("INTERNAL_ERROR", "The share-card publication returned no result.");
      return publication(row);
    },

    async revoke(input) {
      const { data, error } = await client.rpc("revoke_share_card", {
        p_workspace_id: input.workspaceId ?? null,
        p_waitlist_application_id: input.waitlistApplicationId ?? null,
        p_variant: input.variant,
        p_actor_user_id: input.actorUserId ?? null,
      });
      if (error) throw providerError("The share card could not be unpublished.", error);
      const row = first(data as RawRecord | RawRecord[] | null);
      return row ? publication(row) : null;
    },

    async getPublic(publicSlug) {
      const { data, error } = await client.rpc("get_public_share_card", { p_public_slug: publicSlug });
      if (error) throw providerError("The public share card could not be loaded.", error);
      const row = first(data as RawRecord | RawRecord[] | null);
      if (!row) return null;
      const variant = shareCardVariantSchema.safeParse(row.variant);
      const tone = typeof row.tone === "string" ? row.tone : "neutral";
      if (!variant.success) throw new AppError("INTERNAL_ERROR", "The public share-card variant is invalid.");
      const result = {
        publicSlug: requiredString(row.public_slug, "The public share card has no slug."),
        variant: variant.data,
        displayName: optionalString(row.display_name),
        headline: optionalString(row.headline),
        identityLabel: requiredString(row.identity_label, "The public share card has no identity label."),
        identityNumber: optionalNumber(row.identity_number),
        tone,
        isPermanent: row.is_permanent === true,
        publishedAt: requiredString(row.published_at, "The public share card has no publication timestamp."),
        accessMode: row.access_mode,
        ctaLabel: requiredString(row.cta_label, "The public share card has no CTA label."),
        ctaHref: requiredString(row.cta_href, "The public share card has no CTA URL."),
        canonicalUrl: `${SITE_ORIGIN}/share/${encodeURIComponent(requiredString(row.public_slug, "The public share card has no slug."))}`,
        ogTitle: `${requiredString(row.identity_label, "The public share card has no identity label.")}${optionalNumber(row.identity_number) ? ` #${optionalNumber(row.identity_number)}` : ""} · Wanterest`,
        ogDescription: optionalString(row.headline) ?? "A verified Wanterest identity, shared with consent.",
      };
      const parsed = publicShareCardSchema.safeParse(result);
      if (!parsed.success) throw new AppError("INTERNAL_ERROR", "The public share-card projection is invalid.");
      return parsed.data;
    },

    async recordEvent(input) {
      const { error } = await client.rpc("record_share_card_event", {
        p_public_slug: input.publicSlug,
        p_event_type: input.eventType,
        p_source: input.source ?? null,
      });
      if (error) throw providerError("The share-card event could not be recorded.", error);
    },
  };
}
