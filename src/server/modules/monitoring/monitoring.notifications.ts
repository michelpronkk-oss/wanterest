import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { getEmailProvider } from "@/server/providers/email";
import { SupabaseActionRepository } from "@/server/modules/actions/action.repository";
import { Phase4DigestSource, DigestService } from "@/server/modules/digests/digest.service";
import { SupabaseDemandRepository } from "@/server/modules/demand-intelligence/demand.repository";
import { SupabaseIntelligenceRepository } from "@/server/modules/intelligence/intelligence.repository";
import { resolveMonitoringPolicy } from "@/server/modules/entitlements/monitoring-policy";

type Client = SupabaseClient<Database>;

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }
function dayStart(now: string): string { return `${now.slice(0, 10)}T00:00:00.000Z`; }
function dayEnd(now: string): string { const value = new Date(dayStart(now)); value.setUTCDate(value.getUTCDate() + 1); return value.toISOString(); }

async function workspaceRecipientEmails(client: Client, workspaceId: string): Promise<string[]> {
  const members = await client.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("status", "active").in("role", ["owner", "admin"]);
  const emails: string[] = [];
  for (const member of members.data ?? []) {
    const user = await client.auth.admin.getUserById(member.user_id);
    const email = user.data.user?.email;
    if (email && !emails.includes(email)) emails.push(email);
  }
  return emails;
}

export async function materializeMonitoringNotifications(input: { workspaceId: string; productId: string; completedAt?: string }): Promise<void> {
  const client = createSupabaseServiceClient();
  const now = input.completedAt ?? new Date().toISOString();
  const policy = await resolveMonitoringPolicy(client, input.workspaceId);
  if (!policy.digestEnabled && !policy.priorityAlertsEnabled) return;

  if (policy.digestEnabled) {
    const digestService = new DigestService(
      new SupabaseActionRepository(client),
      new Phase4DigestSource(new SupabaseIntelligenceRepository(client), new SupabaseDemandRepository(client)),
    );
    const digest = await digestService.buildDigest({
      workspaceId: input.workspaceId,
      productId: input.productId,
      periodStart: dayStart(now),
      periodEnd: dayEnd(now),
      digestType: "daily",
      renderVersion: "monitoring-v1",
      engineVersionId: null,
    });
    const members = await client.from("workspace_members").select("user_id").eq("workspace_id", input.workspaceId).eq("status", "active").in("role", ["owner", "admin"]);
    for (const member of members.data ?? []) {
      const user = await client.auth.admin.getUserById(member.user_id);
      const email = user.data.user?.email ?? null;
      await client.from("digest_deliveries").upsert({
        workspace_id: input.workspaceId,
        digest_id: digest.digest.id,
        recipient_user_id: member.user_id,
        recipient_email: email,
        status: "pending",
        idempotency_key: `digest-delivery:${digest.digest.id}:${member.user_id}`,
      }, { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true });
    }
  }

  if (policy.priorityAlertsEnabled) await materializePriorityAlerts(client, input.workspaceId, input.productId, dayStart(now));
}

async function materializePriorityAlerts(client: Client, workspaceId: string, productId: string, since: string): Promise<void> {
  const signals = await client.from("signals").select("id,evidence_node_id,intent_type,tags,match_ranking_id,created_at").eq("workspace_id", workspaceId).eq("product_id", productId).gte("created_at", since).order("created_at", { ascending: false }).limit(100);
  if (signals.error) throw new Error("Priority signal alerts could not be loaded.");
  const signalIds = (signals.data ?? []).map((signal) => signal.match_ranking_id);
  const rankings = signalIds.length ? await client.from("match_rankings").select("id,opportunity_score").in("id", signalIds) : { data: [], error: null };
  const scoreById = new Map((rankings.data ?? []).map((ranking) => [ranking.id, ranking.opportunity_score]));
  for (const signal of signals.data ?? []) {
    const score = scoreById.get(signal.match_ranking_id) ?? 0;
    const tags = Array.isArray(signal.tags) ? signal.tags.filter((tag): tag is string => typeof tag === "string") : [];
    const intents = new Set(["high_intent", "switching_intent", "alternative_search", "comparison_intent"]);
    const candidates: Array<{ type: "new_high_confidence_signal" | "strong_intent" | "new_competitor"; key: string }> = [];
    if (score >= 0.75) candidates.push({ type: "new_high_confidence_signal", key: `signal-high:${signal.id}` });
    if (intents.has(signal.intent_type)) candidates.push({ type: "strong_intent", key: `signal-intent:${signal.id}` });
    if (tags.some((tag) => /competitor|alternative/i.test(tag))) candidates.push({ type: "new_competitor", key: `signal-competitor:${signal.id}` });
    for (const candidate of candidates) {
      await client.from("monitoring_alerts").upsert({ workspace_id: workspaceId, product_id: productId, alert_type: candidate.type, target_id: signal.id, evidence_node_id: signal.evidence_node_id, severity: "high", status: "pending", idempotency_key: candidate.key }, { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true });
    }
  }
  const drifts = await client.from("demand_drifts").select("id,evidence_node_id,significance,created_at").eq("workspace_id", workspaceId).eq("product_id", productId).gte("created_at", since).eq("significance", "strong").limit(50);
  for (const drift of drifts.data ?? []) {
    await client.from("monitoring_alerts").upsert({ workspace_id: workspaceId, product_id: productId, alert_type: "significant_demand_drift", target_id: drift.id, evidence_node_id: drift.evidence_node_id, severity: "high", status: "pending", idempotency_key: `drift-strong:${drift.id}` }, { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true });
  }
}

export async function deliverPendingMonitoringNotifications(input: { limit?: number } = {}): Promise<{ sent: number; failed: number; pending: number }> {
  const client = createSupabaseServiceClient();
  const provider = getEmailProvider();
  const now = new Date().toISOString();
  const limit = input.limit ?? 50;
  const deliveries = await client.from("digest_deliveries").select("*").eq("status", "pending").lte("next_attempt_at", now).order("created_at", { ascending: true }).limit(limit);
  const alerts = await client.from("monitoring_alerts").select("*").eq("status", "pending").order("created_at", { ascending: true }).limit(limit);
  let sent = 0;
  let failed = 0;
  let pending = 0;
  for (const delivery of deliveries.data ?? []) {
    if (!delivery.recipient_email) {
      await client.from("digest_deliveries").update({ status: "failed", last_error: "Recipient email is unavailable.", attempt_count: delivery.attempt_count + 1 }).eq("id", delivery.id);
      failed += 1;
      continue;
    }
    const digest = await client.from("digests").select("summary,structured_content").eq("workspace_id", delivery.workspace_id).eq("id", delivery.digest_id).maybeSingle();
    if (digest.error || !digest.data) {
      await client.from("digest_deliveries").update({ status: "failed", last_error: "Digest could not be loaded.", attempt_count: delivery.attempt_count + 1 }).eq("id", delivery.id);
      failed += 1;
      continue;
    }
    const subject = "Your Wanterest market intelligence update";
    const summary = digest.data.summary;
    const result = await provider.send({ to: delivery.recipient_email, subject, text: summary, html: `<p>${escapeHtml(summary)}</p>` });
    if (result.ok) {
      await client.from("digest_deliveries").update({ status: "sent", sent_at: now, attempt_count: delivery.attempt_count + 1, last_error: null }).eq("id", delivery.id);
      sent += 1;
    } else {
      const retryAt = new Date(Date.parse(now) + Math.min(6 * 60 * 60_000, 5 * 60_000 * 2 ** Math.min(delivery.attempt_count, 6))).toISOString();
      await client.from("digest_deliveries").update({ status: result.code === "NOT_CONFIGURED" ? "failed" : "pending", last_error: result.message.slice(0, 500), attempt_count: delivery.attempt_count + 1, next_attempt_at: retryAt }).eq("id", delivery.id);
      if (result.code === "NOT_CONFIGURED") failed += 1;
      else pending += 1;
    }
  }
  for (const alert of alerts.data ?? []) {
    const recipients = await workspaceRecipientEmails(client, alert.workspace_id);
    if (!recipients.length) {
      await client.from("monitoring_alerts").update({ status: "failed", last_error: "No active alert recipient is available.", attempt_count: alert.attempt_count + 1 }).eq("id", alert.id);
      failed += 1;
      continue;
    }
    const label = alert.alert_type.replaceAll("_", " ");
    const results = await Promise.all(recipients.map((to) => provider.send({
      to,
      subject: `Wanterest priority alert: ${label}`,
      text: `Wanterest detected a ${label} for a monitored product. Open Wanterest to review the evidence.`,
      html: `<p>Wanterest detected a ${escapeHtml(label)} for a monitored product. Open Wanterest to review the evidence.</p>`,
    })));
    const successful = results.filter((result) => result.ok).length;
    const providerFailure = results.find((result) => !result.ok);
    if (successful > 0) {
      await client.from("monitoring_alerts").update({ status: "sent", sent_at: now, attempt_count: alert.attempt_count + 1, last_error: null }).eq("id", alert.id);
      sent += 1;
    } else {
      const failure = providerFailure && !providerFailure.ok ? providerFailure : { code: "PROVIDER_FAILED" as const, message: "Alert delivery failed." };
      await client.from("monitoring_alerts").update({ status: failure.code === "NOT_CONFIGURED" ? "failed" : "pending", last_error: failure.message.slice(0, 500), attempt_count: alert.attempt_count + 1 }).eq("id", alert.id);
      if (failure.code === "NOT_CONFIGURED") failed += 1;
      else pending += 1;
    }
  }
  return { sent, failed, pending };
}
