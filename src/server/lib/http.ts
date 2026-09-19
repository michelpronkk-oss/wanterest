import { AppError, toPublicError } from "./errors";

export function jsonError(error: unknown, traceId: string) {
  const publicError = toPublicError(error);
  return Response.json(
    { error: { code: publicError.code, message: publicError.message }, traceId },
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
