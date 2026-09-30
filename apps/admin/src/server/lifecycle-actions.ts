"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getEmailProvider } from "@/server/providers/email";
import { invitationEmail } from "@/server/modules/waitlist/waitlist-emails";
import { SITE_ORIGIN } from "@/shared/config/site";
import { requireAdminPermission } from "./auth";
import { assertAdminHostnameRequest } from "./request";
import { createAdminServiceClient } from "./supabase";

const inputSchema = z.object({
  applicationId: z.uuid(),
  inviteId: z.union([z.uuid(), z.literal("")]).optional(),
  action: z.enum(["approve", "hold", "reject", "send", "resend", "revoke"]),
  reason: z.string().trim().max(500),
  requestId: z.uuid(),
  confirm: z.literal("yes"),
}).strict();

type RpcOutcome = { ok?: boolean; idempotent?: boolean; action?: string; status?: string; inviteId?: string; expiresAt?: string; recipientEmail?: string; firstName?: string; companyName?: string };

function isRpcOutcome(value: unknown): value is RpcOutcome {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resultPath(applicationId: string, result: string) {
  return `/early-access/${applicationId}?result=${encodeURIComponent(result)}`;
}

export async function applyEarlyAccessAction(formData: FormData): Promise<never> {
  await assertAdminHostnameRequest();
  const context = await requireAdminPermission("lifecycle.write");
  const parsed = inputSchema.safeParse({
    applicationId: formData.get("applicationId"),
    inviteId: formData.get("inviteId"),
    action: formData.get("action"),
    reason: formData.get("reason") ?? "",
    requestId: formData.get("requestId"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) redirect("/early-access?result=invalid");
  if ((parsed.data.action === "hold" || parsed.data.action === "reject" || parsed.data.action === "revoke") && !parsed.data.reason.trim()) {
    redirect(resultPath(parsed.data.applicationId, "reason-required"));
  }

  const client = createAdminServiceClient();
  if (!client) redirect(resultPath(parsed.data.applicationId, "unavailable"));

  if (parsed.data.action === "approve" || parsed.data.action === "hold" || parsed.data.action === "reject") {
    const { data, error } = await client.rpc("admin_transition_waitlist_application", {
      p_application_id: parsed.data.applicationId,
      p_action: parsed.data.action,
      p_actor_user_id: context.userId,
      p_reason: parsed.data.reason || null,
      p_request_id: parsed.data.requestId,
    });
    if (error || !isRpcOutcome(data)) redirect(resultPath(parsed.data.applicationId, "unavailable"));
    if (data.idempotent) redirect(resultPath(parsed.data.applicationId, "already-recorded"));
    if (!data.ok) redirect(resultPath(parsed.data.applicationId, "invalid-transition"));
    revalidatePath("/early-access");
    revalidatePath(`/early-access/${parsed.data.applicationId}`);
    redirect(resultPath(parsed.data.applicationId, "updated"));
  }

  if (parsed.data.action === "revoke") {
    if (!parsed.data.inviteId) redirect(resultPath(parsed.data.applicationId, "invalid"));
    const { error } = await client.rpc("admin_revoke_waitlist_invite", {
      p_invite_id: parsed.data.inviteId,
      p_actor_user_id: context.userId,
      p_reason: parsed.data.reason,
      p_request_id: parsed.data.requestId,
    });
    if (error) redirect(resultPath(parsed.data.applicationId, "invalid-transition"));
    revalidatePath("/early-access");
    revalidatePath(`/early-access/${parsed.data.applicationId}`);
    redirect(resultPath(parsed.data.applicationId, "revoked"));
  }

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const { data, error } = await client.rpc("admin_issue_waitlist_invite", {
    p_application_id: parsed.data.applicationId,
    p_action: parsed.data.action,
    p_actor_user_id: context.userId,
    p_request_id: parsed.data.requestId,
    p_token_hash: tokenHash,
  });
  if (error || !isRpcOutcome(data)) redirect(resultPath(parsed.data.applicationId, "invalid-transition"));
  if (data.idempotent) redirect(resultPath(parsed.data.applicationId, "already-recorded"));
  if (!data.ok || !data.inviteId || !data.expiresAt || !data.recipientEmail) redirect(resultPath(parsed.data.applicationId, "unavailable"));

  const inviteUrl = new URL(`/invite/accept?token=${encodeURIComponent(rawToken)}`, SITE_ORIGIN).toString();
  const delivery = await getEmailProvider().send({
    to: data.recipientEmail,
    ...invitationEmail({
      firstName: typeof data.firstName === "string" ? data.firstName : "there",
      companyName: typeof data.companyName === "string" ? data.companyName : "your workspace",
      inviteUrl,
      expiresAt: data.expiresAt,
    }),
  });
  const deliveryState = delivery.ok ? "sent" : delivery.code === "NOT_CONFIGURED" ? "not_configured" : "provider_failed";
  const { error: auditError } = await client.rpc("admin_record_invite_delivery", {
    p_invite_id: data.inviteId,
    p_actor_user_id: context.userId,
    p_request_id: randomUUID(),
    p_delivery_state: deliveryState,
  });
  revalidatePath("/early-access");
  revalidatePath(`/early-access/${parsed.data.applicationId}`);
  if (auditError) redirect(resultPath(parsed.data.applicationId, "delivery-audit-unavailable"));
  if (!delivery.ok) redirect(resultPath(parsed.data.applicationId, "delivery-failed"));
  redirect(resultPath(parsed.data.applicationId, parsed.data.action === "resend" ? "resent" : "sent"));
}
