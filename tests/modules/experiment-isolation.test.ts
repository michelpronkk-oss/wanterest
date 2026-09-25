import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AppError } from "../../src/server/lib/errors";
import { buildMeasurementPlan } from "../../src/server/modules/experiments/measurement-plan";
import { InMemoryExperimentRepository, hashExperimentSubject } from "../../src/server/modules/experiments/experiment.repository";
import { ExperimentService } from "../../src/server/modules/experiments/experiment.service";
import { FORBIDDEN_RESULT_WORDS } from "../../src/server/modules/experiments/experiment-outcome.policy";
import { CONVERSION_METRIC_KEYS } from "../../src/server/modules/experiments/measurement.schemas";
import type { ActionRow } from "../../src/server/db/database.helpers";
import { measurementExperimentRow } from "./experiment.fixtures";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const read = (file: string) => readFileSync(file, "utf8");

describe("Layer 12 isolation: outcomes never feed back into intelligence", () => {
  it("no server module outside experiments imports the experiments module or reads experiment outcome tables", () => {
    const offenders = files("src/server/modules")
      .filter((file) => !file.includes(`${path.sep}experiments${path.sep}`))
      .filter((file) => /modules\/experiments|from "\.\.\/experiments|experiment_results|experiment_observations|experiment_arm_counts|experiment-outcome/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("query planning, candidate selection, qualification, Gap/Drift, Action eligibility/ranking, source selection and retrieval stay experiment-free", () => {
    const guarded = ["src/server/modules/actions", "src/server/modules/demand-intelligence", "src/server/modules/ingestion", "src/server/modules/intelligence", "src/server/modules/monitoring", "src/server/modules/operations"]
      .filter((dir) => { try { return statSync(dir).isDirectory(); } catch { return false; } })
      .flatMap(files);
    expect(guarded.length).toBeGreaterThan(10);
    for (const file of guarded) expect(read(file), file).not.toMatch(/\boutcome_version\b|\battribution_class\b|experiment_results|experimentOutcome/);
  });

  it("the only automatic writer is the daily experiment-measurement-pass task, and it ignores the flag (draining)", () => {
    const task = read("src/trigger/experiment-measurement.ts");
    expect(task).toContain('id: "experiment-measurement-pass"');
    expect(task).toMatch(/cron: \{ pattern: "\d+ \d+ \* \* \*", timezone: "UTC" \}/);
    expect(task).toContain("concurrencyLimit: 1");
    expect(task).not.toMatch(/getServerEnv|process\.env/);
    const pass = read("src/server/modules/experiments/measurement-pass.ts");
    expect(pass).toContain("EXPERIMENT_MEASUREMENT_PASS_LIMIT");
    expect(pass).not.toMatch(/getServerEnv|process\.env/);
    const triggerFiles = readdirSync("src/trigger").filter((name) => read(path.join("src/trigger", name)).includes("finalize") || read(path.join("src/trigger", name)).includes("runExperimentMeasurementPass"));
    expect(triggerFiles).toEqual(["experiment-measurement.ts"]);
    // No provider, LLM or network calls from the measurement code.
    for (const file of files("src/server/modules/experiments")) expect(read(file), file).not.toMatch(/fetch\(|openai|anthropic|providers\/(llm|source|search)/i);
  });
});

describe("wording: no unjustified causal or statistical claims in experiment surfaces", () => {
  const surfaces = [
    "src/components/dashboard/experiment-card.tsx", "src/components/dashboard/experiment-ghost-preview.tsx", "src/components/dashboard/inbox.ts",
    "src/app/app/(product)/experiments/page.tsx", "src/server/modules/experiments/experiment-outcome.policy.ts", "src/server/modules/experiments/measurement-plan.ts",
  ];
  it.each(surfaces)("%s carries no forbidden result vocabulary", (file) => {
    const text = read(file)
      .replace(/export const FORBIDDEN_RESULT_WORDS = \[[^\]]*\] as const;/, "")
      .toLowerCase();
    for (const word of FORBIDDEN_RESULT_WORDS) expect(text, `${word} in ${file}`).not.toMatch(new RegExp(`\\b${word}\\b`));
  });
});

describe("genericity: measurement works for any Action type and metric, with no hardcoded products or concepts", () => {
  it("builds a plan for every Action type and every registered metric", () => {
    const base = { id: "a1111111-1111-4111-8111-111111111111", proposal_fingerprint: "d".repeat(64), trigger_clustering_version: "demand_clustering_v1", target_key: "hero", title: "Any title" };
    for (const actionType of ["messaging_change", "content_angle", "landing_page", "comparison_page", "positioning_change", "offer_hypothesis", "onboarding_change", "unknown_future_type"]) {
      for (const concept of ["alpha", "beta_concept"]) {
        for (const metric of [...CONVERSION_METRIC_KEYS, "manual_custom"] as const) {
          const plan = buildMeasurementPlan({ ...base, action_type: actionType, trigger_concept_key: concept } as unknown as ActionRow, "before_after", {
            primaryMetric: metric, ...(metric === "manual_custom" ? { metricLabel: "Custom", metricUnit: "count" as const } : {}),
            measurementWindow: "30d", washoutDays: 2, successCriterion: { direction: "decrease", measure: "relative_delta", minimumEffect: 0.1 }, intervention: "change something",
          });
          expect(plan.hypothesisStructured).toMatchObject({ anchorConceptKey: concept, actionType, primaryMetric: metric });
          expect(plan.idempotencyKey.startsWith(`experiment:${base.id}:`)).toBe(true);
          expect(plan.hypothesis.length).toBeLessThanOrEqual(2_000);
        }
      }
    }
  });

  it("measurement code contains no product, customer, source or concept literals", () => {
    for (const file of files("src/server/modules/experiments").filter((name) => /measurement|outcome/.test(name))) {
      expect(read(file), file).not.toMatch(/\b(pricing|api_access|reporting|reddit|hacker ?news|bluesky|github)\b/i);
    }
  });
});

describe("public event API for measurement-v1 experiments", () => {
  async function setup(experimentOverrides: Parameters<typeof measurementExperimentRow>[0]) {
    const repository = new InMemoryExperimentRepository();
    const service = new ExperimentService({ repository });
    const experiment = measurementExperimentRow({ evidence_design: "controlled_split", primary_metric: "signup_completed", metric_label: null, metric_unit: null, ...experimentOverrides });
    repository.experiments.set(experiment.id, experiment);
    const control = await repository.createVariant({ id: crypto.randomUUID(), workspace_id: experiment.workspace_id, experiment_id: experiment.id, evidence_node_id: crypto.randomUUID(), variant_key: "control", label: "Control", content: {}, target: {}, allocation_weight: 10_000, is_control: true, source_action_variant_id: null });
    const subjectKeyHash = hashExperimentSubject(experiment.id, "subject-1");
    await repository.createAssignment({ id: crypto.randomUUID(), workspace_id: experiment.workspace_id, experiment_id: experiment.id, variant_id: control.id, subject_key_hash: subjectKeyHash, assignment_method: "deterministic_hash_v1" });
    const token = "wexp_" + "t".repeat(32);
    const { createHash } = await import("node:crypto");
    await repository.issueToken({ id: crypto.randomUUID(), workspace_id: experiment.workspace_id, experiment_id: experiment.id, public_key: "wexp_pub_" + "p".repeat(16), token_hash: createHash("sha256").update(token).digest("hex"), status: "active" });
    const event = (occurredAt: string) => service.recordPublicEvent({ publicToken: token, experimentId: experiment.id, eventId: `e-${occurredAt}`, eventType: "exposure", subjectKey: "subject-1", variantId: control.id, occurredAt });
    return { service, repository, experiment, event };
  }

  it("accepts events only while running and inside [treatment_started_at, measurement_end)", async () => {
    const now = Date.now();
    const inWindow = await setup({ treatment_started_at: new Date(now - 3_600_000).toISOString(), measurement_start: new Date(now - 3_600_000).toISOString(), measurement_end: new Date(now + 86_400_000).toISOString() });
    await expect(inWindow.event(new Date(now - 60_000).toISOString())).resolves.toMatchObject({ event_type: "exposure" });
    await expect(inWindow.event(new Date(now - 7_200_000).toISOString())).rejects.toMatchObject({ details: { reason: "experiment_event_outside_window" } });
    const closed = await setup({ treatment_started_at: new Date(now - 86_400_000).toISOString(), measurement_start: new Date(now - 86_400_000).toISOString(), measurement_end: new Date(now - 3_600_000).toISOString() });
    await expect(closed.event(new Date(now - 60_000).toISOString())).rejects.toMatchObject({ details: { reason: "experiment_event_outside_window" } });
    const paused = await setup({ status: "paused" });
    await expect(paused.event(new Date(now - 60_000).toISOString())).rejects.toBeInstanceOf(AppError);
  });

  it("legacy lifecycle, variant, token and descriptive-result paths refuse measurement-v1 rows", async () => {
    const { service, experiment } = await setup({});
    await expect(service.transition({ workspaceId: experiment.workspace_id, experimentId: experiment.id, toStatus: "completed" })).rejects.toMatchObject({ details: { reason: "measurement_v1_experiment" } });
    await expect(service.calculateResults(experiment.workspace_id, experiment.id)).rejects.toMatchObject({ details: { reason: "measurement_v1_experiment" } });
    await expect(service.issuePublicToken(experiment.workspace_id, experiment.id)).rejects.toMatchObject({ details: { reason: "measurement_v1_experiment" } });
    await expect(service.createVariant({ workspaceId: experiment.workspace_id, experimentId: experiment.id, variantKey: "late", label: "Late", content: {}, allocationWeight: 1 })).rejects.toMatchObject({ details: { reason: "measurement_v1_experiment" } });
    expect("revokePublicToken" in service).toBe(false);
    expect("createExperiment" in service).toBe(false);
  });
});
