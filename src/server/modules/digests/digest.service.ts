import { AppError } from "../../lib/errors";
import { jsonValueSchema, type DigestItemRow, type DigestRow, type Json } from "../../db/database.helpers";
import { deterministicUuid, sha256Json } from "../ingestion/hash";
import type { ActionRepository } from "../actions";
import type { DemandRepository } from "../demand-intelligence";
import type { IntelligenceRepository } from "../intelligence";
import type { DigestItemType, DigestType } from "../actions/action.schemas";
import { digestBuildInputSchema, type DigestBuildInput } from "../actions/action.schemas";

export type DigestCandidate = {
  itemType: DigestItemType;
  itemId: string;
  sourceEvidenceNodeId: string;
  score: number;
  reason: string;
  createdAt?: string;
  warning?: string;
};

export type DigestSource = {
  listCandidates(input: { workspaceId: string; productId?: string | null; periodStart: string; periodEnd: string }): Promise<DigestCandidate[]>;
  listWarnings?(input: { workspaceId: string; productId?: string | null; periodStart: string; periodEnd: string }): Promise<string[]>;
};

export type DigestReadModel = {
  digest: DigestRow;
  items: DigestItemRow[];
  warnings: string[];
  provenance: { digestEvidenceNodeId: string; sourceEvidenceNodeIds: string[] };
};

function json(value: unknown): Json { return jsonValueSchema.parse(value); }
function digestKey(input: DigestBuildInput): string { return `digest:${input.workspaceId}:${input.productId ?? "workspace"}:${input.digestType}:${input.periodStart}:${input.periodEnd}:${input.renderVersion}`; }

export class DigestService {
  constructor(private readonly repository: ActionRepository, private readonly source: DigestSource = new EmptyDigestSource()) {}

  async buildDigest(rawInput: DigestBuildInput): Promise<DigestReadModel> {
    const input = digestBuildInputSchema.parse(rawInput);
    if (new Date(input.periodEnd) <= new Date(input.periodStart)) throw new AppError("VALIDATION_ERROR", "Digest period must end after it starts.");
    const idempotencyKey = digestKey(input);
    const existing = await this.repository.findDigest(input.workspaceId, idempotencyKey);
    if (existing) return this.readModel(existing);

    const sourceInput = { workspaceId: input.workspaceId, productId: input.productId, periodStart: input.periodStart, periodEnd: input.periodEnd };
    const [candidates, sourceWarnings] = await Promise.all([this.source.listCandidates(sourceInput), this.source.listWarnings?.(sourceInput) ?? Promise.resolve([])]);
    const actions = input.productId ? await this.repository.listActions(input.workspaceId, input.productId, { stale: false }) : [];
    const actionCandidates: DigestCandidate[] = actions
      .filter((action) => action.status !== "dismissed" && action.status !== "superseded")
      .filter((action) => action.created_at >= input.periodStart && action.created_at < input.periodEnd)
      .map((action) => ({ itemType: "action", itemId: action.id, sourceEvidenceNodeId: action.evidence_node_id, score: action.priority_score, reason: action.summary, createdAt: action.created_at }));
    const selected = selectDigestCandidates([...candidates, ...actionCandidates], input.digestType === "daily" ? 12 : 20);
    const warnings = [...sourceWarnings, ...selected.map((candidate) => candidate.warning).filter((warning): warning is string => Boolean(warning))];
    const grouped = {
      signals: selected.filter((item) => item.itemType === "signal").map((item) => item.itemId),
      themes: selected.filter((item) => item.itemType === "theme").map((item) => item.itemId),
      gaps: selected.filter((item) => item.itemType === "gap").map((item) => item.itemId),
      drift: selected.filter((item) => item.itemType === "drift").map((item) => item.itemId),
      actions: selected.filter((item) => item.itemType === "action").map((item) => item.itemId),
      warnings: [...new Set(warnings)],
    };
    const summary = buildSummary(grouped, input.digestType);
    const digest = await this.repository.createDigest({
      id: deterministicUuid(idempotencyKey),
      workspace_id: input.workspaceId,
      product_id: input.productId ?? null,
      evidence_node_id: deterministicUuid(`evidence:digest:${idempotencyKey}`),
      period_start: input.periodStart,
      period_end: input.periodEnd,
      digest_type: input.digestType,
      render_version: input.renderVersion,
      status: "materialized",
      summary,
      structured_content: json({ headline: summary, ...grouped }),
      engine_version_id: input.engineVersionId ?? null,
      idempotency_key: idempotencyKey,
      sent_at: null,
    });
    for (const [position, candidate] of selected.entries()) {
      await this.repository.createDigestItem({
        id: deterministicUuid(`digest-item:${digest.id}:${candidate.itemType}:${candidate.itemId}`),
        workspace_id: input.workspaceId,
        digest_id: digest.id,
        item_type: candidate.itemType,
        item_id: candidate.itemId,
        source_evidence_node_id: candidate.sourceEvidenceNodeId,
        position,
        reason: candidate.reason,
      });
      await this.repository.linkProvenance({ derivedEvidenceNodeId: digest.evidence_node_id, sourceEvidenceNodeId: candidate.sourceEvidenceNodeId, relationType: "includes_digest_item", ordinal: position, engineVersionId: digest.engine_version_id });
    }
    return this.readModel(digest);
  }

  async getDigest(workspaceId: string, digestId: string): Promise<DigestReadModel> {
    const digest = await this.repository.getDigest(workspaceId, digestId);
    if (!digest) throw new AppError("NOT_FOUND", "Digest was not found.");
    return this.readModel(digest);
  }

  async listDigests(workspaceId: string, productId?: string | null): Promise<DigestReadModel[]> {
    const digests = await this.repository.listDigests(workspaceId, productId);
    return Promise.all(digests.map((digest) => this.readModel(digest)));
  }

  async markSent(workspaceId: string, digestId: string, sentAt = new Date().toISOString()): Promise<DigestReadModel> {
    return this.readModel(await this.repository.markDigestSent(workspaceId, digestId, sentAt));
  }

  private async readModel(digest: DigestRow): Promise<DigestReadModel> {
    const items = await this.repository.listDigestItems(digest.workspace_id, digest.id);
    const content = digest.structured_content && typeof digest.structured_content === "object" && !Array.isArray(digest.structured_content) ? digest.structured_content as Record<string, unknown> : {};
    const warnings = Array.isArray(content.warnings) ? content.warnings.filter((item): item is string => typeof item === "string") : [];
    return { digest, items, warnings, provenance: { digestEvidenceNodeId: digest.evidence_node_id, sourceEvidenceNodeIds: items.map((item) => item.source_evidence_node_id) } };
  }
}

export function selectDigestCandidates(candidates: DigestCandidate[], limit: number): DigestCandidate[] {
  const seen = new Set<string>();
  return [...candidates]
    .filter((candidate) => candidate.itemId && candidate.sourceEvidenceNodeId)
    .sort((a, b) => b.score - a.score || (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || a.itemType.localeCompare(b.itemType) || a.itemId.localeCompare(b.itemId))
    .filter((candidate) => {
      const key = `${candidate.itemType}:${candidate.itemId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function buildSummary(grouped: { signals: string[]; themes: string[]; gaps: string[]; drift: string[]; actions: string[]; warnings: string[] }, digestType: DigestType): string {
  const period = digestType === "daily" ? "Today" : "This week";
  const parts = [`${period}: ${grouped.actions.length} recommended action${grouped.actions.length === 1 ? "" : "s"}`];
  if (grouped.gaps.length) parts.push(`${grouped.gaps.length} demand gap${grouped.gaps.length === 1 ? "" : "s"}`);
  if (grouped.drift.length) parts.push(`${grouped.drift.length} meaningful demand change${grouped.drift.length === 1 ? "" : "s"}`);
  if (grouped.signals.length) parts.push(`${grouped.signals.length} qualified signal${grouped.signals.length === 1 ? "" : "s"}`);
  if (grouped.warnings.length) parts.push(`${grouped.warnings.length} sample warning${grouped.warnings.length === 1 ? "" : "s"}`);
  return `${parts.join("; ")}.`;
}

export class EmptyDigestSource implements DigestSource {
  async listCandidates(): Promise<DigestCandidate[]> { return []; }
}

export class InMemoryDigestSource implements DigestSource {
  candidates: DigestCandidate[] = [];
  warnings: string[] = [];
  async listCandidates(): Promise<DigestCandidate[]> { return [...this.candidates]; }
  async listWarnings(): Promise<string[]> { return [...this.warnings]; }
}

/** Provider-neutral bridge from the Phase 3/4 read repositories into digest selection. */
export class Phase4DigestSource implements DigestSource {
  constructor(private readonly intelligence: IntelligenceRepository, private readonly demand: DemandRepository) {}

  async listCandidates(input: { workspaceId: string; productId?: string | null; periodStart: string; periodEnd: string }): Promise<DigestCandidate[]> {
    if (!input.productId) return [];
    const candidates: DigestCandidate[] = [];
    const signals = await this.intelligence.listSignals(input.workspaceId, input.productId);
    for (const signal of signals.slice(0, 50)) {
      const ranking = await this.intelligence.getRankingById(signal.match_ranking_id);
      const date = signal.published_at ?? signal.created_at;
      if (date >= input.periodStart && date < input.periodEnd) candidates.push({ itemType: "signal", itemId: signal.id, sourceEvidenceNodeId: signal.evidence_node_id, score: ranking?.opportunity_score ?? 0, reason: signal.why_it_matters, createdAt: date });
    }
    const snapshots = (await this.demand.listSnapshots(input.workspaceId, input.productId)).filter((snapshot) => snapshot.period_end >= input.periodStart && snapshot.period_end < input.periodEnd).slice(0, 5);
    for (const snapshot of snapshots) {
      const themes = await this.demand.listSnapshotThemes(snapshot.id);
      for (const theme of themes.slice(0, 5)) candidates.push({ itemType: "theme", itemId: theme.id, sourceEvidenceNodeId: theme.evidence_node_id, score: theme.share_of_demand * theme.confidence, reason: `${theme.theme_key} represents ${Math.round(theme.share_of_demand * 100)}% of observed demand.`, createdAt: theme.created_at });
    }
    const gaps = await this.demand.listGaps(input.workspaceId, input.productId);
    for (const gap of gaps.filter((row) => row.created_at >= input.periodStart && row.created_at < input.periodEnd).slice(0, 10)) candidates.push({ itemType: "gap", itemId: gap.id, sourceEvidenceNodeId: gap.evidence_node_id, score: gap.gap_score, reason: gap.interpretation, createdAt: gap.created_at });
    const drifts = await this.demand.listDrifts(input.workspaceId, input.productId);
    for (const drift of drifts.filter((row) => row.created_at >= input.periodStart && row.created_at < input.periodEnd).slice(0, 10)) candidates.push({ itemType: "drift", itemId: drift.id, sourceEvidenceNodeId: drift.evidence_node_id, score: Math.abs(drift.share_delta) * drift.confidence, reason: `${drift.concept_key} is ${drift.drift_direction} with ${drift.significance} significance.`, createdAt: drift.created_at });
    return candidates;
  }

  async listWarnings(input: { workspaceId: string; productId?: string | null; periodStart: string; periodEnd: string }): Promise<string[]> {
    if (!input.productId) return [];
    const snapshots = (await this.demand.listSnapshots(input.workspaceId, input.productId)).filter((snapshot) => snapshot.period_end >= input.periodStart && snapshot.period_end < input.periodEnd);
    return snapshots.filter((snapshot) => snapshot.measurement_quality !== "normal" && snapshot.measurement_quality !== "high_confidence").map((snapshot) => `Demand snapshot ${snapshot.id} has ${snapshot.measurement_quality} sample quality.`);
  }
}

export function digestInputFingerprint(input: DigestBuildInput): string { return sha256Json(input); }
