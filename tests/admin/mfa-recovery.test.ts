import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error("REDIRECT:" + path); },
}));
vi.mock("../../apps/admin/src/server/request", () => ({
  assertAdminHostnameRequest: vi.fn(async () => undefined),
}));

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  membership: { user_id: "11111111-1111-4111-8111-111111111111" } as null | { user_id: string },
  service: null as unknown,
}));

vi.mock("../../apps/admin/src/server/supabase", () => ({
  createAdminSessionClient: vi.fn(async () => mocks.session),
  createAdminServiceClient: vi.fn(() => mocks.service),
  getAdminAuthRecoveryRedirectUrl: vi.fn(() => "https://admin.wanterest.com/auth/callback?next=/recover"),
}));

import { restartMfaEnrollment, startMfaEnrollment, verifyMfa } from "../../apps/admin/src/server/actions";

const userId = "11111111-1111-4111-8111-111111111111";
const factorId = "22222222-2222-4222-8222-222222222222";
const secondFactorId = "44444444-4444-4444-8444-444444444444";
const verifiedFactorId = "55555555-5555-4555-8555-555555555555";
const unauthorizedFactorId = "66666666-6666-4666-8666-666666666666";
const replacementFactorId = "77777777-7777-4777-8777-777777777777";
const challengeId = "33333333-3333-4333-8333-333333333333";

type Factor = {
  id: string;
  factor_type: "totp";
  status: "verified" | "unverified";
  friendly_name: string;
  created_at: string;
};

function factor(
  id = factorId,
  status: Factor["status"] = "unverified",
  friendlyName = "Wanterest Admin",
): Factor {
  return {
    id,
    factor_type: "totp",
    status,
    friendly_name: friendlyName,
    created_at: "2026-09-29T12:30:00.000Z",
  };
}

// Supabase Auth returns all verified and unverified factors in all, and only
// verified TOTP factors in the totp list.
function factorListResponse(all: Factor[]) {
  return {
    data: {
      all,
      totp: all.filter((item) => item.factor_type === "totp" && item.status === "verified"),
      phone: [],
    },
    error: null,
  };
}

function configure({
  all = [factor()],
  listFactors = vi.fn(async () => factorListResponse(all)),
  enroll = vi.fn(async () => ({
    data: { id: replacementFactorId, totp: { qr_code: "data:image/png;base64,private-qr" } },
    error: null,
  })),
  challenge = vi.fn(async () => ({ data: { id: challengeId }, error: null })),
  verify = vi.fn(async () => ({ data: {}, error: null })),
  unenroll = vi.fn(async ({ factorId: id }: { factorId: string }) => ({ data: { id }, error: null })),
  assurance = vi.fn(async () => ({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null })),
}: {
  all?: Factor[];
  listFactors?: ReturnType<typeof vi.fn>;
  enroll?: ReturnType<typeof vi.fn>;
  challenge?: ReturnType<typeof vi.fn>;
  verify?: ReturnType<typeof vi.fn>;
  unenroll?: ReturnType<typeof vi.fn>;
  assurance?: ReturnType<typeof vi.fn>;
} = {}) {
  mocks.membership = { user_id: userId };
  const sessionAuth = {
    getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
    mfa: { listFactors, enroll, challenge, verify, unenroll, getAuthenticatorAssuranceLevel: assurance },
  };
  mocks.session = { auth: sessionAuth };

  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: mocks.membership, error: null })),
  };
  query.select.mockImplementation(() => query);
  query.eq.mockImplementation(() => query);
  mocks.service = { from: vi.fn(() => query) };

  return { listFactors, enroll, challenge, verify, unenroll, assurance, sessionAuth, query };
}

function verificationForm(id = factorId, code = "123456") {
  const form = new FormData();
  form.set("factorId", id);
  form.set("code", code);
  return form;
}

function restartForm(id = factorId, confirmation: string | null = "yes") {
  const form = new FormData();
  form.set("factorId", id);
  if (confirmation) form.set("confirmRestart", confirmation);
  return form;
}

describe("admin TOTP recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = null;
    mocks.membership = { user_id: userId };
    mocks.service = null;
  });

  it("resumes an interrupted enrollment after refresh from the all list without creating another factor", async () => {
    const auth = configure({ all: [factor()] });

    await expect(startMfaEnrollment()).resolves.toMatchObject({
      ok: true,
      mode: "resume",
      factorId,
    });
    expect(auth.listFactors).toHaveBeenCalledTimes(1);
    expect(auth.enroll).not.toHaveBeenCalled();
  });

  it("returns each pending setup separately when multiple unfinished factors exist", async () => {
    const auth = configure({ all: [factor(), factor(secondFactorId), factor(verifiedFactorId, "verified")] });

    await expect(startMfaEnrollment()).resolves.toMatchObject({
      ok: true,
      mode: "multiple-pending",
      factorIds: [factorId, secondFactorId],
    });
    expect(auth.enroll).not.toHaveBeenCalled();
    expect(auth.unenroll).not.toHaveBeenCalled();
  });

  it("rechecks the all list after a concurrent duplicate-name conflict", async () => {
    const listFactors = vi.fn()
      .mockResolvedValueOnce(factorListResponse([]))
      .mockResolvedValueOnce(factorListResponse([factor()]));
    const enroll = vi.fn(async () => ({
      data: null,
      error: { code: "mfa_factor_name_conflict", status: 422, message: "private Auth detail" },
    }));
    configure({ listFactors, enroll });

    await expect(startMfaEnrollment()).resolves.toMatchObject({
      ok: true,
      mode: "resume",
      factorId,
    });
    expect(listFactors).toHaveBeenCalledTimes(2);
    expect(enroll).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh code to resume a pending factor that exists only in all", async () => {
    const auth = configure({ all: [factor()] });

    await expect(startMfaEnrollment()).resolves.toMatchObject({ ok: true, mode: "resume", factorId });
    await expect(verifyMfa(verificationForm())).rejects.toThrow("REDIRECT:/");
    expect(auth.challenge).toHaveBeenCalledWith({ factorId });
    expect(auth.verify).toHaveBeenCalledWith({ factorId, challengeId, code: "123456" });
    expect(auth.assurance).toHaveBeenCalledTimes(1);
  });

  it("keeps the pending enrollment available after an invalid code and returns sanitized retry guidance", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const auth = configure({
      all: [factor()],
      verify: vi.fn(async () => ({
        data: null,
        error: { code: "mfa_verification_failed", status: 400, message: "private OTP 876543 token session detail" },
      })),
    });

    const result = await verifyMfa(verificationForm(factorId, "876543"));
    expect(result).toMatchObject({ ok: false, reason: "code_rejected" });
    expect(result.message).toContain("current code");
    expect(result.message).not.toContain("private OTP");
    expect(auth.challenge).toHaveBeenCalledWith({ factorId });
    expect(auth.verify).toHaveBeenCalledWith({ factorId, challengeId, code: "876543" });
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/876543|token|session detail|private OTP/);
    warning.mockRestore();
  });

  it("promotes a verified pending code to AAL2 before redirecting into Admin", async () => {
    const auth = configure({ all: [factor()] });
    await expect(verifyMfa(verificationForm())).rejects.toThrow("REDIRECT:/");
    expect(auth.assurance).toHaveBeenCalledTimes(1);
    expect(auth.verify.mock.invocationCallOrder[0]).toBeLessThan(auth.assurance.mock.invocationCallOrder[0]);
  });

  it("does not treat verification as success if the session is still below AAL2", async () => {
    const auth = configure({
      assurance: vi.fn(async () => ({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null })),
    });

    const result = await verifyMfa(verificationForm());
    expect(result).toMatchObject({ ok: false, reason: "assurance_required" });
    expect(result.message).toContain("AAL2");
    expect(auth.verify).toHaveBeenCalledTimes(1);
  });

  it("challenges verified login factors from the totp list", async () => {
    const auth = configure({ all: [factor(verifiedFactorId, "verified")] });

    await expect(verifyMfa(verificationForm(verifiedFactorId))).rejects.toThrow("REDIRECT:/");
    expect(auth.challenge).toHaveBeenCalledWith({ factorId: verifiedFactorId });
  });

  it("requires explicit confirmation before restarting an unfinished setup", async () => {
    const auth = configure({ all: [factor()] });

    const result = await restartMfaEnrollment(restartForm(factorId, null));
    expect(result).toMatchObject({ ok: false, reason: "confirmation_required" });
    expect(auth.listFactors).not.toHaveBeenCalled();
    expect(auth.unenroll).not.toHaveBeenCalled();
    expect(auth.enroll).not.toHaveBeenCalled();
  });

  it("restarts only the selected pending factor and preserves other pending and verified factors", async () => {
    let all = [factor(), factor(secondFactorId), factor(verifiedFactorId, "verified")];
    const listFactors = vi.fn(async () => factorListResponse(all));
    const unenroll = vi.fn(async ({ factorId: id }: { factorId: string }) => {
      all = all.filter((item) => item.id !== id);
      return { data: { id }, error: null };
    });
    const auth = configure({ all, listFactors, unenroll });

    const result = await restartMfaEnrollment(restartForm(factorId));
    expect(result).toMatchObject({
      ok: true,
      mode: "resume",
      factorId: secondFactorId,
      notice: expect.stringContaining("selected unfinished setup was removed"),
    });
    expect(auth.unenroll).toHaveBeenCalledTimes(1);
    expect(auth.unenroll).toHaveBeenCalledWith({ factorId });
    expect(auth.enroll).not.toHaveBeenCalled();
    expect(all.map((item) => item.id)).toEqual([secondFactorId, verifiedFactorId]);
    expect(auth.sessionAuth.mfa.unenroll).toBe(auth.unenroll);
  });

  it("creates a replacement only after the selected pending factor is removed, retaining the verified factor", async () => {
    const verified = factor(verifiedFactorId, "verified");
    let all = [factor(), verified];
    const listFactors = vi.fn(async () => factorListResponse(all));
    const unenroll = vi.fn(async ({ factorId: id }: { factorId: string }) => {
      all = all.filter((item) => item.id !== id);
      return { data: { id }, error: null };
    });
    const auth = configure({ all, listFactors, unenroll });

    await expect(restartMfaEnrollment(restartForm())).resolves.toMatchObject({
      ok: true,
      mode: "setup",
      factorId: replacementFactorId,
      qrCode: "data:image/png;base64,private-qr",
    });
    expect(auth.unenroll).toHaveBeenCalledTimes(1);
    expect(auth.unenroll).toHaveBeenCalledWith({ factorId });
    expect(auth.enroll).toHaveBeenCalledOnce();
    expect(all).toEqual([verified]);
  });

  it("rejects arbitrary, other-user, verified and non-admin factor IDs without unenrolling", async () => {
    const auth = configure({
      all: [
        factor(verifiedFactorId, "verified"),
        factor(secondFactorId, "unverified", "Personal authenticator"),
      ],
    });

    for (const id of [unauthorizedFactorId, verifiedFactorId, secondFactorId]) {
      const result = await restartMfaEnrollment(restartForm(id));
      expect(result).toMatchObject({ ok: false, reason: "factor_missing" });
    }
    expect(auth.unenroll).not.toHaveBeenCalled();
    expect(auth.enroll).not.toHaveBeenCalled();

    const verification = await verifyMfa(verificationForm(unauthorizedFactorId));
    expect(verification).toMatchObject({ ok: false, reason: "factor_missing" });
    expect(auth.challenge).not.toHaveBeenCalled();
    expect(auth.verify).not.toHaveBeenCalled();
  });

  it("fails closed when the signed-in Auth session is missing", async () => {
    const auth = configure();
    mocks.session = null;

    await expect(restartMfaEnrollment(restartForm())).rejects.toThrow("REDIRECT:/login");
    expect(auth.unenroll).not.toHaveBeenCalled();
    expect(auth.enroll).not.toHaveBeenCalled();
  });

  it("revalidates active Admin membership before any enrollment mutation", async () => {
    const auth = configure();
    mocks.membership = null;

    await expect(restartMfaEnrollment(restartForm())).rejects.toThrow("REDIRECT:/login?error=credentials");
    expect(auth.unenroll).not.toHaveBeenCalled();
    expect(auth.enroll).not.toHaveBeenCalled();
  });

  it("fails closed on a factor-list error without enrolling, challenging or unenrolling", async () => {
    const auth = configure({
      listFactors: vi.fn(async () => ({
        data: null,
        error: { code: "unexpected", status: 503, message: "private upstream response with token secret" },
      })),
    });

    const start = await startMfaEnrollment();
    const verify = await verifyMfa(verificationForm());
    const restart = await restartMfaEnrollment(restartForm());
    expect(start).toMatchObject({ ok: false, reason: "unavailable" });
    expect(verify).toMatchObject({ ok: false, reason: "unavailable" });
    expect(restart).toMatchObject({ ok: false, reason: "unavailable" });
    expect(auth.enroll).not.toHaveBeenCalled();
    expect(auth.challenge).not.toHaveBeenCalled();
    expect(auth.verify).not.toHaveBeenCalled();
    expect(auth.unenroll).not.toHaveBeenCalled();
  });

  it("uses sanitized messages and logs no OTP, QR, secret, token or private Auth response", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const auth = configure({
      verify: vi.fn(async () => ({
        data: null,
        error: {
          code: "mfa_verification_failed",
          status: 400,
          message: "OTP=876543 QR=data:image/png;base64,private-qr secret=private-secret token=private-token",
        },
      })),
    });

    const result = await verifyMfa(verificationForm(factorId, "876543"));
    expect(result.message).not.toMatch(/876543|private-qr|private-secret|private-token/);
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/876543|private-qr|private-secret|private-token|OTP=|QR=/);
    expect(auth.sessionAuth.mfa.listFactors).toHaveBeenCalled();
    warning.mockRestore();
  });
});
