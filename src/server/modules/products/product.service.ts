import { cache } from "react";

import { requireUser } from "../auth";
import { AppError } from "../../lib/errors";
import { createSupabaseServerClient } from "../../providers/supabase/server";
import { archiveProduct, createProduct, getProduct, listDashboardProducts, listProducts, updateProductMetadata } from "./product.repository";
export type { ProductContextRow } from "./product.repository";
import { createProductInputSchema, productIdSchema, updateProductMetadataInputSchema, workspaceIdSchema } from "./product.schemas";
import { ensureMonitoringScheduleForProduct } from "../monitoring/monitoring.schedule";
import { disableMonitoringSchedule } from "../monitoring/monitoring.repository";
import { createSupabaseServiceClient } from "../../providers/supabase/service";
import { resolveWorkspaceCapabilities } from "../entitlements/plan-capabilities";

export async function createProductCommand(workspaceId: unknown, input: unknown) {
  const workspace = workspaceIdSchema.safeParse(workspaceId);
  const parsed = createProductInputSchema.safeParse(input);
  if (!workspace.success || !parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid product input.", 422);
  await requireUser();
  const serverClient = await createSupabaseServerClient();
  const capabilities = await resolveWorkspaceCapabilities(createSupabaseServiceClient(), workspace.data);
  const activeProducts = await listProducts(serverClient, workspace.data);
  if (activeProducts.filter((candidate) => candidate.status === "active").length >= capabilities.products.maxProducts) {
    throw new AppError("USAGE_LIMIT_EXCEEDED", "The workspace product limit was reached.");
  }
  const product = await createProduct(serverClient, { workspaceId: workspace.data, name: parsed.data.name, slug: parsed.data.slug, websiteUrl: parsed.data.websiteUrl });
  await ensureMonitoringScheduleForProduct(createSupabaseServiceClient(), workspace.data, product.id);
  return product;
}

export const getProductQuery = cache(async function getProductQuery(workspaceId: unknown, productId: unknown) {
  const workspace = workspaceIdSchema.safeParse(workspaceId);
  const product = productIdSchema.safeParse(productId);
  if (!workspace.success || !product.success) throw new AppError("VALIDATION_ERROR", "Invalid product identifier.");
  await requireUser();
  return getProduct(await createSupabaseServerClient(), workspace.data, product.data);
});

export const listProductsQuery = cache(async function listProductsQuery(workspaceId: unknown) {
  const workspace = workspaceIdSchema.safeParse(workspaceId);
  if (!workspace.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace identifier.");
  await requireUser();
  return listProducts(await createSupabaseServerClient(), workspace.data);
});

export const listDashboardProductsQuery = cache(async function listDashboardProductsQuery(workspaceId: unknown) {
  const workspace = workspaceIdSchema.safeParse(workspaceId);
  if (!workspace.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace identifier.");
  await requireUser();
  return listDashboardProducts(await createSupabaseServerClient(), workspace.data);
});

export async function updateProductMetadataCommand(workspaceId: unknown, productId: unknown, input: unknown) {
  const workspace = workspaceIdSchema.safeParse(workspaceId);
  const product = productIdSchema.safeParse(productId);
  const parsed = updateProductMetadataInputSchema.safeParse(input);
  if (!workspace.success || !product.success || !parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid product update.", 422);
  await requireUser();
  return updateProductMetadata(await createSupabaseServerClient(), { workspaceId: workspace.data, productId: product.data, name: parsed.data.name, websiteUrl: parsed.data.websiteUrl });
}

export async function archiveProductCommand(workspaceId: unknown, productId: unknown) {
  const workspace = workspaceIdSchema.safeParse(workspaceId);
  const product = productIdSchema.safeParse(productId);
  if (!workspace.success || !product.success) throw new AppError("VALIDATION_ERROR", "Invalid product identifier.");
  await requireUser();
  const archived = await archiveProduct(await createSupabaseServerClient(), workspace.data, product.data);
  await disableMonitoringSchedule(createSupabaseServiceClient(), workspace.data, product.data);
  return archived;
}
