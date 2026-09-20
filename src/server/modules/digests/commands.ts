import type { DigestBuildInput } from "../actions/action.schemas";
import type { DigestService } from "./digest.service";

export function buildDigest(service: DigestService, input: DigestBuildInput) {
  return service.buildDigest(input);
}

export function getDigest(service: DigestService, workspaceId: string, digestId: string) {
  return service.getDigest(workspaceId, digestId);
}

export function listDigests(service: DigestService, workspaceId: string, productId?: string | null) {
  return service.listDigests(workspaceId, productId);
}

