import { describe, expect, it } from "vitest";

import { isValidOnboardingDescription, isValidOnboardingProductForm, isValidOnboardingWebsiteInput } from "../../src/components/onboarding/form-validation";

describe("onboarding Step 2 client validity", () => {
  it("enables submission for accepted public website forms", () => {
    const description = "We help operations teams automate manual work.";
    for (const website of ["acme.com", "https://acme.com", "www.acme.com", "app.acme.com"]) {
      expect(isValidOnboardingProductForm(website, description)).toBe(true);
    }
  });

  it("rejects invalid websites without relying on normalization", () => {
    for (const website of ["acme", "localhost", "acme .com", "ftp://acme.com", "https://"]) {
      expect(isValidOnboardingWebsiteInput(website)).toBe(false);
    }
  });

  it("requires a 15–240 character trimmed description", () => {
    expect(isValidOnboardingDescription("too short")).toBe(false);
    expect(isValidOnboardingDescription("A useful one-line description.")).toBe(true);
    expect(isValidOnboardingDescription("x".repeat(241))).toBe(false);
  });

  it("re-enables the form when corrected values are valid", () => {
    expect(isValidOnboardingProductForm("acme", "A useful one-line description.")).toBe(false);
    expect(isValidOnboardingProductForm("acme.com", "short")).toBe(false);
    expect(isValidOnboardingProductForm("acme.com", "A useful one-line description.")).toBe(true);
  });
});
