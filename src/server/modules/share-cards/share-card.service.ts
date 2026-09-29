import "server-only";

import { randomBytes } from "node:crypto";

import { AppError } from "@/server/lib/errors";
import { SITE_ORIGIN } from "@/shared/config/site";
import { shareCardShareText } from "@/shared/share-card-presentation";
import { createSupabaseShareCardAuthorityAdapter, type ShareCardAuthorityAdapter } from "./share-card.authority";
import { createSupabaseShareCardRepository, type ShareCardRepository } from "./share-card.repository";
import {
  type PublicShareCard,
  type ShareCardAuthority,
  type ShareCardPreview,
  type ShareCardPublication,
  type ShareCardVariant,
} from "./share-card.schemas";

function newPublicSlug(): string {
  return randomBytes(32).toString("base64url");
}

function preview(authority: ShareCardAuthority, publication: ShareCardPublication | null): ShareCardPreview {
  return {
    ...authority.snapshot,
    variant: authority.variant,
    publicationId: publication?.id ?? null,
    publicSlug: publication?.publicationState === "published" ? publication.publicSlug : null,
    publicationState: publication?.publicationState ?? null,
    publishedAt: publication?.publishedAt ?? null,
  };
}

function withPublications(authorities: ShareCardAuthority[], publications: ShareCardPublication[]): ShareCardPreview[] {
  return authorities.map((authority) => {
    return preview(authority, publications.find((publication) => publication.variant === authority.variant) ?? null);
  });
}

function findAuthority(authorities: ShareCardAuthority[], variant: ShareCardVariant): ShareCardAuthority {
  const authority = authorities.find((candidate) => candidate.variant === variant);
  if (!authority) throw new AppError("FORBIDDEN", "This share-card identity is not currently eligible.");
  return authority;
}

export type ShareCardService = {
  getApplicantCards(statusToken: string): Promise<ShareCardPreview[]>;
  publishApplicant(statusToken: string, variant: ShareCardVariant): Promise<ShareCardPreview>;
  revokeApplicant(statusToken: string, variant: ShareCardVariant): Promise<ShareCardPreview[]>;
  getWorkspaceCards(workspaceId: string, userId: string): Promise<ShareCardPreview[]>;
  publishWorkspace(workspaceId: string, userId: string, variant: ShareCardVariant): Promise<ShareCardPreview>;
  revokeWorkspace(workspaceId: string, userId: string, variant: ShareCardVariant): Promise<ShareCardPreview[]>;
  getPublicCard(publicSlug: string): Promise<PublicShareCard | null>;
  recordEvent(input: { publicSlug: string; eventType: string; source?: string | null }): Promise<void>;
};

export class DynamicShareCardService implements ShareCardService {
  constructor(
    private readonly repository: ShareCardRepository,
    private readonly authority: ShareCardAuthorityAdapter,
  ) {}

  async getApplicantCards(statusToken: string) {
    const authorities = await this.authority.getApplicantCards(statusToken);
    const applicationId = authorities[0]?.ownerId;
    if (!applicationId) return [];
    const publications = await this.repository.listPublications({ waitlistApplicationId: applicationId });
    return withPublications(authorities, publications);
  }

  async publishApplicant(statusToken: string, variant: ShareCardVariant) {
    const authorities = await this.authority.getApplicantCards(statusToken);
    const authority = findAuthority(authorities, variant);
    const publication = await this.repository.publish({
      waitlistApplicationId: authority.ownerId,
      variant,
      publicSlug: newPublicSlug(),
      snapshot: authority.snapshot,
    });
    return preview(authority, publication);
  }

  async revokeApplicant(statusToken: string, variant: ShareCardVariant) {
    const authorities = await this.authority.getApplicantCards(statusToken);
    const applicationId = authorities[0]?.ownerId;
    if (!applicationId) return [];
    await this.repository.revoke({ waitlistApplicationId: applicationId, variant });
    const publications = await this.repository.listPublications({ waitlistApplicationId: applicationId });
    return withPublications(authorities, publications);
  }

  async getWorkspaceCards(workspaceId: string, userId: string) {
    await this.authority.authorizeWorkspace(workspaceId, userId);
    const authorities = await this.authority.getWorkspaceCards(workspaceId);
    const publications = await this.repository.listPublications({ workspaceId });
    return withPublications(authorities, publications);
  }

  async publishWorkspace(workspaceId: string, userId: string, variant: ShareCardVariant) {
    await this.authority.authorizeWorkspace(workspaceId, userId);
    const authority = findAuthority(await this.authority.getWorkspaceCards(workspaceId), variant);
    const publication = await this.repository.publish({
      workspaceId,
      variant,
      publicSlug: newPublicSlug(),
      snapshot: authority.snapshot,
      actorUserId: userId,
    });
    return preview(authority, publication);
  }

  async revokeWorkspace(workspaceId: string, userId: string, variant: ShareCardVariant) {
    await this.authority.authorizeWorkspace(workspaceId, userId);
    await this.repository.revoke({ workspaceId, variant, actorUserId: userId });
    return this.getWorkspaceCards(workspaceId, userId);
  }

  async getPublicCard(publicSlug: string) {
    const card = await this.repository.getPublic(publicSlug);
    if (!card) return null;
    return {
      ...card,
      canonicalUrl: `${SITE_ORIGIN}/share/${encodeURIComponent(card.publicSlug)}`,
      ...shareCardShareText(card.variant, card.identityNumber),
    };
  }

  async recordEvent(input: { publicSlug: string; eventType: string; source?: string | null }) {
    await this.repository.recordEvent(input);
  }

}

export function createShareCardService(options?: { repository?: ShareCardRepository; authority?: ShareCardAuthorityAdapter }): ShareCardService {
  return new DynamicShareCardService(
    options?.repository ?? createSupabaseShareCardRepository(),
    options?.authority ?? createSupabaseShareCardAuthorityAdapter(),
  );
}
