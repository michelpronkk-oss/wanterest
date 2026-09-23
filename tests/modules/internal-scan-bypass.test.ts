import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { isInternalScanCooldownBypassWorkspace } = await import("../../src/server/modules/operations/internal-scan-bypass");

const workspaceId = "8b7a4189-54b7-4cc0-a4a3-1502dc2be82a";
const otherWorkspaceId = "00000000-0000-4000-8000-000000000099";

describe("isInternalScanCooldownBypassWorkspace", () => {
  beforeEach(() => {
    // getServerEnv() requires these regardless of whether this module uses them.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false when the env var is unset", () => {
    vi.stubEnv("INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS", undefined);
    expect(isInternalScanCooldownBypassWorkspace(workspaceId)).toBe(false);
  });

  it("returns false when the env var is empty", () => {
    vi.stubEnv("INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS", "");
    expect(isInternalScanCooldownBypassWorkspace(workspaceId)).toBe(false);
  });

  it("returns true for a workspace ID present in the comma-separated list", () => {
    vi.stubEnv("INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS", `${otherWorkspaceId},${workspaceId}`);
    expect(isInternalScanCooldownBypassWorkspace(workspaceId)).toBe(true);
  });

  it("returns false for a workspace ID not in the list", () => {
    vi.stubEnv("INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS", otherWorkspaceId);
    expect(isInternalScanCooldownBypassWorkspace(workspaceId)).toBe(false);
  });

  it("trims whitespace around list entries", () => {
    vi.stubEnv("INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS", `  ${workspaceId}  ,  ${otherWorkspaceId}  `);
    expect(isInternalScanCooldownBypassWorkspace(workspaceId)).toBe(true);
  });

  it("matches case-insensitively", () => {
    vi.stubEnv("INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS", workspaceId.toUpperCase());
    expect(isInternalScanCooldownBypassWorkspace(workspaceId)).toBe(true);
  });

  it("silently ignores malformed entries instead of matching or throwing", () => {
    vi.stubEnv("INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS", "not-a-uuid, also-invalid;drop table job_runs;");
    expect(() => isInternalScanCooldownBypassWorkspace(workspaceId)).not.toThrow();
    expect(isInternalScanCooldownBypassWorkspace(workspaceId)).toBe(false);
    expect(isInternalScanCooldownBypassWorkspace("not-a-uuid")).toBe(false);
  });
});
