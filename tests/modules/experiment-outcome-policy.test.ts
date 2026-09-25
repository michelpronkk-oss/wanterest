import { describe, expect, it } from "vitest";

import {
  computeExperimentOutcome, CONTROLLED_MET_COPY, CONTROLLED_NOT_MET_COPY, FORBIDDEN_RESULT_WORDS, NOT_STATISTICALLY_TESTED_COPY,
  type ArmCount, type OutcomeInput,
} from "../../src/server/modules/experiments/experiment-outcome.policy";

const START = "2026-09-10T00:00:00.000Z";
const END = "2026-09-17T00:00:00.000Z";

function beforeAfter(overrides: Partial<OutcomeInput> = {}): OutcomeInput {
  return {
    experimentId: "e1", planFingerprint: "f".repeat(64), design: "before_after", primaryMetric: "manual_custom", metricLabel: "Qualified demos", metricUnit: "count",
    successCriterion: { direction: "increase", measure: "absolute_delta", minimumEffect: 5 },
    status: "running", closedReason: null,
    treatment: { actionStatus: "completed", liveSince: START, measurementStart: START, measurementEnd: END },
    graceExpired: false,
    baseline: { id: "b1", value: 10, denominator: null },
    measurement: { id: "m1", value: 18, denominator: null },
    arms: [], windowDays: 7, daysWithExposure: 0,
    ...overrides,
  };
}

const arms = (control: [number, number], treatment: [number, number]): ArmCount[] => [
  { variantId: "c", isControl: true, exposed: control[0], converted: control[1], excludedEvents: 0 },
  { variantId: "t", isControl: false, exposed: treatment[0], converted: treatment[1], excludedEvents: 0 },
];

function controlled(overrides: Partial<OutcomeInput> = {}): OutcomeInput {
  return beforeAfter({
    design: "controlled_split", primaryMetric: "signup_completed", metricLabel: null, metricUnit: null,
    successCriterion: { direction: "increase", measure: "absolute_delta", minimumEffect: 0.05, minSamplePerArm: 100 },
    treatment: { actionStatus: "in_progress", liveSince: null, measurementStart: START, measurementEnd: END },
    baseline: null, measurement: null, arms: arms([200, 20], [200, 40]), daysWithExposure: 7,
    ...overrides,
  });
}

describe("experiment_outcome_v1 — before/after", () => {
  it("positive, negative and neutral against the human-supplied threshold, capped at before_after_association", () => {
    const positive = computeExperimentOutcome(beforeAfter());
    expect(positive).toMatchObject({ outcome: "positive", attributionClass: "before_after_association", treatmentIntegrity: "confirmed", effect: 8, baselineValue: 10, observedValue: 18, evidenceCompleteness: "complete", inconclusiveReasons: [] });
    expect(positive.observationIds).toEqual(["b1", "m1"]);
    expect(computeExperimentOutcome(beforeAfter({ measurement: { id: "m1", value: 3, denominator: null } })).outcome).toBe("negative");
    expect(computeExperimentOutcome(beforeAfter({ measurement: { id: "m1", value: 14, denominator: null } })).outcome).toBe("neutral");
    // decrease direction flips the sign
    expect(computeExperimentOutcome(beforeAfter({ successCriterion: { direction: "decrease", measure: "absolute_delta", minimumEffect: 5 }, measurement: { id: "m1", value: 3, denominator: null } })).outcome).toBe("positive");
    // relative measure
    expect(computeExperimentOutcome(beforeAfter({ successCriterion: { direction: "increase", measure: "relative_delta", minimumEffect: 0.5 } }))).toMatchObject({ outcome: "positive", effect: 0.8, effectBasis: "relative_delta" });
    // rates use value / denominator
    expect(computeExperimentOutcome(beforeAfter({ metricUnit: "rate", successCriterion: { direction: "increase", measure: "absolute_delta", minimumEffect: 0.05 }, baseline: { id: "b1", value: 10, denominator: 100 }, measurement: { id: "m1", value: 30, denominator: 150 } }))).toMatchObject({ outcome: "positive", effect: 0.1 });
  });

  it("a threshold exactly met counts as met (no floating-point drift)", () => {
    expect(computeExperimentOutcome(beforeAfter({ successCriterion: { direction: "increase", measure: "absolute_delta", minimumEffect: 0.3 }, baseline: { id: "b", value: 0.1, denominator: null }, measurement: { id: "m", value: 0.4, denominator: null } })).outcome).toBe("positive");
  });

  it("inconclusive rules come first and list every applicable reason", () => {
    expect(computeExperimentOutcome(beforeAfter({ baseline: null }))).toMatchObject({ outcome: "inconclusive", inconclusiveReasons: ["missing_baseline"], evidenceCompleteness: "partial", attributionClass: "descriptive" });
    expect(computeExperimentOutcome(beforeAfter({ measurement: null, graceExpired: true }))).toMatchObject({ outcome: "inconclusive", inconclusiveReasons: ["missing_observation"], attributionClass: "none" });
    expect(computeExperimentOutcome(beforeAfter({ baseline: null, measurement: null })).evidenceCompleteness).toBe("missing");
    expect(computeExperimentOutcome(beforeAfter({ successCriterion: { direction: "increase", measure: "relative_delta", minimumEffect: 0.1 }, baseline: { id: "b", value: 0, denominator: null } })).inconclusiveReasons).toEqual(["insufficient_baseline"]);
    expect(computeExperimentOutcome(beforeAfter({ baseline: { id: "b", value: 3, denominator: 0 } })).inconclusiveReasons).toContain("zero_denominator");
    expect(computeExperimentOutcome(beforeAfter({ treatment: { actionStatus: "in_progress", liveSince: null, measurementStart: START, measurementEnd: END } }))).toMatchObject({ outcome: "inconclusive", treatmentIntegrity: "unconfirmed", inconclusiveReasons: ["treatment_unconfirmed"] });
    expect(computeExperimentOutcome(beforeAfter({ treatment: { actionStatus: "completed", liveSince: "2026-09-12T00:00:00.000Z", measurementStart: START, measurementEnd: END } })).inconclusiveReasons).toEqual(["treatment_not_live_full_window"]);
    const stopped = computeExperimentOutcome(beforeAfter({ status: "canceled", closedReason: "stopped_early", measurement: null }));
    expect(stopped.inconclusiveReasons).toEqual(expect.arrayContaining(["window_interrupted", "missing_observation"]));
  });

  it("treatment abandoned is invalid with a reason and no attribution", () => {
    expect(computeExperimentOutcome(beforeAfter({ status: "canceled", closedReason: "treatment_abandoned" }))).toMatchObject({ outcome: "invalid", invalidationReason: "treatment_abandoned", attributionClass: "none", effect: null, effectBasis: null });
  });
});

describe("experiment_outcome_v1 — controlled split", () => {
  it("met / not met with the exact pre-registered copy, per-arm counts, and controlled_comparison only with verified exposure", () => {
    const met = computeExperimentOutcome(controlled());
    expect(met).toMatchObject({ outcome: "positive", attributionClass: "controlled_comparison", treatmentIntegrity: "verified_exposure", effect: 0.1, evidenceCompleteness: "complete" });
    expect(met.summary.startsWith(CONTROLLED_MET_COPY)).toBe(true);
    expect(met.summary).toContain(NOT_STATISTICALLY_TESTED_COPY);
    expect(met.summary).toContain("40 of 200 exposed");
    expect(met.armResults).toEqual([expect.objectContaining({ isControl: true, exposed: 200, converted: 20, rate: 0.1 }), expect.objectContaining({ isControl: false, exposed: 200, converted: 40, rate: 0.2 })]);
    const neutral = computeExperimentOutcome(controlled({ arms: arms([200, 20], [200, 25]) }));
    expect(neutral.outcome).toBe("neutral");
    expect(neutral.summary.startsWith(CONTROLLED_NOT_MET_COPY)).toBe(true);
    expect(neutral.summary).toContain(NOT_STATISTICALLY_TESTED_COPY);
    const negative = computeExperimentOutcome(controlled({ arms: arms([200, 40], [200, 20]) }));
    expect(negative.outcome).toBe("negative");
    expect(negative.summary.startsWith(CONTROLLED_NOT_MET_COPY)).toBe(true);
  });

  it("sample below the pre-registered minimum, zero denominators, partial days and missing exposure are inconclusive", () => {
    expect(computeExperimentOutcome(controlled({ arms: arms([50, 5], [200, 40]) })).inconclusiveReasons).toEqual(["sample_below_minimum"]);
    expect(computeExperimentOutcome(controlled({ arms: arms([0, 0], [200, 40]) })).inconclusiveReasons).toEqual(expect.arrayContaining(["zero_denominator", "sample_below_minimum", "partial_data"]));
    expect(computeExperimentOutcome(controlled({ daysWithExposure: 5 }))).toMatchObject({ outcome: "inconclusive", evidenceCompleteness: "partial", inconclusiveReasons: ["partial_data"] });
    const none = computeExperimentOutcome(controlled({ arms: arms([0, 0], [0, 0]), daysWithExposure: 0 }));
    expect(none).toMatchObject({ outcome: "inconclusive", evidenceCompleteness: "missing", treatmentIntegrity: "unconfirmed", attributionClass: "none" });
    expect(none.inconclusiveReasons).toContain("treatment_unconfirmed");
    expect(computeExperimentOutcome(controlled({ successCriterion: { direction: "increase", measure: "relative_delta", minimumEffect: 0.1, minSamplePerArm: 100 }, arms: arms([200, 0], [200, 10]) })).inconclusiveReasons).toEqual(["insufficient_baseline"]);
  });
});

describe("experiment_outcome_v1 — determinism and wording", () => {
  it("the input fingerprint is stable for equal inputs and changes with any outcome input", () => {
    const a = computeExperimentOutcome(beforeAfter());
    expect(computeExperimentOutcome(beforeAfter()).inputFingerprint).toBe(a.inputFingerprint);
    expect(a.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(computeExperimentOutcome(beforeAfter({ measurement: { id: "m2", value: 18, denominator: null } })).inputFingerprint).not.toBe(a.inputFingerprint);
    expect(computeExperimentOutcome(beforeAfter({ graceExpired: true })).inputFingerprint).not.toBe(a.inputFingerprint);
    expect(computeExperimentOutcome(controlled()).inputFingerprint).toBe(computeExperimentOutcome(controlled({ arms: [...arms([200, 20], [200, 40])].reverse() })).inputFingerprint);
  });

  it("no produced summary contains causal, validation, significance or winner wording", () => {
    const cases: OutcomeInput[] = [
      beforeAfter(), beforeAfter({ measurement: { id: "m", value: 3, denominator: null } }), beforeAfter({ measurement: { id: "m", value: 12, denominator: null } }),
      beforeAfter({ baseline: null }), beforeAfter({ status: "canceled", closedReason: "treatment_abandoned" }), beforeAfter({ status: "canceled", closedReason: "stopped_early" }),
      controlled(), controlled({ arms: arms([200, 40], [200, 20]) }), controlled({ arms: arms([200, 20], [200, 22]) }), controlled({ arms: arms([10, 1], [10, 5]) }),
    ];
    for (const input of cases) {
      const summary = computeExperimentOutcome(input).summary.toLowerCase();
      for (const word of FORBIDDEN_RESULT_WORDS) expect(summary, `${word} in: ${summary}`).not.toMatch(new RegExp(`\\b${word}\\b`));
      expect(summary).not.toMatch(/p-value|confidence interval/);
    }
  });
});
