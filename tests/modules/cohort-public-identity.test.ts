import { describe, expect, it } from "vitest";

import { selectPublicMemberIdentity } from "@/server/modules/cohort-public/cohort-public.identity";
import type { PublicCohortRow } from "@/server/modules/cohort-public/cohort-public.schemas";

const row: PublicCohortRow = {
  publicSlug: "northwind",
  displayName: "Northwind",
  logoUrl: null,
  avatarUrl: null,
  monogram: "N",
  headline: null,
  websiteUrl: null,
  cohort: "founding_25",
  number: 1,
  limit: 25,
  assignedAt: "2026-09-28T00:00:00.000Z",
};

describe("public member identity contract", () => {
  it("selects only public profile fields in the documented hierarchy", () => {
    expect(selectPublicMemberIdentity({ ...row, logoUrl: "https://assets.example.com/logo.png", avatarUrl: "https://assets.example.com/avatar.png" }).assets).toEqual([
      { kind: "company_logo", url: "https://assets.example.com/logo.png" },
      { kind: "profile_avatar", url: "https://assets.example.com/avatar.png" },
      { kind: "monogram", value: "N" },
      { kind: "placeholder" },
    ]);
  });

  it("falls through to the authoritative monogram, then a neutral placeholder", () => {
    expect(selectPublicMemberIdentity(row).assets).toEqual([{ kind: "monogram", value: "N" }, { kind: "placeholder" }]);
    expect(selectPublicMemberIdentity({ ...row, monogram: null }).assets).toEqual([{ kind: "placeholder" }]);
  });

  it("does not pass credential-bearing or non-HTTPS URLs to public markup", () => {
    expect(selectPublicMemberIdentity({ ...row, logoUrl: "https://token@example.com/logo.png", avatarUrl: "http://assets.example/avatar.png" }).assets).toEqual([
      { kind: "monogram", value: "N" },
      { kind: "placeholder" },
    ]);
  });
});
