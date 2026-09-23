import { AppError, toPublicError } from "./errors";

const SAFE_ERROR_DETAIL_KEYS = [
  "capability",
  "current",
  "limit",
  "upgradeTarget",
  "reason",
  "currentPlan",
  "requestedPlan",
  "entitlementCode",
  "retryAfterSeconds",
] as const;

function publicDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const safe = Object.fromEntries(
    SAFE_ERROR_DETAIL_KEYS.flatMap((key) => Object.prototype.hasOwnProperty.call(details, key) ? [[key, details[key]]] : []),
  );
  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function jsonError(error: unknown, traceId: string) {
  const publicError = toPublicError(error);
  const details = publicDetails(publicError.details);
  return Response.json(
    { error: { code: publicError.code, message: publicError.message, ...(details ? { details } : {}) }, traceId },
    { status: publicError.status, headers: { "x-request-id": traceId } },
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON.");
  }
}
