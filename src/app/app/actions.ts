"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { productIdSchema, workspaceIdSchema } from "@/server/modules/products/product.schemas";
import { getProductQuery } from "@/server/modules/products";
import { getWorkspaceQuery } from "@/server/modules/workspaces";
import { ACTIVE_PRODUCT_COOKIE } from "@/server/modules/dashboard/dashboard.context";
import { setSignalLifecycleCommand } from "@/server/modules/intelligence/commands";

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
