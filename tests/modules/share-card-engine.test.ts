import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/server/lib/errors";
import type { ShareCardAuthorityAdapter } from "../../src/server/modules/share-cards/share-card.authority";
import type {
  PublicShareCard,
  ShareCardAuthority,
  ShareCardPublication,
  ShareCardSnapshot,
} from "../../src/server/modules/share-cards";
import type { ShareCardRepository } from "../../src/server/modules/share-cards/share-card.repository";

vi.mock("server-only", () => ({}));
const { DynamicShareCardService } = await import("../../src/server/modules/share-cards/share-card.service");

const applicantId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";

function authority(variant: ShareCardAuthority["variant"], ownerKind: "applicant" | "workspace" = "applicant"): ShareCardAuthority {
  const identityNumber = variant === "FOUNDING_25" ? 7 : variant === "EARLY_100" ? 42 : 1234;
  const snapshot: ShareCardSnapshot = {
    displayName: ownerKind === "workspace" ? "Acme" : "Wanterest member",
    headline: null,
    identityLabel: variant === "FOUNDING_25" ? "Founding 25" : variant === "EARLY_100" ? "Early 100" : variant === "PRIORITY_ACCESS" ? "Priority Access" : "Early Access",
    identityNumber,
    tone: variant === "FOUNDING_25" ? "founding" : variant === "EARLY_100" ? "early" : variant === "PRIORITY_ACCESS" ? "priority" : "neutral",
    isPermanent: variant !== "PRIORITY_ACCESS",
    monogram: ownerKind === "workspace" ? "AC" : null,
    admittedOn: ownerKind === "workspace" ? "2026-03-14" : null,
  };
  return { ownerKind, ownerId: ownerKind === "workspace" ? workspaceId : applicantId, workspaceId: ownerKind === "workspace" ? workspaceId : null, waitlistApplicationId: ownerKind === "applicant" ? applicantId : null, variant, snapshot };
}

function publication(input: { variant: ShareCardAuthority["variant"]; state?: "published" | "revoked"; snapshot: ShareCardSnapshot }): ShareCardPublication {
  return { id: `${input.variant}-id`, workspaceId: null, waitlistApplicationId: applicantId, variant: input.variant, publicSlug: `${input.variant}-abcdefghijklmnopqrstuvwxyz123456`, publicationState: input.state ?? "published", snapshot: input.snapshot, publishedAt: "2026-09-28T00:00:00.000Z", revokedAt: input.state === "revoked" ? "2026-09-28T01:00:00.000Z" : null };
}

function harness(authorities: ShareCardAuthority[]) {
  const publications: ShareCardPublication[] = [];
  const authorityAdapter: ShareCardAuthorityAdapter = {
    async getApplicantCards() { return authorities.filter((item) => item.ownerKind === "applicant"); },
    async authorizeWorkspace() {},
    async getWorkspaceCards() { return authorities.filter((item) => item.ownerKind === "workspace"); },
  };
  const repository: ShareCardRepository = {
    async listPublications(owner) { return publications.filter((row) => row.workspaceId === (owner.workspaceId ?? null) && row.waitlistApplicationId === (owner.waitlistApplicationId ?? null)); },
    async publish(input) {
      const existing = publications.find((row) => row.variant === input.variant);
      const row = publication({ variant: input.variant, snapshot: input.snapshot });
      if (existing) Object.assign(existing, row);
      else publications.push(row);
      return existing ?? row;
    },
    async revoke(input) {
      const existing = publications.find((row) => row.variant === input.variant);
      if (existing) existing.publicationState = "revoked";
      return existing ?? null;
    },
    async getPublic() { return null as PublicShareCard | null; },
    async recordEvent() {},
  };
  return { service: new DynamicShareCardService(repository, authorityAdapter), publications };
}

describe("Layer 13B.1 dynamic share-card engine", () => {
  it("keeps an unverified applicant completely ineligible", async () => {
    const { service } = harness([]);
    await expect(service.getApplicantCards("status-token")).resolves.toEqual([]);
  });

  it("uses the exact verified Early Access number and remains private by default", async () => {
    const { service } = harness([authority("EARLY_ACCESS")]);
    const [card] = await service.getApplicantCards("status-token");
    expect(card.identityNumber).toBe(1234);
    expect(card.publicationId).toBeNull();
    expect(card.publicSlug).toBeNull();
  });

  it("exposes Priority only while the authority adapter says it is granted", async () => {
    const granted = harness([authority("EARLY_ACCESS"), authority("PRIORITY_ACCESS")]);
    await expect(granted.service.getApplicantCards("status-token")).resolves.toHaveLength(2);
    const revoked = harness([authority("EARLY_ACCESS")]);
    await expect(revoked.service.getApplicantCards("status-token")).resolves.toHaveLength(1);
  });

  it("keeps Founding 25 and Early 100 namespaces distinct", async () => {
    const founding = harness([authority("FOUNDING_25", "workspace")]);
    const early = harness([authority("EARLY_100", "workspace")]);
    expect((await founding.service.getWorkspaceCards(workspaceId, "user")).map((row) => [row.variant, row.identityNumber])).toEqual([["FOUNDING_25", 7]]);
    expect((await early.service.getWorkspaceCards(workspaceId, "user")).map((row) => [row.variant, row.identityNumber])).toEqual([["EARLY_100", 42]]);
  });

  it("publishes only after an explicit mutation and supports idempotent revoke", async () => {
    const { service, publications } = harness([authority("EARLY_ACCESS")]);
    expect(publications).toHaveLength(0);
    const published = await service.publishApplicant("status-token", "EARLY_ACCESS");
    expect(published.publicationState).toBe("published");
    expect(published.publicSlug).toBeTruthy();
    expect(publications).toHaveLength(1);
    await service.revokeApplicant("status-token", "EARLY_ACCESS");
    await service.revokeApplicant("status-token", "EARLY_ACCESS");
    expect(publications[0]?.publicationState).toBe("revoked");
  });

  it("rejects publishing a variant absent from the authoritative source", async () => {
    const { service } = harness([authority("EARLY_ACCESS")]);
    await expect(service.publishApplicant("status-token", "FOUNDING_25")).rejects.toBeInstanceOf(AppError);
  });
});

describe("Layer 13B.1 share-card repository", () => {
  it("stores snapshots with the snake_case keys the public RPC projects", async () => {
    const { createSupabaseShareCardRepository } = await import("../../src/server/modules/share-cards/share-card.repository");
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const row = {
      id: "33333333-3333-4333-8333-333333333333",
      workspace_id: workspaceId,
      waitlist_application_id: null,
      variant: "FOUNDING_25",
      public_slug: "abcdefghijklmnopqrstuvwxyz0123456789",
      publication_state: "published",
      snapshot: null as unknown,
      published_at: "2026-09-28T00:00:00.000Z",
      revoked_at: null,
    };
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        row.snapshot = args.p_snapshot;
        return { data: [row], error: null };
      },
    };
    const repository = createSupabaseShareCardRepository(client as never);
    const published = await repository.publish({ workspaceId, variant: "FOUNDING_25", publicSlug: row.public_slug, snapshot: authority("FOUNDING_25", "workspace").snapshot });
    expect(calls[0]?.args.p_snapshot).toEqual({
      display_name: "Acme",
      headline: null,
      identity_label: "Founding 25",
      identity_number: 7,
      tone: "founding",
      is_permanent: true,
      monogram: "AC",
      admitted_on: "2026-03-14",
    });
    expect(published.snapshot.displayName).toBe("Acme");
    expect(published.snapshot.admittedOn).toBe("2026-03-14");
  });
});
