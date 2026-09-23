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

export function redactMessage(message: string): string {
  return message.replace(/(authorization|bearer|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 500);
}

export function jsonError(error: unknown, traceId: string) {
  const publicError = toPublicError(error);
  if (publicError.status >= 500) {
    // The client only ever receives the safe public message below; without this,
    // a 5xx traceId leads nowhere and the real cause is unrecoverable.
    console.error("[api] request failed", {
      traceId,
      code: publicError.code,
      status: publicError.status,
      name: error instanceof Error ? error.name : typeof error,
      message: redactMessage(error instanceof Error ? error.message : String(error)),
    });
  }
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
