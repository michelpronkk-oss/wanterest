"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminServiceClient, createAdminSessionClient, getAdminAuthRecoveryRedirectUrl } from "./supabase";
import { assertAdminHostnameRequest } from "./request";

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

export async function startMfaEnrollment() {
  await assertAdminHostnameRequest();
  const session = await requireActiveMembership();
  const { data, error } = await session.auth.mfa.enroll({ factorType: "totp", friendlyName: "Wanterest Admin" });
  if (error || !data) return { ok: false as const, qrCode: null, factorId: null };
  return { ok: true as const, qrCode: data.totp.qr_code, factorId: data.id };
}

export async function verifyMfa(formData: FormData) {
  await assertAdminHostnameRequest();
  const parsed = z.object({ factorId: z.string().uuid(), code: z.string().trim().regex(/^\d{6,8}$/) }).safeParse({
    factorId: formData.get("factorId"),
    code: formData.get("code"),
  });
  if (!parsed.success) redirect("/mfa-required?error=mfa");
  const session = await requireActiveMembership();
  const { data: factors, error: factorsError } = await session.auth.mfa.listFactors();
  const factor = factors?.totp.find((item) => item.id === parsed.data.factorId);
  if (factorsError || !factor) redirect("/mfa-required?error=mfa");
  const { data: challenge, error: challengeError } = await session.auth.mfa.challenge({ factorId: factor.id });
  if (challengeError || !challenge) redirect("/mfa-required?error=mfa");
  const { error: verifyError } = await session.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code: parsed.data.code });
  if (verifyError) redirect("/mfa-required?error=mfa");
  redirect("/");
}
