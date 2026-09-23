import "server-only";

import { getServerEnv } from "@/server/lib/env";

/**
 * TEMPORARY internal validation mechanism. Lets a handful of Wanterest-owned workspaces
 * (never real customers) skip only the manual refresh cooldown while iterating on signal
 * relevance, without touching Free/Pro/Growth cooldown minutes, usage limits, entitlements,
 * or source budgets for anyone else. Configured entirely via
 * INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS (server-only, never sent to the client) — no
 * workspace ID is hardcoded here. Isolated in this file so it can be deleted outright once
 * validation is done, without touching prepareProductDemandScan's own logic.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseBypassWorkspaceIds(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      // Silently drops anything that isn't a well-formed UUID rather than throwing, so a
      // typo'd env value degrades to "no bypass" instead of breaking scans for everyone.
      .filter((value) => UUID_PATTERN.test(value)),
  );
}

export function isInternalScanCooldownBypassWorkspace(workspaceId: string): boolean {
  const bypassWorkspaceIds = parseBypassWorkspaceIds(getServerEnv().INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS);
  return bypassWorkspaceIds.has(workspaceId.trim().toLowerCase());
}
