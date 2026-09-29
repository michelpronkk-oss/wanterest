import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";
import { withCohortRpcContracts, type PublicCohortRpcRow, type PrivateCohortProfileRpcRow } from "@/server/db/cohort-contracts";

import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import {
  privatePublicProfileSchema,
  publicCohortRowSchema,
  publicCohortTypeSchema,
  type PrivatePublicProfile,
  type PublicCohortRow,
  type PublicCohortType,
  type PublicProfileInput,
} from "./cohort-public.schemas";

type RpcError = { code?: string; message?: string } | null;
type Client = SupabaseClient<Database>;

function firstRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] ?? null : data;
}

function mapDatabaseError(error: RpcError, fallback: string): AppError {
  if (error?.code === "42501" || error?.message?.includes("access_denied")) return new AppError("FORBIDDEN", "You are not authorized to manage this public profile.");
  if (error?.code === "P0002" || error?.message?.includes("not_found")) return new AppError("NOT_FOUND", "The workspace cohort profile was not found.");
  if (error?.code === "23505" || error?.message?.includes("slug_conflict")) return new AppError("CONFLICT", "That public slug is already in use.");
  if (error?.code === "22023" || error?.message?.includes("slug_invalid") || error?.message?.includes("url_invalid")) return new AppError("VALIDATION_ERROR", "The public profile is not valid.", 422);
  return new AppError("INTERNAL_ERROR", fallback, 500, error?.message ? { providerMessage: error.message } : undefined);
}

function publicRow(raw: PublicCohortRpcRow): PublicCohortRow {
  const parsed = publicCohortRowSchema.safeParse({
    publicSlug: raw.public_slug,
    displayName: raw.display_name,
    logoUrl: raw.logo_url,
    avatarUrl: raw.avatar_url,
    monogram: raw.monogram,
    headline: raw.headline,
    websiteUrl: raw.website_url,
    cohort: raw.cohort,
    number: raw.cohort_number,
    limit: raw.cohort_limit,
    assignedAt: raw.assigned_at,
  });
  if (!parsed.success) throw new AppError("INTERNAL_ERROR", "The public cohort projection is invalid.");
  return parsed.data;
}

function privateRow(raw: PrivateCohortProfileRpcRow): PrivatePublicProfile {
  const parsed = privatePublicProfileSchema.safeParse({
    ...publicRow(raw),
    profileId: raw.profile_id,
    workspaceId: raw.workspace_id,
    wallVisible: raw.wall_visible,
    passVisible: raw.pass_visible,
  });
  if (!parsed.success) throw new AppError("INTERNAL_ERROR", "The private public profile projection is invalid.");
  return parsed.data;
}

export type CohortPublicRepository = {
  getPublicWall(cohort: PublicCohortType): Promise<PublicCohortRow[]>;
  getPublicProfile(slug: string): Promise<PublicCohortRow | null>;
  getPrivateProfile(workspaceId: string): Promise<PrivatePublicProfile | null>;
  upsertProfile(workspaceId: string, input: PublicProfileInput, traceId?: string): Promise<PrivatePublicProfile>;
  initializeProfile(workspaceId: string, publicSlug: string, traceId?: string): Promise<PrivatePublicProfile>;
};

export function createSupabaseCohortPublicRepository(baseClient: Client = createSupabaseServiceClient()): CohortPublicRepository {
  const client = withCohortRpcContracts(baseClient);
  return {
    async getPublicWall(cohort) {
      const { data, error } = await client.rpc("get_public_cohort_wall", { p_cohort: cohort });
      if (error) throw mapDatabaseError(error, "The public cohort wall could not be loaded.");
      return (data ?? []).map(publicRow);
    },

    async getPublicProfile(slug) {
      const { data, error } = await client.rpc("get_public_cohort_profile", { p_public_slug: slug });
      if (error) throw mapDatabaseError(error, "The public cohort pass could not be loaded.");
      const row = firstRow(data);
      return row ? publicRow(row) : null;
    },

    async getPrivateProfile(workspaceId) {
      const { data, error } = await client.rpc("get_workspace_public_cohort_profile", { p_workspace_id: workspaceId });
      if (error) throw mapDatabaseError(error, "The public profile settings could not be loaded.");
      const row = firstRow(data);
      return row ? privateRow(row) : null;
    },

    async upsertProfile(workspaceId, input, traceId) {
      const { data, error } = await client.rpc("upsert_workspace_public_cohort_profile", {
        p_workspace_id: workspaceId,
        p_public_slug: input.publicSlug,
        p_display_name: input.displayName,
        p_logo_url: input.logoUrl,
        p_avatar_url: input.avatarUrl,
        p_monogram: input.monogram,
        p_headline: input.headline,
        p_website_url: input.websiteUrl,
        p_wall_visible: input.wallVisible,
        p_pass_visible: input.passVisible,
        p_trace_id: traceId ?? null,
      });
      if (error) throw mapDatabaseError(error, "The public profile could not be saved.");
      const row = firstRow(data);
      if (!row) throw new AppError("INTERNAL_ERROR", "The public profile save returned no result.");
      return privateRow(row);
    },

    async initializeProfile(workspaceId, publicSlug, traceId) {
      const { data, error } = await client.rpc("initialize_workspace_public_cohort_profile", {
        p_workspace_id: workspaceId,
        p_public_slug: publicSlug,
        p_trace_id: traceId ?? null,
      });
      if (error) throw mapDatabaseError(error, "The public profile could not be initialized.");
      const row = firstRow(data);
      if (!row) throw new AppError("INTERNAL_ERROR", "The public profile initialization returned no result.");
      return privateRow(row);
    },
  };
}

export { publicCohortTypeSchema };
