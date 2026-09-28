import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  withdraw: vi.fn(),
  getApplicantShareCardsQuery: vi.fn(),
  mutateApplicantShareCardCommand: vi.fn(),
  cookie: { value: undefined as string | undefined },
}));
const { verify, withdraw, getApplicantShareCardsQuery, mutateApplicantShareCardCommand } = mocks;

vi.mock("@/server/modules/waitlist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/modules/waitlist")>();
  return { ...actual, createWaitlistService: () => ({ verify: mocks.verify, withdraw: mocks.withdraw }) };
});
vi.mock("@/server/modules/share-cards", () => ({ getApplicantShareCardsQuery: mocks.getApplicantShareCardsQuery, mutateApplicantShareCardCommand: mocks.mutateApplicantShareCardCommand }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "wanterest_waitlist_status" && mocks.cookie.value ? { value: mocks.cookie.value } : undefined) }),
}));

function setCookie(value: string | undefined) { mocks.cookie.value = value; }

import { AppError } from "../../src/server/lib/errors";
import { GET as verifyRoute } from "../../src/app/waitlist/verify/route";
import { POST as withdrawRoute } from "../../src/app/waitlist/withdraw/route";
import { POST as shareCardsPost } from "../../src/app/waitlist/share-cards/route";
import { loadShareAvailability } from "../../src/app/waitlist/_lib/journey-data";

const verificationToken = "v".repeat(43);
const statusToken = "s".repeat(43);
const origin = "https://www.wanterest.test";

function verifyRequest(token = verificationToken, status = statusToken) {
  return new Request(`${origin}/waitlist/verify?token=${token}&status=${status}`);
}

beforeEach(() => {
  verify.mockReset(); withdraw.mockReset(); getApplicantShareCardsQuery.mockReset(); mutateApplicantShareCardCommand.mockReset();
  setCookie(undefined);
});

describe("email verification → identity reveal (primary regression)", () => {
  it("sends a successful verification to the dedicated reveal, not the generic status page", async () => {
    verify.mockResolvedValue({ status: "verified", earlyAccessNumber: 184 });
    const response = await verifyRoute(verifyRequest());

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/waitlist/verified");
    expect(location.pathname).not.toBe("/waitlist/status");
    expect(location.search).toBe("");
    expect(verify).toHaveBeenCalledWith(verificationToken);

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`wanterest_waitlist_status=${statusToken}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/waitlist/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("treats an already-verified link as success: same reveal, the stored number, no new allocation", async () => {
    verify.mockResolvedValue({ status: "under_review", earlyAccessNumber: 184 });
    const first = await verifyRoute(verifyRequest());
    const again = await verifyRoute(verifyRequest());
    expect(new URL(first.headers.get("location") ?? "").pathname).toBe("/waitlist/verified");
    expect(new URL(again.headers.get("location") ?? "").pathname).toBe("/waitlist/verified");
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("routes an expired link to the styled recovery page without setting a status cookie", async () => {
    verify.mockRejectedValue(new AppError("INTERNAL_ERROR", "Waitlist persistence failed.", 500, { providerMessage: "waitlist_verification_expired" }));
    const response = await verifyRoute(verifyRequest());
    const location = new URL(response.headers.get("location") ?? "");
    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/waitlist/link-unavailable");
    expect(location.searchParams.get("reason")).toBe("expired");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("routes an unknown or malformed link to the invalid recovery page and never calls the service for malformed tokens", async () => {
    verify.mockRejectedValue(new AppError("INTERNAL_ERROR", "Waitlist persistence failed.", 500, { providerMessage: "waitlist_verification_invalid" }));
    const unknown = await verifyRoute(verifyRequest());
    expect(new URL(unknown.headers.get("location") ?? "").searchParams.get("reason")).toBe("invalid");

    verify.mockClear();
    const malformed = await verifyRoute(verifyRequest("short", statusToken));
    expect(new URL(malformed.headers.get("location") ?? "").searchParams.get("reason")).toBe("invalid");
    expect(verify).not.toHaveBeenCalled();
    expect(malformed.headers.get("set-cookie")).toBeNull();
  });

  it("never echoes the verification or status token into the failure destination", async () => {
    verify.mockRejectedValue(new Error("boom"));
    const response = await verifyRoute(verifyRequest());
    const location = response.headers.get("location") ?? "";
    expect(location).not.toContain(verificationToken);
    expect(location).not.toContain(statusToken);
  });
});

describe("manual withdrawal is reachable with the path=/waitlist status cookie", () => {
  it("withdraws using only the HttpOnly cookie token", async () => {
    setCookie(statusToken);
    withdraw.mockResolvedValue({ status: "withdrawn" });
    const response = await withdrawRoute(new Request(`${origin}/waitlist/withdraw`, { method: "POST", headers: { origin } }));
    expect(response.status).toBe(200);
    expect(withdraw).toHaveBeenCalledWith(statusToken);
    expect(await response.json()).toMatchObject({ ok: true, status: "withdrawn" });
  });

  it("rejects a cross-origin withdrawal", async () => {
    setCookie(statusToken);
    const response = await withdrawRoute(new Request(`${origin}/waitlist/withdraw`, { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(response.status).toBe(403);
    expect(withdraw).not.toHaveBeenCalled();
  });

  it("fails closed without a private status cookie", async () => {
    withdraw.mockRejectedValue(new AppError("NOT_FOUND", "Waitlist status is unavailable."));
    const response = await withdrawRoute(new Request(`${origin}/waitlist/withdraw`, { method: "POST", headers: { origin } }));
    expect(response.status).toBe(404);
    expect(withdraw).toHaveBeenCalledWith("");
  });
});

describe("Share my place reuses Layer 13B.1 with explicit publication only", () => {
  it("returns `card` after an explicit publish and `cards` after revoke, matching ShareCardPanel's contract", async () => {
    setCookie(statusToken);
    mutateApplicantShareCardCommand.mockResolvedValueOnce({ variant: "EARLY_ACCESS", publicationState: "published" });
    const published = await shareCardsPost(new Request(`${origin}/waitlist/share-cards`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ action: "publish", variant: "EARLY_ACCESS" }) }));
    expect(await published.json()).toMatchObject({ card: { variant: "EARLY_ACCESS" } });

    mutateApplicantShareCardCommand.mockResolvedValueOnce([{ variant: "EARLY_ACCESS", publicationState: "revoked" }]);
    const revoked = await shareCardsPost(new Request(`${origin}/waitlist/share-cards`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ action: "revoke", variant: "EARLY_ACCESS" }) }));
    expect(await revoked.json()).toMatchObject({ cards: [{ variant: "EARLY_ACCESS" }] });
    expect(mutateApplicantShareCardCommand).toHaveBeenCalledWith(statusToken, expect.anything());
  });

  it("rejects cross-origin share mutations", async () => {
    setCookie(statusToken);
    const response = await shareCardsPost(new Request(`${origin}/waitlist/share-cards`, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }));
    expect(response.status).toBe(403);
    expect(mutateApplicantShareCardCommand).not.toHaveBeenCalled();
  });

  it("reports sharing as unavailable (not empty) when the 13B schema is missing, without throwing", async () => {
    getApplicantShareCardsQuery.mockRejectedValue(new Error("relation \"share_card_publications\" does not exist"));
    await expect(loadShareAvailability(statusToken)).resolves.toEqual({ available: false });
    getApplicantShareCardsQuery.mockResolvedValue([]);
    await expect(loadShareAvailability(statusToken)).resolves.toEqual({ available: true, cards: [] });
  });
});
