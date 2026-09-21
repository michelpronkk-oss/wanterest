import type { JobRunRow } from "@/server/db/database.helpers";

import type { ProductDemandScanInput } from "./product-demand-scan.schemas";

export function isTrustedProductDemandScanJob(input: ProductDemandScanInput, job: JobRunRow): boolean {
  const reference = job.input_reference && typeof job.input_reference === "object" && !Array.isArray(job.input_reference)
    ? job.input_reference
    : null;
  const requestedByUserId = reference && "requestedByUserId" in reference && typeof reference.requestedByUserId === "string"
    ? reference.requestedByUserId
    : null;
  return job.job_type === "discover-source"
    && job.workspace_id === input.workspaceId
    && job.product_id === input.productId
    && job.idempotency_key === input.idempotencyKey
    && requestedByUserId === input.requestedByUserId;
}
