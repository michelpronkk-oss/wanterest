import "server-only";

import { cache } from "react";
import { z } from "zod";

import { requireUser } from "@/server/modules/auth";
import { AppError } from "@/server/lib/errors";
import { createSupabaseServerClient } from "@/server/providers/supabase/server";
import { SITE_ORIGIN } from "@/shared/config/site";
import {
  normalizePublicSlug,
  publicCohortTypeSchema,
  publicProfileInputSchema,
  type PrivatePublicProfile,
  type PublicCohortPass,
  type PublicCohortRow,
  type PublicProfileInput,
} from "./cohort-public.schemas";
import { createSupabaseCohortPublicRepository, type CohortPublicRepository } from "./cohort-public.repository";

export type PublicCohortWalls = {
  founding: PublicCohortRow[];
  early: PublicCohortRow[];
};

export class CohortPublicService {
  constructor(private readonly repository: CohortPublicRepository) {}

  async getWalls(): Promise<PublicCohortWalls> {
    const [founding, early] = await Promise.all([
      this.repository.getPublicWall("founding_25"),
      this.repository.getPublicWall("early_100"),
    ]);
    return { founding, early };
  }

  async getPublicPass(slug: string): Promise<PublicCohortPass | null> {
    const normalized = normalizePublicSlug(slug);
    const parsed = publicProfileInputSchema.shape.publicSlug.safeParse(normalized);
    if (!parsed.success) return null;
    const row = await this.repository.getPublicProfile(parsed.data);
    return row ? { ...row, canonicalUrl: `${SITE_ORIGIN}/members/${encodeURIComponent(row.publicSlug)}` } : null;
  }

  async getPrivateProfile(workspaceId: unknown): Promise<PrivatePublicProfile | null> {
    await requireUser();
    const parsed = z.string().uuid().safeParse(workspaceId);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace ID.");
    return this.repository.getPrivateProfile(parsed.data);
  }

  async updatePrivateProfile(workspaceId: unknown, input: unknown, traceId?: string): Promise<PrivatePublicProfile> {
    await requireUser();
    const workspace = z.string().uuid().safeParse(workspaceId);
    if (!workspace.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace ID.");
    const parsed = publicProfileInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid public cohort profile.", 422, { issues: parsed.error.issues });
    return this.repository.upsertProfile(workspace.data, parsed.data, traceId);
  }
}

export function createCohortPublicService(repository?: CohortPublicRepository): CohortPublicService {
  return new CohortPublicService(repository ?? createSupabaseCohortPublicRepository());
}

export const getPublicCohortWallsQuery = cache(async function getPublicCohortWallsQuery(): Promise<PublicCohortWalls> {
  const client = await createSupabaseServerClient();
  return createCohortPublicService(createSupabaseCohortPublicRepository(client)).getWalls();
});

export const getPublicCohortPassQuery = cache(async function getPublicCohortPassQuery(slug: unknown): Promise<PublicCohortPass | null> {
  const parsed = z.string().min(1).max(80).safeParse(slug);
  if (!parsed.success) return null;
  const client = await createSupabaseServerClient();
  return createCohortPublicService(createSupabaseCohortPublicRepository(client)).getPublicPass(parsed.data);
});

export const getWorkspacePublicCohortProfileQuery = cache(async function getWorkspacePublicCohortProfileQuery(workspaceId: unknown) {
  const client = await createSupabaseServerClient();
  return createCohortPublicService(createSupabaseCohortPublicRepository(client)).getPrivateProfile(workspaceId);
});

export async function updateWorkspacePublicCohortProfileCommand(workspaceId: unknown, input: unknown, traceId?: string) {
  const client = await createSupabaseServerClient();
  return createCohortPublicService(createSupabaseCohortPublicRepository(client)).updatePrivateProfile(workspaceId, input, traceId);
}

export { publicCohortTypeSchema };
export type { PrivatePublicProfile, PublicCohortPass, PublicCohortRow, PublicProfileInput };
