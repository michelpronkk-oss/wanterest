import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mockHost = vi.hoisted(() => ({ value: "admin.wanterest.com" }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: mockHost.value })) }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@admin/app/admin-scope", () => ({ AdminScope: ({ children }: { children: unknown }) => children }));

const original = { VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV, NODE_ENV: process.env.NODE_ENV };

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

describe("Admin route layout boundary", () => {
  it("renders only on the production Admin hostname", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    mockHost.value = "admin.wanterest.com";
    const { default: layout } = await import("../../src/app/admin-internal/layout");
    const result = await layout({ children: "private" });
    expect(result).toBeTruthy();
  });

  it("returns not found when the private Admin path is reached on a customer domain", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    mockHost.value = "app.wanterest.com";
    const { default: layout } = await import("../../src/app/admin-internal/layout");
    await expect(layout({ children: "private" })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("returns not found when the Admin hostname reaches a Preview build", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    mockHost.value = "admin.wanterest.com";
    const { default: layout } = await import("../../src/app/admin-internal/layout");
    await expect(layout({ children: "private" })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
