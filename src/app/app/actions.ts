"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { productIdSchema, workspaceIdSchema } from "@/server/modules/products/product.schemas";
import { archiveProductCommand, getProductQuery, listProductsQuery } from "@/server/modules/products";
import { getWorkspaceQuery } from "@/server/modules/workspaces";
import { ACTIVE_PRODUCT_COOKIE } from "@/server/modules/dashboard/dashboard.context";
import { setSignalLifecycleCommand } from "@/server/modules/intelligence/commands";
import { transitionActionCommand } from "@/server/modules/actions/commands";
import { requestProductDemandScanCommand } from "@/server/modules/operations/product-demand-scan.command";
import { getInitialScanState } from "@/server/modules/onboarding";
import { scanResultSummarySchema, type ScanResultSummary } from "@/server/modules/operations/product-demand-scan.schemas";
import type { ProductDemandScanHandle, ScanProgress } from "@/server/modules/operations/product-demand-scan.schemas";
import { toPublicError } from "@/server/lib/errors";
import { redactMessage } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";
import { nextActiveProductId } from "@/server/modules/products/product-lifecycle";

const returnToSchema = z.string().trim().max(400).refine(
  (value) => value.startsWith("/app") && !value.startsWith("//"),
  "The return path must remain inside the app.",
);

const contextSwitchSchema = z.object({
  workspaceId: workspaceIdSchema,
  returnTo: returnToSchema,
});

export async function switchWorkspaceAction(input: unknown): Promise<never> {
  const parsed = contextSwitchSchema.safeParse(input);
  if (!parsed.success) throw new Error("The workspace selection is invalid.");

  const workspace = await getWorkspaceQuery(parsed.data.workspaceId);
  const cookieStore = await cookies();
  cookieStore.set("wanterest_active_workspace", workspace.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  cookieStore.delete(ACTIVE_PRODUCT_COOKIE);
  redirect(parsed.data.returnTo);
}

const productSwitchSchema = contextSwitchSchema.extend({
  productId: productIdSchema,
});

export async function switchProductAction(input: unknown): Promise<never> {
  const parsed = productSwitchSchema.safeParse(input);
  if (!parsed.success) throw new Error("The product selection is invalid.");

  const product = await getProductQuery(parsed.data.workspaceId, parsed.data.productId);
  const cookieStore = await cookies();
  cookieStore.set("wanterest_active_workspace", product.workspace_id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  cookieStore.set(ACTIVE_PRODUCT_COOKIE, product.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect(parsed.data.returnTo);
}

const productLifecycleSchema = z.object({
  workspaceId: workspaceIdSchema,
  productId: productIdSchema,
});

export type ProductLifecycleActionResult =
  | { ok: true; nextPath: "/app/settings?tab=product" | "/app/setup/product?new=1" }
  | { ok: false; error: string };

function productLifecycleError(error: unknown): ProductLifecycleActionResult {
  return { ok: false, error: toPublicError(error).message };
}

function productCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export async function archiveProductAction(input: unknown): Promise<ProductLifecycleActionResult> {
  const parsed = productLifecycleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The product selection is invalid." };

  const cookieStore = await cookies();
  const selectedProductId = cookieStore.get(ACTIVE_PRODUCT_COOKIE)?.value;
  try {
    await archiveProductCommand(parsed.data.workspaceId, parsed.data.productId);
  } catch (error) {
    return productLifecycleError(error);
  }

  let products;
  try {
    products = await listProductsQuery(parsed.data.workspaceId);
  } catch (error) {
    if (selectedProductId === parsed.data.productId) cookieStore.delete(ACTIVE_PRODUCT_COOKIE);
    return productLifecycleError(error);
  }

  const activeProducts = products.filter((product) => product.status === "active");
  const nextProductId = nextActiveProductId(selectedProductId ?? null, parsed.data.productId, activeProducts.map((product) => product.id));
  if (nextProductId !== selectedProductId) {
    if (nextProductId) cookieStore.set(ACTIVE_PRODUCT_COOKIE, nextProductId, productCookieOptions());
    else cookieStore.delete(ACTIVE_PRODUCT_COOKIE);
  }

  return { ok: true, nextPath: activeProducts.length > 0 ? "/app/settings?tab=product" : "/app/setup/product?new=1" };
}

const lifecycleActionSchema = z.object({
  workspaceId: workspaceIdSchema,
  signalId: z.string().uuid(),
  lifecycleStatus: z.enum(["active", "saved", "dismissed", "archived"]),
});

export async function updateSignalLifecycleAction(input: unknown): Promise<{ ok: true }> {
  const parsed = lifecycleActionSchema.safeParse(input);
  if (!parsed.success) throw new Error("The signal update is invalid.");
  await setSignalLifecycleCommand(
    parsed.data.workspaceId,
    parsed.data.signalId,
    parsed.data.lifecycleStatus,
  );
  return { ok: true };
}

const rescanActionSchema = z.object({
  workspaceId: workspaceIdSchema,
  productId: productIdSchema,
});

export type RescanUpgradeDetails = {
  capability: string;
  current?: number;
  limit?: number;
  upgradeTarget: "pro" | "growth";
};

export type RescanActionResult =
  | { ok: true; handle: ProductDemandScanHandle }
  | { ok: false; error: string; upgrade?: RescanUpgradeDetails; traceId?: string };

/** Triggers the same product-demand-scan orchestration used for onboarding, tagged as a manual rescan. */
export async function triggerRescanAction(input: unknown): Promise<RescanActionResult> {
  const parsed = rescanActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The rescan request is invalid." };
  try {
    const handle = await requestProductDemandScanCommand({
      workspaceId: parsed.data.workspaceId,
      productId: parsed.data.productId,
      scanMode: "manual",
    });
    return { ok: true, handle };
  } catch (error) {
    const publicError = toPublicError(error);
    const details = publicError.details;
    const upgradeTarget = details?.upgradeTarget === "pro" || details?.upgradeTarget === "growth" ? details.upgradeTarget : null;
    const upgrade: RescanUpgradeDetails | undefined = upgradeTarget && typeof details?.capability === "string"
      ? { capability: details.capability, current: typeof details.current === "number" ? details.current : undefined, limit: typeof details.limit === "number" ? details.limit : undefined, upgradeTarget }
      : undefined;
    // Server actions have no HTTP response to attach a request id to, so unlike
    // route handlers (see jsonError) a 5xx here would otherwise vanish with no
    // way to correlate the client's generic message back to a server log line.
    let traceId: string | undefined;
    if (publicError.status >= 500) {
      traceId = getTraceId();
      console.error("[action] triggerRescanAction failed", {
        traceId,
        code: publicError.code,
        status: publicError.status,
        workspaceId: parsed.data.workspaceId,
        productId: parsed.data.productId,
        name: error instanceof Error ? error.name : typeof error,
        message: redactMessage(error instanceof Error ? error.message : String(error)),
      });
    }
    return { ok: false, error: publicError.message, ...(upgrade ? { upgrade } : {}), ...(traceId ? { traceId } : {}) };
  }
}

const scanProgressActionSchema = z.object({
  workspaceId: workspaceIdSchema,
  productId: productIdSchema,
  jobRunId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1).max(240),
});

export type ScanProgressState = {
  status: string;
  progress: ScanProgress | null;
  errorMessage: string | null;
  result: ScanResultSummary | null;
};

/** Read-only poll of the same scan job state the onboarding scan page reads, scoped to a caller-supplied idempotency key. */
export async function getScanProgressAction(input: unknown): Promise<ScanProgressState | null> {
  const parsed = scanProgressActionSchema.safeParse(input);
  if (!parsed.success) throw new Error("The scan status request is invalid.");
  // job_runs is intentionally service-role-only. Validate the caller and the
  // workspace/product relationship through the normal RLS-backed query before
  // reading the narrow persisted status snapshot.
  await getProductQuery(parsed.data.workspaceId, parsed.data.productId);
  const state = await getInitialScanState(parsed.data.workspaceId, parsed.data.productId, parsed.data.idempotencyKey);
  if (!state) return null;
  if (state.jobRunId !== parsed.data.jobRunId) throw new Error("The scan status identity does not match the requested job.");
  const result = state.result ? scanResultSummarySchema.safeParse(state.result) : null;
  return { status: state.status, progress: state.progress, errorMessage: state.errorMessage, result: result?.success ? result.data : null };
}

const actionStatusActionSchema = z.object({
  workspaceId: workspaceIdSchema,
  actionId: z.string().uuid(),
  toStatus: z.enum(["approved", "dismissed"]),
});

export async function updateActionStatusAction(input: unknown): Promise<{ ok: true }> {
  const parsed = actionStatusActionSchema.safeParse(input);
  if (!parsed.success) throw new Error("The action update is invalid.");
  await transitionActionCommand(parsed.data.workspaceId, parsed.data.actionId, parsed.data.toStatus);
  return { ok: true };
}
