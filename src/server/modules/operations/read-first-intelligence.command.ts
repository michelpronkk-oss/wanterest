import "server-only";

import { getProductQuery } from "@/server/modules/products";
import { requestProductDemandScanCommand } from "./product-demand-scan.command";
import { ReadFirstIntelligenceService, type ReadFirstProductIntelligence } from "./read-first-intelligence.service";
import { createSupabaseReadFirstIntelligenceRepository } from "./read-first-intelligence.repository";

export async function readProductIntelligenceCommand(
  workspaceId: unknown,
  productId: unknown,
  options: { enqueueRefresh?: boolean } = {},
): Promise<ReadFirstProductIntelligence> {
  const product = await getProductQuery(workspaceId, productId);
  const service = new ReadFirstIntelligenceService({
    repository: createSupabaseReadFirstIntelligenceRepository(),
    enqueueRefresh: options.enqueueRefresh
      ? async (key) => requestProductDemandScanCommand({ workspaceId: key.workspaceId, productId: key.productId, scanMode: "manual" })
      : undefined,
  });
  return service.read({ workspaceId: product.workspace_id, productId: product.id });
}
