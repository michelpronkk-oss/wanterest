import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mockHeaders = vi.hoisted(() => ({ host: "admin.wanterest.com" }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: mockHeaders.host })) }));

const original = { VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV };

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("server-side Admin host authorization", () => {
  it("accepts only the production Admin hostname on Vercel", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    mockHeaders.host = "admin.wanterest.com";
    const { isAdminHostnameRequest, assertAdminHostnameRequest } = await import("../../apps/admin/src/server/request");
    await expect(isAdminHostnameRequest()).resolves.toBe(true);
    await expect(assertAdminHostnameRequest()).resolves.toBeUndefined();
  });

  it("rejects customer-host server action replay", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    mockHeaders.host = "app.wanterest.com";
    const { isAdminHostnameRequest, assertAdminHostnameRequest } = await import("../../apps/admin/src/server/request");
    await expect(isAdminHostnameRequest()).resolves.toBe(false);
    await expect(assertAdminHostnameRequest()).rejects.toThrow("Not found");
  });

  it("rejects the Admin hostname on a Preview deployment", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    mockHeaders.host = "admin.wanterest.com";
    const { isAdminHostnameRequest, assertAdminHostnameRequest } = await import("../../apps/admin/src/server/request");
    await expect(isAdminHostnameRequest()).resolves.toBe(false);
    await expect(assertAdminHostnameRequest()).rejects.toThrow("Not found");
  });
});
