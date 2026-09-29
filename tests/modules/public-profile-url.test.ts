import { describe, expect, it } from "vitest";
import { isPublicProfileUrl, publicProfileUrlOrNull } from "@/shared/public-profile-url";
import { publicProfileInputSchema, publicCohortRowSchema } from "@/server/modules/cohort-public/cohort-public.schemas";

export const safePublicReferences = [
  "https://example.com", "https://assets.example.com/logo.png?w=96&h=96&fit=contain&auto=format&v=2",
  "https://example.com:443/people#team", "https://EXAMPLE.com/company?utm_source=members",
  "https://assets.example.com/My%20Logo.png?label=Caf%C3%A9", "https://example.com/storage/v1/object/public/logos/company.png",
  "https://example.com/render/image/public/logos/company.png?width=96&quality=80", "https://example.com/logo?name=one+two&name=three",
  "https://example.com/?url=https%3A%2F%2Fexample.com%2Fimage.png", "https://example.com/products?product_code=public",
];
export const unsafePublicReferences = [
  "http://example.com/logo", "javascript:alert(1)", "data:image/png;base64,AAA", "//example.com/logo",
  "https://name@example.com/logo", "https://name:password@example.com/logo", "https://@example.com/logo",
  "https://example.com@localhost/logo", "https://127.0.0.1/logo", "https://2130706433/logo", "https://0x7f000001/logo",
  "https://[::1]/logo", "https://[::ffff:127.0.0.1]/logo", "https://10.0.0.1/logo", "https://169.254.169.254/logo",
  "https://localhost/logo", "https://company.local/logo", "https://metadata.google.internal/logo", "https://company.test/logo", "https://assets.example/logo",
  "https://example.com:8443/logo", "https://example.com./logo", "https://example.com/../private/logo",
  "https://example.com/%70rivate/logo", "https://example.com/%2570rivate/logo", "https://example.com/auth/callback",
  "https://example.com/storage/v1/object/sign/logos/a.png", "https://example.com/storage/v1/object/authenticated/logos/a.png",
  "https://example.com/render/image/sign/logos/a.png", "https://example.com/private",
  "https://example.com/logo?token=value", "https://example.com/logo?Access_Token=value", "https://example.com/logo?%74oken=value",
  "https://example.com/logo?%2574oken=value", "https://example.com/logo?w=96&token=value", "https://example.com/logo?x-amz-signature=value",
  "https://example.com/logo?X-Goog-Credential=value", "https://example.com/logo?sig=value&se=2026", "https://example.com/logo?api.key=value",
  "https://example.com/logo#access_token=value", "https://example.com/#token-value", "https://example.com/#jwt", "https://example.com/#",
  "https://example.com/logo?bad%ZZ=value", "https://example.com/%C0%AFlogo", "https://example.com/logo?label=%00",
  "https://example.com/logo?label=%0A", "https://example.com/logo?label=%5C", "https://example.com/logo?label=%C0%AF",
  "https://example.com/logo?ok=1&", "https://example.com/logo?", "https://example.com\\@private.local/logo",
  "https://example.com/logo?auth_token=value", "https://example.com/logo?cf-access-token=value", "https://example.com/logo?label=%C2%85",
  "https://example.com/logo%3Ftoken%3Dvalue", "https://example.com/private;session=value/logo", "https://res.cloudinary.com/company/image/upload/s--signature--/logo.png",
  "https://app.wanterest.com/api/workspaces/00000000-0000-4000-8000-000000000001/logo", "https://app.wanterest.com/app/signals",
  "https://example.com/logo\n", " https://example.com/logo", `https://example.com/${"a".repeat(2048)}`,
];
const row = { publicSlug: "company", displayName: "Company", logoUrl: null, avatarUrl: null, websiteUrl: null, monogram: "C", headline: null, cohort: "founding_25", number: 1, limit: 25, assignedAt: "2026-09-28T00:00:00.000Z" };

describe("authoritative public reference policy V1", () => {
  it.each(safePublicReferences)("preserves a valid public URL: %s", (url) => {
    expect(isPublicProfileUrl(url)).toBe(true);
    expect(publicProfileUrlOrNull(url)).toBe(url);
    const dto = publicCohortRowSchema.parse({ ...row, logoUrl: url, avatarUrl: url, websiteUrl: url, workspaceId: "private" });
    expect([dto.logoUrl, dto.avatarUrl, dto.websiteUrl]).toEqual([url, url, url]);
    expect(dto).not.toHaveProperty("workspaceId");
  });
  it.each(unsafePublicReferences)("masks unsafe direct public DTO values: %s", (url) => {
    expect(isPublicProfileUrl(url)).toBe(false);
    const dto = publicCohortRowSchema.parse({ ...row, logoUrl: url, avatarUrl: url, websiteUrl: url });
    expect([dto.logoUrl, dto.avatarUrl, dto.websiteUrl]).toEqual([null, null, null]);
    expect(dto.number).toBe(1);
  });
  it.each(["logoUrl", "avatarUrl", "websiteUrl"])("rejects new credential-bearing %s input", (field) => {
    expect(publicProfileInputSchema.safeParse({ publicSlug: "company", displayName: "Company", [field]: "https://example.com/logo?token=value", wallVisible: true, passVisible: false }).success).toBe(false);
  });
  it("keeps optional URLs and independent consent defaults", () => {
    expect(publicProfileUrlOrNull(null)).toBeNull();
    const input = publicProfileInputSchema.parse({ publicSlug: "company", displayName: "Company", logoUrl: " https://example.com/logo?v=2 ", wallVisible: true, passVisible: false });
    expect(input.logoUrl).toBe("https://example.com/logo?v=2");
    expect([input.wallVisible, input.passVisible]).toEqual([true, false]);
    expect(publicProfileInputSchema.parse({ publicSlug: "company", displayName: "Company" })).toMatchObject({ wallVisible: false, passVisible: false });
  });
});
