import { describe, expect, it } from "vitest";

import type { Database } from "../../src/server/db/database.types";

type Functions = Database["public"]["Functions"];
type AccessState = Functions["get_product_access_state"];
type AccessModeChange = Functions["set_product_access_mode"];
type SignalPage = Functions["list_signal_page"];

const accessStateArgs: AccessState["Args"] = {};
const accessStateRow: AccessState["Returns"][number] = {
  can_request_access: true,
  can_sign_up: false,
  invite_required: true,
  mode: "invite_only",
};
const accessModeChangeArgs: AccessModeChange["Args"] = {
  p_reason: "contract test",
  p_to_mode: "open",
};
const signalPageArgs: SignalPage["Args"] = {
  p_workspace_id: "00000000-0000-0000-0000-000000000000",
  p_limit: 26,
  p_offset: 0,
};
const signalPageRow: SignalPage["Returns"][number] = {
  buyer_language: [],
  canonical_url: null,
  conversation_id: "00000000-0000-0000-0000-000000000000",
  created_at: "2026-09-28T00:00:00.000Z",
  evidence_node_id: "00000000-0000-0000-0000-000000000000",
  excerpt: "",
  id: "00000000-0000-0000-0000-000000000000",
  intent_type: "problem",
  lifecycle_status: "active",
  match_ranking_id: "00000000-0000-0000-0000-000000000000",
  opportunity_score: 0,
  pain_themes: [],
  product_id: "00000000-0000-0000-0000-000000000000",
  product_match_evaluation_id: "00000000-0000-0000-0000-000000000000",
  product_match_id: "00000000-0000-0000-0000-000000000000",
  published_at: null,
  source_key: "fixture",
  tags: [],
  updated_at: "2026-09-28T00:00:00.000Z",
  why_it_matters: "",
  workspace_id: "00000000-0000-0000-0000-000000000000",
};

describe("generated Supabase RPC contracts", () => {
  it("keeps the live access and P2.1 read-model signatures typed", () => {
    expect(accessStateArgs).toEqual({});
    expect(accessStateRow.mode).toBe("invite_only");
    expect(accessModeChangeArgs.p_to_mode).toBe("open");
    expect(signalPageArgs.p_limit).toBe(26);
    expect(signalPageRow.opportunity_score).toBe(0);
  });
});
