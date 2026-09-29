import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { waitlistApplicationInputSchema } from "../../src/server/modules/waitlist/waitlist.schemas";
import { OptionalContext, WaitlistForm } from "../../src/components/waitlist/waitlist-form";
import {
  buildWaitlistPayload,
  normalizeWebsiteInput,
  requiredFieldErrors,
  submitWaitlistRequest,
  websiteLabel,
  type WaitlistFormValues,
} from "../../src/components/waitlist/waitlist-form-model";

const complete: WaitlistFormValues = {
  firstName: "Maya", companyName: "Northwind", email: "maya@northwind.io", useCase: "Why buyers switch.",
  companyWebsite: "", roleTitle: "", marketingConsent: false, honeypot: "",
};

function render(search = "") {
  navigation.search = search;
  return renderToStaticMarkup(createElement(WaitlistForm));
}

/** The markup of the collapsed/expanded context panel, isolated from the rest of the form. */
function panelMarkup(html: string) {
  const start = html.indexOf('class="ea-optional-panel"');
  return html.slice(html.lastIndexOf("<div", start), html.indexOf("</label></div></div>", start));
}

describe("required fields mirror the backend contract", () => {
  it("documents that useCase is required server-side, so it can never be an optional field", () => {
    const withoutUseCase: Partial<ReturnType<typeof buildWaitlistPayload>> = { ...buildWaitlistPayload(complete, "", "") };
    delete withoutUseCase.useCase;
    expect(waitlistApplicationInputSchema.safeParse(withoutUseCase).success).toBe(false);
    expect(waitlistApplicationInputSchema.safeParse({ ...withoutUseCase, useCase: "   " }).success).toBe(false);
    expect(waitlistApplicationInputSchema.safeParse(buildWaitlistPayload(complete, "", "")).success).toBe(true);
  });

  it("reports every missing or blank required field, in on-screen order", () => {
    const errors = requiredFieldErrors({ firstName: " ", companyName: "", email: "", useCase: "" });
    expect(Object.keys(errors)).toEqual(["firstName", "companyName", "email", "useCase"]);
  });

  it("rejects a malformed email and accepts a complete request", () => {
    expect(requiredFieldErrors({ ...complete, email: "maya@" }).email).toBeTruthy();
    expect(requiredFieldErrors(complete)).toEqual({});
  });

  it("does not require website, role or consent", () => {
    expect(waitlistApplicationInputSchema.safeParse({ ...buildWaitlistPayload(complete, "", ""), companyWebsite: "", roleTitle: "" }).success).toBe(true);
  });
});

describe("collapsed and expanded optional context", () => {
  it("shows the four required fields immediately and keeps optional fields in a collapsed panel", () => {
    const html = render();
    for (const name of ["firstName", "companyName", "email", "useCase"]) {
      expect(html).toContain(`name="${name}"`);
      expect(panelMarkup(html)).not.toContain(`name="${name}"`);
    }
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/class="ea-optional-panel" hidden=""/);
    expect(panelMarkup(html)).toContain('name="companyWebsite"');
    expect(panelMarkup(html)).toContain('name="roleTitle"');
    expect(panelMarkup(html)).toContain('type="checkbox"');
    expect(html).toContain("Add context <span>(optional)</span>");
  });

  it("expands to reveal the same, still-mounted optional fields", () => {
    const ids = { panel: "p", website: "w", role: "r", consent: "c" };
    const collapsed = renderToStaticMarkup(createElement(OptionalContext, { open: false, onToggle: () => undefined, ids, prefilledWebsite: "", marketingConsent: false, onConsentChange: () => undefined }));
    const expanded = renderToStaticMarkup(createElement(OptionalContext, { open: true, onToggle: () => undefined, ids, prefilledWebsite: "", marketingConsent: false, onConsentChange: () => undefined }));
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain("hidden");
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('class="ea-optional is-open"');
    expect(expanded).not.toMatch(/ea-optional-panel" hidden/);
    for (const html of [collapsed, expanded]) {
      expect(html).toContain('name="companyWebsite"');
      expect(html).toContain('name="roleTitle"');
    }
  });
});

describe("homepage website prefill", () => {
  it("prefills the company website from ?website= and submits it even while collapsed", () => {
    const html = render("?website=linear.app");
    expect(panelMarkup(html)).toContain('value="https://linear.app"');
    expect(html).toContain("linear.app added");
    expect(html).toMatch(/class="ea-optional-panel" hidden=""/);
  });

  it("normalises bare domains the same way the homepage does and labels them by host", () => {
    expect(normalizeWebsiteInput(" linear.app ")).toBe("https://linear.app");
    expect(normalizeWebsiteInput("http://example.com")).toBe("http://example.com");
    expect(normalizeWebsiteInput("")).toBe("");
    expect(websiteLabel("https://www.linear.app/pricing")).toBe("linear.app");
    expect(buildWaitlistPayload({ ...complete, companyWebsite: "linear.app" }, "", "").companyWebsite).toBe("https://linear.app");
  });

  it("renders no prefilled website when none was passed", () => {
    expect(panelMarkup(render())).not.toMatch(/value="[^"]+"/);
  });
});

describe("independent marketing consent", () => {
  it("is off by default and unchecked in the collapsed panel", () => {
    expect(buildWaitlistPayload(complete, "", "").marketingConsent).toBe(false);
    expect(panelMarkup(render())).not.toContain("checked");
  });

  it("changes nothing but the consent flag when opted in", () => {
    const without = buildWaitlistPayload(complete, "?utm_source=x", "https://ref.example");
    const withConsent = buildWaitlistPayload({ ...complete, marketingConsent: true }, "?utm_source=x", "https://ref.example");
    expect(withConsent).toEqual({ ...without, marketingConsent: true });
  });
});

describe("submission and redirect", () => {
  it("builds the unchanged attribution payload", () => {
    const payload = buildWaitlistPayload(complete, "?utm_source=newsletter&utm_campaign=launch&ref=" + "r".repeat(32), "https://news.example");
    expect(payload).toMatchObject({ source: "waitlist", utmSource: "newsletter", utmCampaign: "launch", referralCode: "r".repeat(32), referrerCategory: "external", honeypot: "" });
    expect(buildWaitlistPayload(complete, "?source=homepage", "").referrerCategory).toBe("direct");
    expect(buildWaitlistPayload(complete, "?source=homepage", "").source).toBe("homepage");
  });

  it("posts to /api/waitlist and reports success", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 }));
    await expect(submitWaitlistRequest(buildWaitlistPayload(complete, "", ""), fetchImpl as unknown as typeof fetch)).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("/api/waitlist", expect.objectContaining({ method: "POST" }));
  });

  it("surfaces the server message and rate-limit retry window", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Too many requests.", details: { retryAfterSeconds: 42 } } }), { status: 429 }));
    await expect(submitWaitlistRequest(buildWaitlistPayload(complete, "", ""), fetchImpl as unknown as typeof fetch)).resolves.toEqual({ ok: false, message: "Too many requests.", retryAfterSeconds: 42 });
  });

  it("reports an unreachable service without throwing", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("offline"); });
    const result = await submitWaitlistRequest(buildWaitlistPayload(complete, "", ""), fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
  });

  it("stores the pending submission and moves to the dedicated check-email screen on success", () => {
    const source = readFileSync(join(process.cwd(), "src/components/waitlist/waitlist-form.tsx"), "utf8");
    expect(source).toContain("storePendingSubmission(values.email, payload)");
    expect(source).toContain('router.push("/waitlist/check-email")');
    expect(render()).toContain("Request Early Access");
  });
});
