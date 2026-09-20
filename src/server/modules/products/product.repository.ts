import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types";
import type { ProductRow } from "../../db/database.helpers";
import { AppError } from "../../lib/errors";

type Client = SupabaseClient<Database>;

function productError(error: { code?: string; message: string }, fallback: string): AppError {
  if (error.code === "42501" || error.message.includes("workspace_access_denied")) return new AppError("FORBIDDEN", "You cannot use this workspace.");
  if (error.code === "22003" || error.message.includes("products_limit_exceeded")) return new AppError("USAGE_LIMIT_EXCEEDED", "The workspace product limit was reached.");
  if (error.code === "23505" || error.message.includes("product_slug_already_exists")) return new AppError("CONFLICT", "That product slug is already in use.");
  return new AppError("INTERNAL_ERROR", fallback, 500, { providerMessage: error.message });
}

export async function createProduct(client: Client, input: { workspaceId: string; name: string; slug: string; websiteUrl?: string | null }): Promise<ProductRow> {
  const { data, error } = await client.rpc("create_product", {
    p_workspace_id: input.workspaceId,
    p_name: input.name,
    p_slug: input.slug,
    p_website_url: input.websiteUrl ?? undefined,
  });
  if (error || !data) throw productError(error ?? { message: "No product returned." }, "Product could not be created.");
  return data;
}

export async function getProduct(client: Client, workspaceId: string, productId: string): Promise<ProductRow> {
  const { data, error } = await client.from("products").select("*").eq("workspace_id", workspaceId).eq("id", productId).maybeSingle();
  if (error) throw productError(error, "Product could not be loaded.");
  if (!data) throw new AppError("NOT_FOUND", "Product was not found.");
  return data;
}

export async function listProducts(client: Client, workspaceId: string): Promise<ProductRow[]> {
  const { data, error } = await client.from("products").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: true });
  if (error) throw productError(error, "Products could not be loaded.");
  return data ?? [];
}

export async function updateProductMetadata(client: Client, input: { workspaceId: string; productId: string; name?: string; websiteUrl?: string | null }): Promise<ProductRow> {
  const patch = { ...(input.name === undefined ? {} : { name: input.name }), ...(input.websiteUrl === undefined ? {} : { website_url: input.websiteUrl }) };
  const { data, error } = await client.from("products").update(patch).eq("workspace_id", input.workspaceId).eq("id", input.productId).select("*").maybeSingle();
  if (error) throw productError(error, "Product could not be updated.");
  if (!data) throw new AppError("NOT_FOUND", "Product was not found.");
  return data;
}

export async function archiveProduct(client: Client, workspaceId: string, productId: string): Promise<ProductRow> {
  const { data, error } = await client.rpc("archive_product", { p_workspace_id: workspaceId, p_product_id: productId });
  if (error || !data) throw productError(error ?? { message: "No product returned." }, "Product could not be archived.");
  return data;
}
