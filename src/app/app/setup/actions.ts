"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { captureManualProductSnapshotCommand, generateDemandProfileCommand } from "@/server/modules/intelligence/commands";
import { createProductCommand, getProductQuery } from "@/server/modules/products";
import { createWorkspaceCommand } from "@/server/modules/workspaces";
import { ensureEngineVersion } from "@/server/modules/observability/engine.repository";
import { FixtureDemandProfileEngine } from "@/server/modules/intelligence/engines";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { toPublicError } from "@/server/lib/errors";
import { runInitialScan } from "@/server/modules/onboarding";
import {
  initialScanInputSchema,
  normalizeOnboardingWebsiteUrl,
  onboardingProductInputSchema,
  onboardingWorkspaceInputSchema,
  productUnderstandingInputSchema,
  slugifyOnboardingName,
} from "@/server/modules/onboarding";
import { ACTIVE_PRODUCT_COOKIE } from "@/server/modules/dashboard/dashboard.context";

export type OnboardingActionState = { error: string | null };

const emptyState: OnboardingActionState = { error: null };

function actionError(error: unknown): OnboardingActionState {
  const publicError = toPublicError(error);
  return { error: publicError.code === "INTERNAL_ERROR" ? "We could not complete that step. Please try again." : publicError.message };
}

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
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
  const parsed = onboardingWorkspaceInputSchema.safeParse({ name: formValue(formData, "name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter a workspace name." };
  let workspace;
  try {
    workspace = await createWorkspaceCommand({ name: parsed.data.name, slug: slugifyOnboardingName(parsed.data.name) });
  } catch (error) {
    return actionError(error);
  }
  await setContextCookies(workspace.id);
  redirect("/app/setup/product");
}

async function createProductUnderstanding(product: Awaited<ReturnType<typeof getProductQuery>>, description: string) {
  const snapshot = await captureManualProductSnapshotCommand(product.workspace_id, product.id, description, product.website_url);
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
  return snapshot;
}

export async function createOnboardingProductAction(_previous: OnboardingActionState = emptyState, formData: FormData): Promise<OnboardingActionState> {
  void _previous;
  const parsed = onboardingProductInputSchema.safeParse({
    name: formValue(formData, "name"),
    websiteUrl: formValue(formData, "websiteUrl"),
    description: formValue(formData, "description"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the product details." };
  let websiteUrl: string;
  try {
    websiteUrl = normalizeOnboardingWebsiteUrl(parsed.data.websiteUrl);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Enter a valid public http(s) website URL." };
  }
  let product;
  try {
    product = await createProductCommand(formValue(formData, "workspaceId"), {
      name: parsed.data.name,
      slug: slugifyOnboardingName(parsed.data.name),
      websiteUrl,
    });
    const description = parsed.data.description || `Product: ${parsed.data.name}. Website: ${websiteUrl}`;
    await createProductUnderstanding(product, description);
  } catch (error) {
    return actionError(error);
  }
  await setContextCookies(product.workspace_id, product.id);
  redirect("/app/setup/scan");
}

export async function completeProductUnderstandingAction(_previous: OnboardingActionState = emptyState, formData: FormData): Promise<OnboardingActionState> {
  void _previous;
  const parsed = productUnderstandingInputSchema.safeParse({
    workspaceId: formValue(formData, "workspaceId"),
    productId: formValue(formData, "productId"),
    description: formValue(formData, "description"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Add a short product description." };
  try {
    const product = await getProductQuery(parsed.data.workspaceId, parsed.data.productId);
    await createProductUnderstanding(product, parsed.data.description);
    await setContextCookies(product.workspace_id, product.id);
  } catch (error) {
    return actionError(error);
  }
  redirect("/app/setup/scan");
}

export async function runOnboardingScanAction(_previous: OnboardingActionState = emptyState, formData: FormData): Promise<OnboardingActionState> {
  void _previous;
  const parsed = initialScanInputSchema.safeParse({
    workspaceId: formValue(formData, "workspaceId"),
    productId: formValue(formData, "productId"),
  });
  if (!parsed.success) return { error: "The selected product is invalid." };
  try {
    const product = await getProductQuery(parsed.data.workspaceId, parsed.data.productId);
    await runInitialScan(product);
  } catch (error) {
    return actionError(error);
  }
  redirect("/app/setup/scan");
}
