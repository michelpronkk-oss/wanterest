import type { DemandActionEngine } from "../../modules/actions/action.engines";
import type { ActionGenerationInput, DigestBuildInput } from "../../modules/actions/action.schemas";
import { DemandActionService } from "../../modules/actions/action.service";
import { DigestService } from "../../modules/digests/digest.service";

export const ACTION_JOB_IDEMPOTENCY = {
  action(input: ActionGenerationInput, engineVersion: string) {
    return `action:${input.productId}:${input.triggerType}:${input.triggerId}:${engineVersion}`;
  },
  digest(input: DigestBuildInput) {
    return `digest:${input.workspaceId}:${input.productId ?? "workspace"}:${input.digestType}:${input.periodStart}:${input.periodEnd}:${input.renderVersion}`;
  },
} as const;

export async function runGenerateActionsJob(service: DemandActionService, input: ActionGenerationInput, engine: DemandActionEngine) {
  return service.generateActions(input, engine);
}

export async function runBuildDigestJob(service: DigestService, input: DigestBuildInput) {
  return service.buildDigest(input);
}

