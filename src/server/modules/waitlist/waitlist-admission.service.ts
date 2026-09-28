import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { requireUser } from "@/server/modules/auth";
import { AppError } from "@/server/lib/errors";
import { getEmailProvider, type EmailProvider, type EmailSendResult } from "@/server/providers/email";
import { SITE_ORIGIN } from "@/shared/config/site";
import { waitlistStatusTokenSchema } from "./waitlist.schemas";
import {
  waitlistAdmissionApplicationIdSchema,
  waitlistAdmissionInviteIdSchema,
  waitlistAdmissionTokenSchema,
  type AdmissionInvite,
  type AdmissionResult,
  type WaitlistAdmissionStatus,
} from "./waitlist-admission.schemas";
import { createSupabaseWaitlistAdmissionRepository, type WaitlistAdmissionRepository } from "./waitlist-admission.repository";
import { invitationEmail } from "./waitlist-emails";

const TOKEN_BYTES = 32;

export type InviteEmailPayload = {
  firstName: string;
  companyName: string;
  inviteUrl: string;
  expiresAt: string;
};

export type IssueInviteResult = {
  invite: AdmissionInvite;
  rawToken: string;
  emailPayload: InviteEmailPayload;
  delivery: EmailSendResult | null;
};

export type WaitlistAdmissionServiceDeps = {
  repository?: WaitlistAdmissionRepository;
  emailProvider?: EmailProvider;
  randomToken?: () => string;
};

function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function newToken(): string { return randomBytes(TOKEN_BYTES).toString("base64url"); }

function origin(value: string): string {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("invalid_origin");
    return parsed.origin;
  } catch {
    throw new AppError("VALIDATION_ERROR", "The invite origin is invalid.");
  }
}

export class WaitlistAdmissionService {
  private readonly repository: WaitlistAdmissionRepository;
  private readonly emailProvider: EmailProvider;
  private readonly randomToken: () => string;

  constructor(deps: WaitlistAdmissionServiceDeps = {}) {
    this.repository = deps.repository ?? createSupabaseWaitlistAdmissionRepository();
    this.emailProvider = deps.emailProvider ?? getEmailProvider();
    this.randomToken = deps.randomToken ?? newToken;
  }

  async issueInvite(
    applicationId: unknown,
    options: { actorUserId?: string | null; requestOrigin?: string; sendEmail?: boolean; firstName?: string; companyName?: string } = {},
  ): Promise<IssueInviteResult> {
    const parsed = waitlistAdmissionApplicationIdSchema.safeParse(applicationId);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid waitlist application ID.");
    const inviteOrigin = origin(options.requestOrigin ?? SITE_ORIGIN);
    const rawToken = this.randomToken();
    const invite = await this.repository.issue({ applicationId: parsed.data, tokenHash: tokenHash(rawToken), actorUserId: options.actorUserId ?? null });
    const inviteUrl = new URL(`/invite/accept?token=${encodeURIComponent(rawToken)}`, inviteOrigin).toString();
    const emailPayload = {
      firstName: options.firstName ?? invite.firstName,
      companyName: options.companyName ?? invite.companyName,
      inviteUrl,
      expiresAt: invite.expiresAt,
    } satisfies InviteEmailPayload;
    const message = {
      to: invite.recipientEmail,
      ...invitationEmail({
        firstName: emailPayload.firstName,
        companyName: emailPayload.companyName,
        inviteUrl,
        expiresAt: emailPayload.expiresAt,
      }),
    };
    const delivery = options.sendEmail ? await this.emailProvider.send(message) : null;
    return { invite, rawToken, emailPayload, delivery };
  }

  async revokeInvite(inviteId: unknown, actorUserId?: string | null, reason?: string) {
    const parsed = waitlistAdmissionInviteIdSchema.safeParse(inviteId);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid admission invite ID.");
    return this.repository.revoke({ inviteId: parsed.data, actorUserId, reason });
  }

  async getPrivateStatus(statusToken: unknown): Promise<WaitlistAdmissionStatus> {
    const parsed = waitlistStatusTokenSchema.safeParse(statusToken);
    if (!parsed.success) throw new AppError("NOT_FOUND", "Private admission status is unavailable.");
    return this.repository.getStatus(tokenHash(parsed.data));
  }

  async acceptInvite(rawToken: unknown, userId?: string, traceId?: string): Promise<AdmissionResult> {
    const parsed = waitlistAdmissionTokenSchema.safeParse(rawToken);
    if (!parsed.success) throw new AppError("CONFLICT", "This invite is no longer usable.");
    const user = userId ? null : await requireUser();
    return this.repository.accept({ tokenHash: tokenHash(parsed.data), userId: userId ?? user!.id, traceId: traceId ?? null });
  }
}

export function createWaitlistAdmissionService(deps: WaitlistAdmissionServiceDeps = {}): WaitlistAdmissionService {
  return new WaitlistAdmissionService(deps);
}
