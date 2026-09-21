export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "AUTH_TRANSIENT"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "USAGE_LIMIT_EXCEEDED"
  | "RATE_LIMITED"
  | "CAPABILITY_DISABLED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly status: number = statusForCode(code),
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

function statusForCode(code: AppErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "AUTH_TRANSIENT":
      return 503;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "VALIDATION_ERROR":
      return 422;
    case "USAGE_LIMIT_EXCEEDED":
      return 429;
    case "RATE_LIMITED":
      return 429;
    case "CAPABILITY_DISABLED":
      return 403;
    default:
      return 500;
  }
}

export function toPublicError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError("INTERNAL_ERROR", "An unexpected error occurred.");
}
