import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Regression coverage for the "No matching branch env" live dispatch failure: the
// Trigger.dev SDK opportunistically reads VERCEL_GIT_COMMIT_REF (which Vercel sets on
// every deployment, production included) as a preview-branch name whenever no explicit
// previewBranch is configured, and Trigger.dev's server rejects the request outright
// when no such branch environment exists (verified against the production job_runs
// error_details for workspace 8b7a4189-54b7-4cc0-a4a3-1502dc2be82a / product
// c5946172-6bef-45c0-a5da-08aedc9294cd: three consecutive dispatch failures, all with
// error_details.message === "No matching branch env"). Wanterest does not use
// Trigger.dev's branch-preview feature, so this must be pinned off for every SDK call.

const configureMock = vi.fn();

vi.mock("@trigger.dev/sdk", () => ({
  configure: configureMock,
  runs: { retrieve: vi.fn() },
  tasks: { trigger: vi.fn() },
}));

describe("Trigger.dev client module", () => {
  beforeEach(() => {
    configureMock.mockClear();
    vi.resetModules();
  });

  it("pins previewBranch to an empty string at module load, for every SDK call (dispatch and run inspection alike)", async () => {
    await import("../../src/server/providers/trigger/client");
    expect(configureMock).toHaveBeenCalledWith({ previewBranch: "" });
  });
});

describe("triggerKeyPrefix", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("extracts a safe, non-secret prefix that reveals the key's environment", async () => {
    const { triggerKeyPrefix } = await import("../../src/server/providers/trigger/config");
    expect(triggerKeyPrefix("tr_dev_abcdef123456")).toBe("tr_dev_");
    expect(triggerKeyPrefix("tr_prod_abcdef123456")).toBe("tr_prod_");
    expect(triggerKeyPrefix(undefined)).toBeNull();
    expect(triggerKeyPrefix("")).toBeNull();
    expect(triggerKeyPrefix("   ")).toBeNull();
    expect(triggerKeyPrefix("not-a-trigger-key")).toBe("unrecognized_format");
    // Never leaks the token material itself.
    expect(triggerKeyPrefix("tr_dev_abcdef123456")).not.toContain("abcdef123456");
  });
});

describe("describeTriggerDispatchError", () => {
  it("extracts name/message/status/code from an SDK-shaped error object", async () => {
    const { describeTriggerDispatchError } = await import("../../src/server/providers/trigger/client");
    const result = describeTriggerDispatchError({ name: "PermissionDeniedError", status: 403, code: "forbidden", message: "No matching branch env" });
    expect(result).toEqual({ errorName: "PermissionDeniedError", errorMessage: "No matching branch env", errorCode: "forbidden", status: 403 });
  });

  it("falls back gracefully for a plain Error with no status/code", async () => {
    const { describeTriggerDispatchError } = await import("../../src/server/providers/trigger/client");
    const result = describeTriggerDispatchError(new TypeError("boom"));
    expect(result).toEqual({ errorName: "TypeError", errorMessage: "boom", errorCode: null, status: null });
  });

  it("never throws on a non-object thrown value", async () => {
    const { describeTriggerDispatchError } = await import("../../src/server/providers/trigger/client");
    expect(describeTriggerDispatchError("plain string failure")).toEqual({
      errorName: "UnknownError",
      errorMessage: "plain string failure",
      errorCode: null,
      status: null,
    });
  });
});
