import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { AppError } from "@/server/lib/errors";
import { enforceRateLimit, type RateLimitStore } from "@/server/modules/operations/rate-limit";
import { getEmailProvider, type EmailProvider } from "@/server/providers/email";
import { SITE_ORIGIN } from "@/shared/config/site";
import { priorityReadModel } from "./referral.policy";
import { createSupabaseWaitlistReferralRepository, type WaitlistReferralRepository } from "./referral.repository";
import { waitlistApplicationInputSchema, waitlistStatusTokenSchema, waitlistVerificationTokenSchema } from "./waitlist.schemas";
import { createSupabaseWaitlistRepository, type WaitlistApplication, type WaitlistRepository } from "./waitlist.repository";

const VERIFICATION_TTL_MS = 48 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

export type WaitlistServiceDeps = {
  repository?: WaitlistRepository;
  emailProvider?: EmailProvider;
  rateLimitStore?: RateLimitStore;
  referralRepository?: WaitlistReferralRepository;
  now?: () => Date;
  randomToken?: () => string;
};

export type WaitlistSubmissionResult = {
  accepted: boolean;
  message: "received";
  verificationDelivery: "sent" | "not_configured" | "not_required";
};

function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function newToken(): string { return randomBytes(TOKEN_BYTES).toString("base64url"); }
function emailHash(normalizedEmail: string): string { return createHash("sha256").update(normalizedEmail).digest("hex"); }
function optional(value: string | undefined): string | null { return value?.trim() || null; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }

export class WaitlistService {
  private readonly repository: WaitlistRepository;
  private readonly emailProvider: EmailProvider;
  private readonly rateLimitStore?: RateLimitStore;
  private readonly referralRepository?: WaitlistReferralRepository;
  private readonly now: () => Date;
  private readonly randomToken: () => string;

  constructor(deps: WaitlistServiceDeps = {}) {
    this.repository = deps.repository ?? createSupabaseWaitlistRepository();
    this.emailProvider = deps.emailProvider ?? getEmailProvider();
    this.rateLimitStore = deps.rateLimitStore;
    this.referralRepository = deps.referralRepository ?? (deps.repository ? undefined : createSupabaseWaitlistReferralRepository());
    this.now = deps.now ?? (() => new Date());
    this.randomToken = deps.randomToken ?? newToken;
  }

  async submit(rawInput: unknown, requestOrigin = SITE_ORIGIN): Promise<WaitlistSubmissionResult> {
    const parsed = waitlistApplicationInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Please complete the required fields with valid values.", 422, { issues: parsed.error.issues });
    const input = parsed.data;
    if (input.honeypot) {
      this.log("abuse_rejected");
      return { accepted: false, message: "received", verificationDelivery: "not_required" };
    }
    const normalizedEmail = normalizeEmail(input.email);
    if (this.rateLimitStore) {
      await enforceRateLimit(this.rateLimitStore, "waitlist:submit:global", 120, 60 * 60 * 1000);
      await enforceRateLimit(this.rateLimitStore, `waitlist:submit:email:${emailHash(normalizedEmail)}`, 3, 60 * 60 * 1000);
    }
    this.log("submission_attempted");
    const verificationToken = this.randomToken();
    const statusToken = this.randomToken();
    const submitted = await this.repository.submit({
      email: input.email.trim(), normalizedEmail, firstName: input.firstName.trim(), companyName: input.companyName.trim(), companyWebsite: optional(input.companyWebsite), roleTitle: optional(input.roleTitle), useCase: input.useCase.trim(),
      verificationTokenHash: tokenHash(verificationToken), verificationExpiresAt: new Date(this.now().getTime() + VERIFICATION_TTL_MS).toISOString(), statusTokenHash: tokenHash(statusToken),
      source: optional(input.source), utmSource: optional(input.utmSource), utmMedium: optional(input.utmMedium), utmCampaign: optional(input.utmCampaign), utmContent: optional(input.utmContent), utmTerm: optional(input.utmTerm), referrerCategory: optional(input.referrerCategory), marketingConsent: input.marketingConsent,
      referralCode: optional(input.referralCode),
    });
    if (submitted.emailVerificationStatus === "verified") {
      this.log("duplicate_idempotent");
      return { accepted: true, message: "received", verificationDelivery: "not_required" };
    }
    const delivery = await this.emailProvider.send({
      to: submitted.email,
      subject: "Confirm your Wanterest Early Access request",
      text: `Hi ${submitted.firstName},\n\nConfirm your Wanterest Early Access request here:\n${requestOrigin}/waitlist/verify?token=${encodeURIComponent(verificationToken)}&status=${encodeURIComponent(statusToken)}\n\nYour Early Access number is finalized only after verification. Waitlist membership does not grant dashboard access.\n`,
      html: `<p>Hi ${escapeHtml(submitted.firstName)},</p><p>Confirm your Wanterest Early Access request:</p><p><a href="${requestOrigin}/waitlist/verify?token=${encodeURIComponent(verificationToken)}&status=${encodeURIComponent(statusToken)}">Confirm Early Access request</a></p><p>Your Early Access number is finalized only after verification. Waitlist membership does not grant dashboard access.</p>`,
    });
    if (delivery.ok) this.log("verification_sent");
    else this.log("verification_unavailable");
    return { accepted: true, message: "received", verificationDelivery: delivery.ok ? "sent" : "not_configured" };
  }

  async verify(token: string): Promise<WaitlistApplication> {
    const parsed = waitlistVerificationTokenSchema.safeParse(token);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "This verification link is invalid or expired.", 422);
    const application = await this.repository.verify(tokenHash(parsed.data));
    this.log("verification_succeeded");
    const delivery = await this.emailProvider.send({ to: application.email, subject: "Your Wanterest Early Access request is verified", text: `Your Wanterest Early Access request is verified. Your Early Access number is #${String(application.earlyAccessNumber).padStart(4, "0")}. Waitlist membership does not grant dashboard access.`, html: `<p>Your Wanterest Early Access request is verified.</p><p>Your Early Access number is <strong>#${String(application.earlyAccessNumber).padStart(4, "0")}</strong>.</p><p>Waitlist membership does not grant dashboard access.</p>` });
    if (!delivery.ok) this.log("verification_success_email_unavailable");
    return application;
  }

  async status(token: string): Promise<WaitlistApplication> {
    const parsed = waitlistStatusTokenSchema.safeParse(token);
    if (!parsed.success) throw new AppError("NOT_FOUND", "Waitlist status is unavailable.");
    return this.repository.getByStatusToken(tokenHash(parsed.data));
  }

  async statusWithReferral(token: string, requestOrigin = SITE_ORIGIN): Promise<{ application: WaitlistApplication; referral: ReturnType<typeof priorityReadModel> | null }> {
    const application = await this.status(token);
    if (!this.referralRepository || application.emailVerificationStatus !== "verified") return { application, referral: null };
    try {
      const raw = await this.referralRepository.getStatus(application.id);
      const shareUrl = raw.referralCode ? new URL(`/r/${encodeURIComponent(raw.referralCode)}`, requestOrigin).toString() : null;
      return { application, referral: priorityReadModel(raw, shareUrl) };
    } catch {
      this.log("referral_status_unavailable");
      return { application, referral: null };
    }
  }

  async withdraw(token: string): Promise<WaitlistApplication> {
    const parsed = waitlistStatusTokenSchema.safeParse(token);
    if (!parsed.success) throw new AppError("NOT_FOUND", "Waitlist status is unavailable.");
    const application = await this.repository.withdraw(tokenHash(parsed.data));
    this.log("withdrawal");
    return application;
  }

  async listForReview(filter: Parameters<WaitlistRepository["listForReview"]>[0]) { return this.repository.listForReview(filter); }
  async transitionForReview(input: Parameters<WaitlistRepository["transitionForReview"]>[0]) { return this.repository.transitionForReview(input); }

  async invalidateReferral(referralId: string, reason: string, actorUserId?: string | null): Promise<void> {
    if (!this.referralRepository) throw new AppError("CONFLICT", "Referral administration is unavailable.");
    await this.referralRepository.invalidate(referralId, reason, actorUserId);
  }

  async revokePriorityAccess(applicationId: string, reason: string, actorUserId?: string | null): Promise<void> {
    if (!this.referralRepository) throw new AppError("CONFLICT", "Priority administration is unavailable.");
    await this.referralRepository.revokePriority(applicationId, reason, actorUserId);
  }

  private log(event: string) { console.info("[waitlist]", { event }); }
}

export function createWaitlistService(deps: WaitlistServiceDeps = {}): WaitlistService { return new WaitlistService(deps); }
