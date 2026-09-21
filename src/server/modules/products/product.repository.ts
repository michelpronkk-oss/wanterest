import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types";
import type { ProductRow } from "../../db/database.helpers";
import { AppError } from "../../lib/errors";
import { productConstraintName, productDatabaseError, type ProductProviderError } from "./product-errors";

type Client = SupabaseClient<Database>;

function normalizedHostname(websiteUrl?: string | null): string | null {
  if (!websiteUrl) return null;
  try {
    return new URL(websiteUrl).hostname;
  } catch {
    return null;
  }
}

function safeDatabaseDetails(details?: string | null): string | null {
  if (!details) return null;
  if (/failing row contains/i.test(details)) return "[redacted failing row]";
  return details.slice(0, 500);
}

function logProductDatabaseFailure(input: { workspaceId: string; name: string; slug: string; websiteUrl?: string | null }, error: ProductProviderError): void {
  if (process.env.NODE_ENV === "production") return;
  console.error("[products] create_product failed", {
    workspaceIdPresent: Boolean(input.workspaceId),
    productName: input.name,
    slug: input.slug,
    normalizedHostname: normalizedHostname(input.websiteUrl),
    database: {
      code: error.code ?? null,
      message: error.message ?? null,
      details: safeDatabaseDetails(error.details),
      hint: error.hint ?? null,
      constraint: productConstraintName(error),
    },
  });
}

export async function createProduct(client: Client, input: { workspaceId: string; name: string; slug: string; websiteUrl?: string | null }): Promise<ProductRow> {
  const { data, error } = await client.rpc("create_product", {
    p_workspace_id: input.workspaceId,
    p_name: input.name,
    p_slug: input.slug,
    p_website_url: input.websiteUrl ?? undefined,
  });
  if (error) {
    logProductDatabaseFailure(input, error);
    throw productDatabaseError(error, "Product could not be created.");
  }
  if (!data) {
    const noDataError = { code: "NO_DATA", message: "create_product returned no product row.", details: null, hint: null };
    logProductDatabaseFailure(input, noDataError);
    throw productDatabaseError(noDataError, "Product could not be created.");
  }
  return data;
}

export async function getProduct(client: Client, workspaceId: string, productId: string): Promise<ProductRow> {
  const { data, error } = await client.from("products").select("*").eq("workspace_id", workspaceId).eq("id", productId).maybeSingle();
  if (error) throw productDatabaseError(error, "Product could not be loaded.");
  if (!data) throw new AppError("NOT_FOUND", "Product was not found.");
  return data;
}

export async function listProducts(client: Client, workspaceId: string): Promise<ProductRow[]> {
  const { data, error } = await client.from("products").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: true });
  if (error) throw productDatabaseError(error, "Products could not be loaded.");
  return data ?? [];
}

export async function updateProductMetadata(client: Client, input: { workspaceId: string; productId: string; name?: string; websiteUrl?: string | null }): Promise<ProductRow> {
  const patch = { ...(input.name === undefined ? {} : { name: input.name }), ...(input.websiteUrl === undefined ? {} : { website_url: input.websiteUrl }) };
  const { data, error } = await client.from("products").update(patch).eq("workspace_id", input.workspaceId).eq("id", input.productId).select("*").maybeSingle();
  if (error) throw productDatabaseError(error, "Product could not be updated.");
  if (!data) throw new AppError("NOT_FOUND", "Product was not found.");
  return data;
}

export async function archiveProduct(client: Client, workspaceId: string, productId: string): Promise<ProductRow> {
  const { data, error } = await client.rpc("archive_product", { p_workspace_id: workspaceId, p_product_id: productId });
  if (error || !data) throw productDatabaseError(error ?? { message: "No product returned." }, "Product could not be archived.");
  return data;
}
