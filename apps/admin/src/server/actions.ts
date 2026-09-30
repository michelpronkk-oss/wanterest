"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminServiceClient, createAdminSessionClient, getAdminAuthRecoveryRedirectUrl } from "./supabase";
import { assertAdminHostnameRequest } from "./request";
import {
  ADMIN_TOTP_FRIENDLY_NAME,
  findPendingAdminTotp,
  logMfaFailure,
  safeMfaFailureMessage,
  type MfaFailureReason,
} from "./mfa-flow";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export async function signIn(formData: FormData) {
  await assertAdminHostnameRequest();
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/login?error=credentials");

  const session = await createAdminSessionClient();
  if (!session) redirect("/login?error=credentials");
  const { data, error } = await session.auth.signInWithPassword(parsed.data);
  if (error || !data.user) redirect("/login?error=credentials");

  const service = createAdminServiceClient();
  if (!service) {
    await session.auth.signOut();
    redirect("/login?error=credentials");
  }
  const { data: membership, error: membershipError } = await service
    .from("admin_memberships")
    .select("user_id,status")
    .eq("user_id", data.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError || !membership) {
    await session.auth.signOut();
    redirect("/login?error=credentials");
  }

  const { data: assurance, error: assuranceError } = await session.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError || assurance.currentLevel !== "aal2") redirect("/mfa-required");
  redirect("/");
}

export async function signOut() {
  await assertAdminHostnameRequest();
  const session = await createAdminSessionClient();
  if (session) await session.auth.signOut();
  redirect("/login");
}

export async function requestPasswordRecovery(formData: FormData) {
  await assertAdminHostnameRequest();
  const parsed = z.object({ email: z.string().trim().email().max(254) }).safeParse({ email: formData.get("email") });
  if (!parsed.success) redirect("/forgot-password?error=invalid");
  const session = await createAdminSessionClient();
  const redirectTo = getAdminAuthRecoveryRedirectUrl();
  if (!session || !redirectTo) redirect("/forgot-password?error=unavailable");
  await session.auth.resetPasswordForEmail(parsed.data.email, { redirectTo });
  // Keep the response identical whether or not the Auth identity exists.
  redirect("/forgot-password?sent=1");
}

export async function completePasswordRecovery(formData: FormData) {
  await assertAdminHostnameRequest();
  const parsed = z.object({ password: z.string().min(12).max(128), confirmation: z.string().min(12).max(128) }).safeParse({
    password: formData.get("password"), confirmation: formData.get("confirmation"),
  });
  if (!parsed.success || parsed.data.password !== parsed.data.confirmation) redirect("/recover?error=password");
  const session = await createAdminSessionClient();
  if (!session) redirect("/recover?error=unavailable");
  const { data: userData, error: userError } = await session.auth.getUser();
  if (userError || !userData.user) redirect("/recover?error=expired");
  const { error } = await session.auth.updateUser({ password: parsed.data.password });
  if (error) redirect("/recover?error=password");
  await session.auth.signOut();
  redirect("/login?password=updated");
}

async function requireActiveMembership() {
  const session = await createAdminSessionClient();
  if (!session) redirect("/login");
  const { data: userData, error: userError } = await session.auth.getUser();
  if (userError || !userData.user) redirect("/login");
  const service = createAdminServiceClient();
  if (!service) redirect("/login");
  const { data: membership, error } = await service.from("admin_memberships")
    .select("user_id").eq("user_id", userData.user.id).eq("status", "active").maybeSingle();
  if (error || !membership) redirect("/login?error=credentials");
  return session;
}

type EnrollmentFailure = {
  ok: false;
  reason: MfaFailureReason;
  message: string;
};

function enrollmentFailure(reason: MfaFailureReason): EnrollmentFailure {
  return { ok: false, reason, message: safeMfaFailureMessage(reason, "enrollment") };
}

function pendingEnrollmentResult(pending: Array<{ id: string }>) {
  if (pending.length === 1) return { ok: true as const, mode: "resume" as const, factorId: pending[0].id };
  if (pending.length > 1) return enrollmentFailure("multiple_pending");
  return null;
}

export async function startMfaEnrollment() {
  await assertAdminHostnameRequest();
  const session = await requireActiveMembership();

  const { data: listed, error: listError } = await session.auth.mfa.listFactors();
  if (listError || !listed) {
    const reason = logMfaFailure("factor_list", listError);
    return enrollmentFailure(reason);
  }

  const pending = findPendingAdminTotp(listed.totp);
  const existing = pendingEnrollmentResult(pending);
  if (existing) return existing;

  const { data, error } = await session.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: ADMIN_TOTP_FRIENDLY_NAME,
  });
  if (!error && data?.totp?.qr_code && data.id) {
    return { ok: true as const, mode: "setup" as const, qrCode: data.totp.qr_code, factorId: data.id };
  }

  const reason = logMfaFailure("enrollment", error);
  if (reason === "pending_factor") {
    // A parallel request or an earlier attempt may have created it after listFactors().
    const { data: refreshed, error: refreshError } = await session.auth.mfa.listFactors();
    if (refreshError || !refreshed) {
      logMfaFailure("factor_list", refreshError);
      return enrollmentFailure("unavailable");
    }
    const recovered = pendingEnrollmentResult(findPendingAdminTotp(refreshed.totp));
    if (recovered) return recovered;
  }

  return enrollmentFailure(reason);
}

export type MfaVerificationFailure = {
  ok: false;
  reason: MfaFailureReason;
  message: string;
};

function verificationFailure(reason: MfaFailureReason): MfaVerificationFailure {
  return { ok: false, reason, message: safeMfaFailureMessage(reason, "verification") };
}

export async function verifyMfa(formData: FormData): Promise<MfaVerificationFailure> {
  await assertAdminHostnameRequest();
  const parsed = z.object({ factorId: z.string().uuid(), code: z.string().trim().regex(/^\d{6,8}$/) }).safeParse({
    factorId: formData.get("factorId"),
    code: formData.get("code"),
  });
  if (!parsed.success) return verificationFailure("code_rejected");

  const session = await requireActiveMembership();
  const { data: factors, error: factorsError } = await session.auth.mfa.listFactors();
  if (factorsError || !factors) {
    const reason = logMfaFailure("factor_list", factorsError);
    return verificationFailure(reason);
  }

  const factor = factors.totp.find((item) =>
    item.id === parsed.data.factorId &&
    (item.status === "verified" || item.status === "unverified")
  );
  if (!factor) return verificationFailure("factor_missing");

  const { data: challenge, error: challengeError } = await session.auth.mfa.challenge({ factorId: factor.id });
  if (challengeError || !challenge) {
    const reason = logMfaFailure("challenge", challengeError);
    return verificationFailure(reason);
  }

  const { error: verifyError } = await session.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code: parsed.data.code,
  });
  if (verifyError) {
    const reason = logMfaFailure("verification", verifyError);
    return verificationFailure(reason);
  }

  // Supabase SSR persists the elevated AAL2 session through the Server Action's cookie adapter.
  redirect("/");
}
