import { describe, expect, it } from "vitest";

import { AppError } from "@/server/lib/errors";
import { resolveWorkspaceCapabilities } from "@/server/modules/entitlements/plan-capabilities";

// Regression test for the dashboard "Retry" bug: resolveWorkspaceCapabilities used to
// `throw result.error` directly, leaking the raw (non-AppError) Supabase/Postgrest error.
// prepareProductDemandScan calls this (via resolveMonitoringPolicy) on every manual scan
// request, including a dashboard Retry, before a job is ever created. Any transient or
// schema-drift failure on the `subscriptions` query surfaced to the client as toPublicError's
// generic "An unexpected error occurred." with no code, no details, and nothing logged
// server-side to correlate. It must now come back as a typed, loggable AppError.

function chainable(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.order = () => builder;
  builder.limit = () => builder;
  builder.maybeSingle = async () => result;
  return builder;
}

describe("resolveWorkspaceCapabilities error translation", () => {
  it("wraps a raw Supabase query error in a typed AppError instead of throwing it raw", async () => {
    const rawError = { message: 'relation "subscriptions" does not exist', code: "42P01" };
    const client = { from: () => chainable({ data: null, error: rawError }) } as never;

    const failure = await resolveWorkspaceCapabilities(client, "workspace-1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
    expect((failure as AppError).message).not.toContain("subscriptions");
  });

  it("resolves normally when the subscriptions lookup succeeds", async () => {
    const client = { from: () => chainable({ data: null, error: null }) } as never;
    const capabilities = await resolveWorkspaceCapabilities(client, "workspace-1");
    expect(capabilities.plan).toBe("free");
  });
});
