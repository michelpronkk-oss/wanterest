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

import { startMfaEnrollment, verifyMfa } from "../../apps/admin/src/server/actions";

const userId = "11111111-1111-4111-8111-111111111111";
const factorId = "22222222-2222-4222-8222-222222222222";
const challengeId = "33333333-3333-4333-8333-333333333333";

function factor(status: "verified" | "unverified" = "unverified", friendlyName = "Wanterest Admin") {
  return { id: factorId, factor_type: "totp", status, friendly_name: friendlyName };
}

function configure({
  factors = [factor()],
  listFactors = vi.fn(async () => ({ data: { totp: factors, phone: [] }, error: null })),
  enroll = vi.fn(async () => ({
    data: { id: factorId, totp: { qr_code: "data:image/png;base64,private-qr" } },
    error: null,
  })),
  challenge = vi.fn(async () => ({ data: { id: challengeId }, error: null })),
  verify = vi.fn(async () => ({ data: {}, error: null })),
}: {
  factors?: ReturnType<typeof factor>[];
  listFactors?: ReturnType<typeof vi.fn>;
  enroll?: ReturnType<typeof vi.fn>;
  challenge?: ReturnType<typeof vi.fn>;
  verify?: ReturnType<typeof vi.fn>;
} = {}) {
  mocks.membership = { user_id: userId };
  mocks.session = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
      mfa: { listFactors, enroll, challenge, verify },
    },
  };

  const query: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: mocks.membership, error: null })),
  };
  query.select.mockImplementation(() => query);
  query.eq.mockImplementation(() => query);
  mocks.service = { from: vi.fn(() => query) };

  return { listFactors, enroll, challenge, verify, query };
}

function verificationForm(id = factorId, code = "123456") {
  const form = new FormData();
  form.set("factorId", id);
  form.set("code", code);
  return form;
}

describe("admin TOTP recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = null;
    mocks.membership = { user_id: userId };
    mocks.service = null;
  });

  it("resumes one existing unverified Wanterest Admin factor without enrolling another", async () => {
    const auth = configure();
    await expect(startMfaEnrollment()).resolves.toEqual({
      ok: true,
      mode: "resume",
      factorId,
    });
    expect(auth.enroll).not.toHaveBeenCalled();
  });

  it("does not enroll when Supabase cannot confirm the existing factor state", async () => {
    const auth = configure({
      listFactors: vi.fn(async () => ({
        data: null,
        error: { code: "unexpected", status: 503, message: "private upstream response" },
      })),
    });

    const result = await startMfaEnrollment();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected the Auth factor lookup to fail closed.");
    expect(result.reason).toBe("unavailable");
    expect(result.message).not.toContain("private upstream");
    expect(auth.enroll).not.toHaveBeenCalled();
  });

  it("rechecks factor state after a concurrent duplicate-name conflict", async () => {
    const listFactors = vi.fn()
      .mockResolvedValueOnce({ data: { totp: [], phone: [] }, error: null })
      .mockResolvedValueOnce({ data: { totp: [factor()], phone: [] }, error: null });
    const enroll = vi.fn(async () => ({
      data: null,
      error: { code: "mfa_factor_name_conflict", status: 422, message: "private detail" },
    }));
    configure({ listFactors, enroll });

    await expect(startMfaEnrollment()).resolves.toEqual({
      ok: true,
      mode: "resume",
      factorId,
    });
    expect(listFactors).toHaveBeenCalledTimes(2);
    expect(enroll).toHaveBeenCalledTimes(1);
  });

  it("retains a pending factor after rejected verification and returns a sanitized message", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const auth = configure({
      verify: vi.fn(async () => ({
        data: null,
        error: { code: "mfa_verification_failed", message: "private OTP and session detail" },
      })),
    });

    const result = await verifyMfa(verificationForm());
    expect(result).toMatchObject({ ok: false, reason: "code_rejected" });
    expect(result.message).toContain("current code");
    expect(result.message).not.toContain("private OTP");
    expect(auth.challenge).toHaveBeenCalledWith({ factorId });
    expect(auth.verify).toHaveBeenCalledWith({ factorId, challengeId, code: "123456" });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private OTP");
    warning.mockRestore();
  });

  it("does not challenge a factor that is not attached to the current Auth user", async () => {
    const auth = configure({ factors: [] });
    const result = await verifyMfa(verificationForm());
    expect(result).toMatchObject({ ok: false, reason: "factor_missing" });
    expect(auth.challenge).not.toHaveBeenCalled();
    expect(auth.verify).not.toHaveBeenCalled();
  });

  it("blocks factor operations when active admin membership is absent", async () => {
    const auth = configure();
    mocks.membership = null;

    await expect(startMfaEnrollment()).rejects.toThrow("REDIRECT:/login?error=credentials");
    expect(auth.enroll).not.toHaveBeenCalled();
  });

  it("keeps challenge failures actionable without returning provider error text", async () => {
    const auth = configure({
      challenge: vi.fn(async () => ({
        data: null,
        error: { code: "unexpected", status: 503, message: "private upstream response" },
      })),
    });
    const result = await verifyMfa(verificationForm());
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(result.message).toContain("authenticator service");
    expect(result.message).not.toContain("private upstream");
    expect(auth.verify).not.toHaveBeenCalled();
  });
});
