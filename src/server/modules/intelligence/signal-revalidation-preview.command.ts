import "server-only";

import { createSupabaseServiceClient } from "../../providers/supabase/service";
import { SupabaseIntelligenceRepository } from "./intelligence.repository";
import { SemanticShadowReasoningRepository } from "./semantic-shadow-reasoning.repository";
import { SupabaseDemandClusteringRepository } from "../demand-intelligence/demand-clustering.repository";
import { previewWorkspaceSignalRevalidation, type SignalRevalidationPreviewClusterRepository, type SignalRevalidationPreviewIntelligenceRepository, type SignalRevalidationPreviewReport, type SignalRevalidationPreviewShadowRepository } from "./signal-revalidation-preview.service";

/**
 * The narrowest safe invocation surface for signal_revalidation_preview_v1:
 * an internal, admin-only command - never a customer-facing route, never a
 * mutation endpoint. It is NOT called from any API route, task, or scheduler
 * today; it exists so a later, explicitly authorized one-time production
 * preview has a ready invocation path, run manually in a trusted server
 * context (e.g. `npx tsx` against production credentials) rather than added
 * to the request surface. This amendment does not execute it in production.
 *
 * Only read methods from each real repository are passed through - the real
 * SupabaseIntelligenceRepository/SupabaseDemandClusteringRepository/
 * SemanticShadowReasoningRepository objects also have write methods, but this
 * function only ever destructures the specific read methods the preview's own
 * narrow types declare, so nothing here can reach a write method even though
 * the underlying client objects are capable of it.
 */
export async function runSignalRevalidationPreviewCommand(workspaceId: string): Promise<SignalRevalidationPreviewReport> {
  const client = createSupabaseServiceClient();
  const intelligenceRepository = new SupabaseIntelligenceRepository(client);
  const clusterRepository = new SupabaseDemandClusteringRepository(client);
  const shadowRepository = new SemanticShadowReasoningRepository(client);

  const intelligence: SignalRevalidationPreviewIntelligenceRepository = {
    getProduct: (id) => intelligenceRepository.getProduct(id),
    getProductSnapshots: (id) => intelligenceRepository.getProductSnapshots(id),
    getDemandProfileById: (id) => intelligenceRepository.getDemandProfileById(id),
    getConversation: (id) => intelligenceRepository.getConversation(id),
    getSourceItem: (id) => intelligenceRepository.getSourceItem(id),
    getConversationAnalysisById: (id) => intelligenceRepository.getConversationAnalysisById(id),
    getMatchById: (id) => intelligenceRepository.getMatchById(id),
    getEvaluationById: (id) => intelligenceRepository.getEvaluationById(id),
    listSignals: (ws, productId) => intelligenceRepository.listSignals(ws, productId),
  };
  const cluster: SignalRevalidationPreviewClusterRepository = {
    listClusters: (ws, productId, version) => clusterRepository.listClusters(ws, productId, version),
    listMemberships: (ws, productId, version) => clusterRepository.listMemberships(ws, productId, version),
  };
  const shadow: SignalRevalidationPreviewShadowRepository = {
    loadForReplay: (input) => shadowRepository.loadForReplay(input),
  };

  return previewWorkspaceSignalRevalidation({ intelligence, cluster, shadow, workspaceId });
}
