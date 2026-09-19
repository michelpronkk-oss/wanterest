import { randomUUID } from "node:crypto";

export function getTraceId(request?: Request): string {
  const supplied = request?.headers.get("x-request-id")?.trim();
  return supplied && supplied.length <= 120 ? supplied : randomUUID();
}
