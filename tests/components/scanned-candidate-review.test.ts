import { describe, expect, it } from "vitest";

import { candidateReviewReasonLabels } from "../../src/components/dashboard/scanned-candidate-review";

describe("scanned candidate review", () => {
  it("maps qualification reason codes to concise human-readable labels", () => {
    expect(candidateReviewReasonLabels([
      "LOW_RELEVANCE",
      "STRONG_EVIDENCE",
      "NOISE_RISK",
      "INSUFFICIENT_INTENT",
      "LOW_RELEVANCE",
    ])).toEqual(["Low product relevance", "Promotional or noisy", "Weak buying intent"]);
  });
});
