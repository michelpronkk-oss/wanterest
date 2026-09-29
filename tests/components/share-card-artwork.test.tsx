import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ShareCardArtwork } from "@/components/share-cards/share-card-artwork";
import {
  formatAdmitted,
  formatCohortSeat,
  formatEarlyAccessNumber,
  shareCardLine,
  shareCardShareText,
} from "@/shared/share-card-presentation";

vi.mock("server-only", () => ({}));

const founding = { variant: "FOUNDING_25" as const, identityNumber: 7, displayName: "Auterim", monogram: "A", admittedOn: "2026-03-14" };
const early = { variant: "EARLY_100" as const, identityNumber: 42, displayName: "Auterim", monogram: "AU", admittedOn: "2026-03-14" };
const priority = { variant: "PRIORITY_ACCESS" as const, identityNumber: 184, displayName: "Wanterest member" };
const earlyAccess = { variant: "EARLY_ACCESS" as const, identityNumber: 184, displayName: "Wanterest member" };

describe("Board 15 share-card copy", () => {
  it("formats numbers in each namespace", () => {
    expect(formatCohortSeat("FOUNDING_25", 7)).toBe("07");
    expect(formatCohortSeat("EARLY_100", 42)).toBe("042");
    expect(formatEarlyAccessNumber(184)).toBe("#0184");
    expect(formatAdmitted("2026-03-14")).toBe("Admitted March 2026");
    expect(formatAdmitted(null)).toBeNull();
  });

  it("uses the board's supporting lines and share text", () => {
    expect(shareCardLine("FOUNDING_25", 7)).toBe("One of the first 25 workspaces on Wanterest.");
    expect(shareCardLine("EARLY_100", 42)).toBe("Among the first 125 workspaces on Wanterest.");
    expect(shareCardLine("PRIORITY_ACCESS", 184)).toBe("Early access #0184 · moved up the queue.");
    expect(shareCardLine("EARLY_ACCESS", 184)).toBe("On the list for Wanterest.");
    expect(shareCardShareText("FOUNDING_25", 7).ogTitle).toBe("Founding Member 07/25 · Wanterest");
  });
});

describe("Board 15 share-card artwork", () => {
  it("renders the Founding card with the lit Apex, seat, workspace and admission month", () => {
    const html = renderToStaticMarkup(<ShareCardArtwork data={founding} format="landscape" />);
    expect(html).toContain("FOUNDING MEMBER");
    expect(html).toContain(">07<");
    expect(html).toContain(">/25<");
    expect(html).toContain("Auterim");
    expect(html).toContain("Admitted March 2026");
    expect(html).toContain('fill="#D7FF3D"');
  });

  it("keeps lime exclusive to the Founding Apex (Early 100 Apex and the wordmark are ink)", () => {
    for (const data of [early, priority, earlyAccess]) {
      for (const format of ["landscape", "portrait", "square"] as const) {
        expect(renderToStaticMarkup(<ShareCardArtwork data={data} format={format} />)).not.toContain("#D7FF3D");
      }
    }
  });

  it("renders the Priority and Early Access status cards", () => {
    const priorityHtml = renderToStaticMarkup(<ShareCardArtwork data={priority} format="square" />);
    expect(priorityHtml).toContain("WANTEREST WAITLIST");
    expect(priorityHtml).toContain(">Priority<");
    expect(priorityHtml).toContain("Early access #0184 · moved up the queue.");
    const accessHtml = renderToStaticMarkup(<ShareCardArtwork data={earlyAccess} format="landscape" />);
    expect(accessHtml).toContain(">#<");
    expect(accessHtml).toContain(">0184<");
    expect(accessHtml).toContain("On the list for Wanterest.");
  });

  it("puts the members URL only on portrait and square formats", () => {
    expect(renderToStaticMarkup(<ShareCardArtwork data={early} format="portrait" />)).toContain("wanterest.com/members");
    expect(renderToStaticMarkup(<ShareCardArtwork data={early} format="landscape" />)).not.toContain("wanterest.com/members");
  });

  it("never renders a company logo URL (logos are not fetched server-side)", () => {
    const html = renderToStaticMarkup(<ShareCardArtwork data={founding} format="portrait" />);
    expect(html).not.toContain("<img");
  });
});

describe("share-card rendering contracts", () => {
  it("bundles the OFL brand fonts the PNG renderer reads", () => {
    const renderer = readFileSync(join(process.cwd(), "src/app/share/_lib/share-card-image.tsx"), "utf8");
    for (const file of ["Archivo-800.ttf", "Archivo-700.ttf", "Sora-600.ttf", "Inter-400.ttf", "Inter-700.ttf"]) {
      expect(renderer).toContain(file);
      expect(readFileSync(join(process.cwd(), "assets/fonts", file)).byteLength).toBeGreaterThan(10_000);
    }
    expect(readFileSync(join(process.cwd(), "next.config.ts"), "utf8")).toContain('"/share/**": ["./assets/fonts/*.ttf"]');
  });

  it("serves applicant share mutations under the status cookie's /waitlist path", () => {
    const route = readFileSync(join(process.cwd(), "src/app/waitlist/share-cards/route.ts"), "utf8");
    expect(route).toContain("mutateApplicantShareCardCommand");
    expect(readFileSync(join(process.cwd(), "src/components/waitlist/share-my-place.tsx"), "utf8")).toContain('"/waitlist/share-cards"');
  });
});
