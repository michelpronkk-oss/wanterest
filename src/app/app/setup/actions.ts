"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { captureWebsiteProductSnapshotCommand, generateDemandProfileCommand } from "@/server/modules/intelligence/commands";
import { listSignalsQuery } from "@/server/modules/intelligence/commands";
import { createProductCommand, getProductQuery, listProductsQuery } from "@/server/modules/products";
import { createWorkspaceCommand, listWorkspacesQuery } from "@/server/modules/workspaces";
import { ensureEngineVersion } from "@/server/modules/observability/engine.repository";
import { FixtureDemandProfileEngine } from "@/server/modules/intelligence/engines";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { AppError, toPublicError } from "@/server/lib/errors";
import { requestProductDemandScanCommand } from "@/server/modules/operations/product-demand-scan.command";
import { initialScanIdempotencyKey } from "@/server/modules/operations/product-demand-scan.identity";
import {
  deriveOnboardingProductName,
  initialScanInputSchema,
  normalizeOnboardingWebsiteUrl,
  onboardingProductInputSchema,
  onboardingWorkspaceInputSchema,
  productUnderstandingInputSchema,
  slugifyOnboardingName,
} from "@/server/modules/onboarding";
import { ACTIVE_PRODUCT_COOKIE } from "@/server/modules/dashboard/dashboard.context";
import { getProductScanState, type ProductScanState } from "@/components/dashboard/scan-state";
import { onboardingSuccessState } from "@/lib/onboarding-transition";
import { findExistingOnboardingProduct, needsOnboardingUnderstanding } from "@/server/modules/onboarding/onboarding-product-flow";

export type OnboardingFieldErrors = Partial<Record<"name" | "websiteUrl" | "description", string>>;
export type OnboardingFormValues = Partial<Record<"name" | "websiteUrl" | "description", string>>;
export type OnboardingActionState = {
  status: "idle" | "error" | "success";
  error: string | null;
  fieldErrors?: OnboardingFieldErrors;
  values?: OnboardingFormValues;
  upgrade?: { capability: string; current?: number; limit?: number; currentPlan?: "free" | "pro" | "growth"; upgradeTarget: "pro" | "growth" };
  productId?: string;
  nextPath?: "/app/setup/scan";
};

const emptyState: OnboardingActionState = { status: "idle", error: null };

function redactDiagnosticText(value: string | null | undefined, maxLength = 600): string | null {
  if (!value) return null;
  return value
    .replace(/(authorization|cookie|password|secret|token|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, maxLength);
}

function diagnosticError(error: unknown): Record<string, unknown> {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const details = record.details && typeof record.details === "object" ? record.details as Record<string, unknown> : {};
  const stack = error instanceof Error ? error.stack?.split("\n").slice(0, 4).join("\n") : null;
  return {
    name: error instanceof Error ? error.name : typeof record.name === "string" ? record.name : null,
    code: typeof record.code === "string" ? record.code : null,
    message: redactDiagnosticText(error instanceof Error ? error.message : typeof record.message === "string" ? record.message : null),
    stackTop: redactDiagnosticText(stack, 1_200),
    supabase: {
      code: typeof record.code === "string" ? record.code : typeof details.code === "string" ? details.code : null,
      details: redactDiagnosticText(typeof record.details === "string" ? record.details : typeof details.providerMessage === "string" ? details.providerMessage : null),
      hint: redactDiagnosticText(typeof record.hint === "string" ? record.hint : typeof details.hint === "string" ? details.hint : null),
    },
  };
}

function actionError(error: unknown, conflictMessage?: string): OnboardingActionState {
  const publicError = toPublicError(error);
  if (process.env.NODE_ENV !== "production") {
    console.error("[onboarding] action failed", { publicCode: publicError.code, publicMessage: publicError.message, error: diagnosticError(error) });
  }
  if (publicError.code === "INTERNAL_ERROR") return { status: "error", error: "We could not complete that step. Please try again." };
  if (publicError.code === "CONFLICT" && conflictMessage) return { status: "error", error: conflictMessage };
  const details = publicError.details;
  const upgradeTarget = details?.upgradeTarget === "pro" || details?.upgradeTarget === "growth" ? details.upgradeTarget : null;
  const upgrade: NonNullable<OnboardingActionState["upgrade"]> | undefined = upgradeTarget && typeof details?.capability === "string"
    ? {
        capability: details.capability,
        current: typeof details.current === "number" ? details.current : undefined,
        limit: typeof details.limit === "number" ? details.limit : undefined,
        currentPlan: details.currentPlan === "pro" || details.currentPlan === "growth" || details.currentPlan === "free" ? details.currentPlan : undefined,
        upgradeTarget,
      }
    : undefined;
  return { status: "error", error: publicError.message, ...(upgrade ? { upgrade } : {}) };
}

function validationError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }, values: OnboardingFormValues): OnboardingActionState {
  const fieldErrors: OnboardingFieldErrors = {};
  let formError: string | null = null;
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === "name" || field === "websiteUrl" || field === "description") {
      fieldErrors[field] ??= issue.message;
    } else {
      formError ??= issue.message;
    }
  }
  return { status: "error", error: formError, fieldErrors, values };
}

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function optionalWebsitePath(rawWebsite: string, pathname: string): string {
  if (!rawWebsite.trim()) return pathname;
  try {
    const websiteUrl = normalizeOnboardingWebsiteUrl(rawWebsite);
    return `${pathname}?website=${encodeURIComponent(websiteUrl)}`;
  } catch {
    return pathname;
  }
}

function setContextCookies(workspaceId: string, productId?: string): Promise<void> {
  return cookies().then((cookieStore) => {
    cookieStore.set("wanterest_active_workspace", workspaceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    if (productId) {
      cookieStore.set(ACTIVE_PRODUCT_COOKIE, productId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
    } else {
      cookieStore.delete(ACTIVE_PRODUCT_COOKIE);
    }
  });
}

export async function createOnboardingWorkspaceAction(_previous: OnboardingActionState = emptyState, formData: FormData): Promise<OnboardingActionState> {
  void _previous;
  const rawName = formValue(formData, "name");
  const rawWebsite = formValue(formData, "websiteUrl");
  const nextProductPath = optionalWebsitePath(rawWebsite, "/app/setup/product");
  const parsed = onboardingWorkspaceInputSchema.safeParse({ name: rawName });
  if (!parsed.success) return validationError(parsed.error, { name: rawName });
  let workspace;
  try {
    workspace = await createWorkspaceCommand({ name: parsed.data.name, slug: slugifyOnboardingName(parsed.data.name) });
  } catch (error) {
    if (toPublicError(error).code === "CONFLICT") {
      let existingWorkspaces;
      try {
        existingWorkspaces = await listWorkspacesQuery();
      } catch {
        return actionError(error);
      }
      const existing = existingWorkspaces.find((candidate) => candidate.slug === slugifyOnboardingName(parsed.data.name));
      if (existing) {
        await setContextCookies(existing.id);
        redirect(nextProductPath);
      }
    }
    return actionError(error);
  }
  await setContextCookies(workspace.id);
  redirect(nextProductPath);
}

async function createProductUnderstanding(product: Awaited<ReturnType<typeof getProductQuery>>, description: string) {
  const understanding = await captureWebsiteProductSnapshotCommand(product.workspace_id, product.id, description, product.website_url ?? "");
  const engine = new FixtureDemandProfileEngine();
  const engineVersion = await ensureEngineVersion(createSupabaseServiceClient(), {
    engine_type: engine.engineType,
    version: engine.version,
    model: "deterministic",
    prompt_version: engine.version,
    config_hash: null,
    metadata: { workflow: "onboarding" },
  });
  await generateDemandProfileCommand(product.workspace_id, product.id, engineVersion.id);
  return understanding.snapshot;
}

async function completeOnboardingProduct(product: Awaited<ReturnType<typeof getProductQuery>>, description: string) {
  if (needsOnboardingUnderstanding(product)) {
    await createProductUnderstanding(product, description);
  }
  const readyProduct = await getProductQuery(product.workspace_id, product.id);
  if (!readyProduct.current_snapshot_id || !readyProduct.current_demand_profile_id) {
    throw new AppError("INTERNAL_ERROR", "Product understanding did not finish persisting.");
  }
  await setContextCookies(readyProduct.workspace_id, readyProduct.id);
  return onboardingSuccessState(readyProduct.id);
}

export async function createOnboardingProductAction(_previous: OnboardingActionState = emptyState, formData: FormData): Promise<OnboardingActionState> {
  void _previous;
  const rawWebsite = formValue(formData, "websiteUrl");
  const rawDescription = formValue(formData, "description");
  let websiteUrl: string;
  try {
    websiteUrl = normalizeOnboardingWebsiteUrl(rawWebsite);
  } catch (error) {
    return { status: "error", error: null, fieldErrors: { websiteUrl: error instanceof Error ? error.message : "Enter your product's public website or domain." }, values: { websiteUrl: rawWebsite, description: rawDescription } };
  }
  const parsed = onboardingProductInputSchema.safeParse({
    name: deriveOnboardingProductName(websiteUrl),
    websiteUrl,
    description: rawDescription,
  });
  if (!parsed.success) return validationError(parsed.error, { websiteUrl: rawWebsite, description: rawDescription });
  const workspaceId = formValue(formData, "workspaceId");
  const slug = slugifyOnboardingName(parsed.data.name);

  let existingProducts;
  try {
    existingProducts = await listProductsQuery(workspaceId);
  } catch (error) {
    return actionError(error);
  }
  const existingProduct = findExistingOnboardingProduct(existingProducts, { slug, websiteUrl });
  if (process.env.NODE_ENV !== "production") {
    console.info("[onboarding] product lookup", {
      workspaceIdPresent: Boolean(workspaceId),
      productName: parsed.data.name,
      slug,
      normalizedHostname: new URL(websiteUrl).hostname,
      productIdAlreadyExists: Boolean(existingProduct),
      duplicateLookupFound: Boolean(existingProduct),
    });
  }
  if (existingProduct) {
    if (existingProduct.status !== "active") return actionError(new AppError("CONFLICT", "This product is archived."), "This product already exists in this workspace.");
    try {
      return await completeOnboardingProduct(existingProduct, parsed.data.description);
    } catch (error) {
      return actionError(error);
    }
  }
  let product;
  try {
    product = await createProductCommand(workspaceId, {
      name: parsed.data.name,
      slug,
      websiteUrl,
    });
  } catch (error) {
    if (toPublicError(error).code === "CONFLICT") {
      try {
        const productsAfterRace = await listProductsQuery(workspaceId);
        const productAfterRace = findExistingOnboardingProduct(productsAfterRace, { slug, websiteUrl });
        if (productAfterRace && productAfterRace.status === "active") return completeOnboardingProduct(productAfterRace, parsed.data.description);
      } catch (resumeError) {
        return actionError(resumeError);
      }
    }
    return actionError(error, "This product already exists in this workspace.");
  }
  try {
    return await completeOnboardingProduct(product, parsed.data.description);
  } catch (error) {
    return actionError(error);
  }
}

export async function completeProductUnderstandingAction(_previous: OnboardingActionState = emptyState, formData: FormData): Promise<OnboardingActionState> {
  void _previous;
  const parsed = productUnderstandingInputSchema.safeParse({
    workspaceId: formValue(formData, "workspaceId"),
    productId: formValue(formData, "productId"),
    description: formValue(formData, "description"),
  });
  if (!parsed.success) return validationError(parsed.error, { description: formValue(formData, "description") });
  let product;
  try {
    product = await getProductQuery(parsed.data.workspaceId, parsed.data.productId);
    return await completeOnboardingProduct(product, parsed.data.description);
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Reuses the same requestProductDemandScanCommand entry point onboarding has always used,
 * without a redirect — used to silently kick off the first scan from the client once the
 * onboarding confirm step mounts, instead of requiring an explicit "Run scan" click.
 * Idempotent: safe to call again on refresh.
 */
const onboardingScanRequestSchema = initialScanInputSchema.extend({
  forceRebuild: z.boolean().optional().default(false),
});

export async function triggerOnboardingScanAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = onboardingScanRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The selected product is invalid." };
  try {
    await requestProductDemandScanCommand({
      workspaceId: parsed.data.workspaceId,
      productId: parsed.data.productId,
      scanMode: "onboarding",
      idempotencyKey: initialScanIdempotencyKey(parsed.data.workspaceId, parsed.data.productId),
      forceRebuild: parsed.data.forceRebuild,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: actionError(error).error ?? "The scan could not be started." };
  }
}

export type OnboardingStatus = {
  scanKind: ProductScanState["kind"];
  scanLabel: string | null;
  errorMessage: string | null;
  highIntentCount: number;
  qualifiedCount: number;
};

const ONBOARDING_HIGH_INTENT_TYPES = new Set(["high_intent", "switching_intent"]);

/** Read-only poll combining the persisted scan state with real qualified-signal counts for the confirm step. No fabricated counts. */
export async function getOnboardingStatusAction(input: unknown): Promise<OnboardingStatus> {
  const parsed = initialScanInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("The selected product is invalid.");
  const signals = await listSignalsQuery(parsed.data.workspaceId, parsed.data.productId, { limit: 200 }).catch(() => []);
  const scanState = await getProductScanState(parsed.data.workspaceId, parsed.data.productId, signals.length > 0);
  return {
    scanKind: scanState.kind,
    scanLabel: scanState.kind === "running" ? scanState.label : null,
    errorMessage: scanState.kind === "failed" ? scanState.message : null,
    highIntentCount: signals.filter((signal) => ONBOARDING_HIGH_INTENT_TYPES.has(signal.intentType)).length,
    qualifiedCount: signals.length,
  };
}
