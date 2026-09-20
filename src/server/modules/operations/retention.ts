import { createHash } from "node:crypto";

export type RetentionClass = "raw" | "canonical" | "derived" | "logs" | "billing" | "experiment_events";
export const retentionPolicy: Record<RetentionClass, { retention: string; deletion: "never_automatic" | "bounded_delete_after_policy"; redaction: string }> = {
  raw: { retention: "180 days minimum; preserve immutable replay inputs", deletion: "bounded_delete_after_policy", redaction: "remove authorization and provider secrets before persistence" },
  canonical: { retention: "workspace policy; preserve source identity and provenance", deletion: "bounded_delete_after_policy", redaction: "provider payloads are not copied into canonical text" },
  derived: { retention: "workspace policy; preserve engine/version lineage", deletion: "bounded_delete_after_policy", redaction: "redact sensitive excerpts at ingestion boundary" },
  logs: { retention: "30 days default", deletion: "bounded_delete_after_policy", redaction: "structured fields only; no tokens or payment data" },
  billing: { retention: "provider/legal policy", deletion: "never_automatic", redaction: "payment instruments and webhook secrets are never persisted" },
  experiment_events: { retention: "workspace policy; preserve aggregate reproducibility", deletion: "bounded_delete_after_policy", redaction: "subject keys are hashed and arbitrary metadata is rejected" },
};

const secretKey = /(authorization|cookie|set-cookie|api[_-]?key|secret|token|password|client_secret|webhook[-_]?signature|dodo|reddit)/i;
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? "[redacted]" : redactSecrets(item)]));
  if (typeof value === "string") return value.replace(/(Bearer\s+|token\s*[=:]\s*|secret\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]").slice(0, 4_000);
  return value;
}
export function redactError(error: unknown) { return redactSecrets({ name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : "Unexpected error" }); }
export function subjectKeyDigest(experimentId: string, subjectKey: string) { return createHash("sha256").update(`${experimentId}:${subjectKey}`).digest("hex"); }
