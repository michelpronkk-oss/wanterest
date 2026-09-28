import "server-only";

import { requireUser } from "@/server/modules/auth";
import { slugifyOnboardingName } from "@/server/modules/onboarding/onboarding.schemas";
import { AppError } from "@/server/lib/errors";
import { getTraceId } from "@/server/lib/request-context";
import { getProductAccessPolicy } from "./access-mode.service";
import { openSignupInputSchema, type OpenAdmissionResult } from "./open-admission.schemas";
import { createSupabaseOpenAdmissionRepository, type OpenAdmissionRepository } from "./open-admission.repository";
import { readShareCardAttribution } from "@/server/modules/share-cards/share-card-attribution";

export async function provisionOpenSignupCommand(
  input: unknown,
  request?: Request,
  repository?: OpenAdmissionRepository,
): Promise<OpenAdmissionResult> {
  const parsed = openSignupInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid open signup workspace input.", 422, { issues: parsed.error.issues });
  const user = await requireUser();
  const policy = await getProductAccessPolicy();
  if (!policy.publicSignupAllowed) throw new AppError("FORBIDDEN", "Public signup is not available in the current access mode.");
  const shareCardPublicSlug = await readShareCardAttribution();
  return (repository ?? createSupabaseOpenAdmissionRepository()).provision({
    userId: user.id,
    name: parsed.data.name,
    slug: slugifyOnboardingName(parsed.data.name),
    traceId: getTraceId(request),
    shareCardPublicSlug,
  });
}
