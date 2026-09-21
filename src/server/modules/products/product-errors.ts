import { AppError } from "../../lib/errors";

export type ProductProviderError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export function productConstraintName(error: ProductProviderError): string | null {
  const text = [error.details, error.message].filter(Boolean).join(" ");
  return text.match(/constraint\s+["']([^"']+)["']/i)?.[1] ?? null;
}

export function productDatabaseError(error: ProductProviderError, fallback: string): AppError {
  const message = error.message ?? "Unknown database error.";
  if (error.code === "42501" || message.includes("workspace_access_denied")) return new AppError("FORBIDDEN", "You cannot use this workspace.");
  if (error.code === "P0001" && message.includes("products_capability_missing")) return new AppError("CAPABILITY_DISABLED", "Product creation is not available for this workspace.");
  if (error.code === "22003" || message.includes("products_limit_exceeded")) return new AppError("USAGE_LIMIT_EXCEEDED", "The workspace product limit was reached.");
  if (error.code === "23505" || message.includes("product_slug_already_exists")) return new AppError("CONFLICT", "That product slug is already in use.");
  if (error.code === "P0002" || message.includes("product_not_found")) return new AppError("NOT_FOUND", "The product was not found.");
  return new AppError("INTERNAL_ERROR", fallback, 500, {
    providerCode: error.code ?? null,
    providerMessage: message,
    providerDetails: error.details ?? null,
    providerHint: error.hint ?? null,
    providerConstraint: productConstraintName(error),
  });
}
