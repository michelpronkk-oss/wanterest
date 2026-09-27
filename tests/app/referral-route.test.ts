import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "../../src/app/r/[code]/route";

describe("public referral route", () => {
  it("uses a fixed waitlist destination and preserves only allowlisted attribution", async () => {
    const response = await GET(new Request("https://wanterest.com/r/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?utm_source=friend&secret=drop"), { params: Promise.resolve({ code: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }) });
    expect(response.status).toBe(303);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBe("https://wanterest.com/waitlist?ref=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&source=referral&utm_source=friend");
  });

  it("degrades invalid and malformed codes to the ordinary waitlist", async () => {
    const invalid = await GET(new Request("https://wanterest.com/r/not-a-referral"), { params: Promise.resolve({ code: "not-a-referral" }) });
    expect(invalid.headers.get("location")).toBe("https://wanterest.com/waitlist");
    const malformed = await GET(new Request("https://wanterest.com/r/%E0%A4%A"), { params: Promise.resolve({ code: "%E0%A4%A" }) });
    expect(malformed.headers.get("location")).toBe("https://wanterest.com/waitlist");
  });
});
