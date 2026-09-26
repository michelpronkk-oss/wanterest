export const TIMESTAMP_CANONICALIZATION_VERSION = "timestamp_canonicalization_v1" as const;

/**
 * Canonicalizes a timestamp from any storage/provider boundary (Postgres
 * timestamptz via PostgREST, a Date object, or an already-ISO string) into the
 * strict "Z"-suffixed ISO-8601 UTC shape z.string().datetime() requires when
 * used without { offset: true } - the shape schemas across this module rely on.
 * PostgREST serializes timestamptz as e.g. "2026-09-21T16:15:53+00:00", which is
 * valid RFC3339 but fails Zod's stricter default. This preserves the exact
 * instant (offsets are converted, never dropped) and never invents "now": a
 * non-null value that fails to parse becomes null rather than the current time.
 */
export function canonicalTimestamp(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
