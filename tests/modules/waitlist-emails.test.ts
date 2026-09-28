import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { earlyAccessVerificationEmail, earlyAccessVerifiedEmail, invitationEmail } from "../../src/server/modules/waitlist/waitlist-emails";

describe("Opus transactional email renderers", () => {
  it("renders the approved Early Access verification hierarchy with direct safe fallbacks", () => {
    const message = earlyAccessVerificationEmail({
      firstName: "Ava <Founder>",
      verificationUrl: "https://www.wanterest.com/waitlist/verify?token=test-token&status=status-token",
      expiresInHours: 48,
    });

    expect(message.subject).toBe("Confirm your Wanterest Early Access request");
    expect(message.html).toContain("#F7F6F1");
    expect(message.html).toContain("#D7FF3D");
    expect(message.html).toContain('width="600"');
    expect(message.html).toContain('role="presentation"');
    expect(message.html).toContain("v:roundrect");
    expect(message.html).toContain("@media only screen and (max-width:620px)");
    expect(message.html).toContain("Hi Ava &lt;Founder&gt;");
    expect(message.html).toContain("token=test-token&amp;status=status-token");
    expect(message.html).toContain("Button not working? Confirm Early Access using this link:");
    expect(message.html).not.toContain("utm_");
    expect(message.text).toContain("https://www.wanterest.com/waitlist/verify?token=test-token&status=status-token");
  });

  it("uses the actual verified Early Access identity without inventing a status credential", () => {
    const message = earlyAccessVerifiedEmail({ firstName: "Ava", earlyAccessNumber: 184 });

    expect(message.subject).toBe("Your Wanterest Early Access place is recorded");
    expect(message.html).toContain("#0184");
    expect(message.html).toContain("historical identity, not dashboard access");
    expect(message.html).not.toContain("waitlist/status?");
    expect(message.text).toContain("#0184");
  });

  it("refuses to send a verified identity claim without an authoritative positive number", () => {
    expect(() => earlyAccessVerifiedEmail({ firstName: "Ava", earlyAccessNumber: 0 })).toThrow("authoritative positive identity number");
  });

  it("renders invitation content with escaped personal fields and the server-created invite URL", () => {
    const message = invitationEmail({
      firstName: "Ava <Founder>",
      companyName: "Acme & Co.",
      inviteUrl: "https://www.wanterest.com/invite/accept?token=invite-token",
      expiresAt: "2026-10-05T00:00:00.000Z",
    });

    expect(message.subject).toBe("Your Wanterest invitation is ready");
    expect(message.html).toContain("You are in.");
    expect(message.html).toContain("Hi Ava &lt;Founder&gt;");
    expect(message.html).toContain("Acme &amp; Co.");
    expect(message.html).toContain("https://www.wanterest.com/invite/accept?token=invite-token");
    expect(message.html).toContain("can be used once");
    expect(message.text).toContain("Accept invitation:");
  });

  it("refuses unsafe link schemes before an email can be assembled", () => {
    expect(() => earlyAccessVerificationEmail({ firstName: "Ava", verificationUrl: "javascript:alert(1)", expiresInHours: 48 })).toThrow("safe absolute HTTP(S) URL");
  });
});
