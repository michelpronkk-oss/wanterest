import { requireUser } from "../auth";
import { getProductQuery } from "../products";
import { createSupabaseServiceClient } from "../../providers/supabase/service";
import { SupabaseActionRepository } from "../actions/action.repository";
import type { DigestBuildInput } from "../actions/action.schemas";
import { DigestService, type DigestReadModel } from "./digest.service";

export function buildDigest(service: DigestService, input: DigestBuildInput) {
  return service.buildDigest(input);
}

export function getDigest(service: DigestService, workspaceId: string, digestId: string) {
  return service.getDigest(workspaceId, digestId);
}

export function listDigests(service: DigestService, workspaceId: string, productId?: string | null) {
  return service.listDigests(workspaceId, productId);
}

/** Thin read wrapper over DigestService.listDigests — no digest-selection logic here. */
export async function listDigestsQuery(workspaceId: unknown, productId: unknown): Promise<DigestReadModel[]> {
  const product = await getProductQuery(workspaceId, productId);
  await requireUser();
  const service = new DigestService(new SupabaseActionRepository(createSupabaseServiceClient()));
  return service.listDigests(product.workspace_id, product.id);
}

