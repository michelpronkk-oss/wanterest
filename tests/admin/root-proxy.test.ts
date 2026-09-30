import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ adminProxy: vi.fn(), customerProxy: vi.fn() }));

vi.mock("../../apps/admin/src/proxy", () => ({ createAdminProxyResponse: mocks.adminProxy }));
vi.mock("../../src/server/providers/supabase/proxy", () => ({ updateSupabaseSession: mocks.customerProxy }));

import { createAdminProxyResponse } from "../../apps/admin/src/proxy";
import { updateSupabaseSession } from "../../src/server/providers/supabase/proxy";
import { proxy } from "../../src/proxy";

describe("root hostname Proxy", () => {
  beforeEach(() => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    vi.mocked(createAdminProxyResponse).mockResolvedValue(new NextResponse("admin"));
    vi.mocked(updateSupabaseSession).mockImplementation(async () => new NextResponse("customer"));
    vi.clearAllMocks();
  });

  it("rewrites the exact production admin hostname to the private namespace", async () => {
    const request = new NextRequest("https://admin.wanterest.com/login?notice=welcome");
    const response = await proxy(request);
    expect(createAdminProxyResponse).toHaveBeenCalledWith(request, "/admin-internal/login");
    expect(updateSupabaseSession).not.toHaveBeenCalled();
    expect(await response.text()).toBe("admin");
  });

  it.each(["wanterest.com", "www.wanterest.com", "app.wanterest.com"])("keeps %s customer routes unchanged", async (hostname) => {
    const request = new NextRequest(`https://${hostname}/login`);
    const response = await proxy(request);
    expect(updateSupabaseSession).toHaveBeenCalledWith(request);
    expect(createAdminProxyResponse).not.toHaveBeenCalled();
    expect(await response.text()).toBe("customer");
    if (hostname === "www.wanterest.com") {
      expect(response.headers.has("x-robots-tag")).toBe(false);
    } else {
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
    }
  });

  it("returns a non-cacheable not-found for the internal route on customer hosts", async () => {
    const request = new NextRequest("https://app.wanterest.com/admin-internal/operations");
    const response = await proxy(request);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(updateSupabaseSession).not.toHaveBeenCalled();
    expect(createAdminProxyResponse).not.toHaveBeenCalled();
  });

  it("returns not-found for the admin host on Vercel Preview", async () => {
    process.env.VERCEL_ENV = "preview";
    const request = new NextRequest("https://admin.wanterest.com/login");
    const response = await proxy(request);
    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(createAdminProxyResponse).not.toHaveBeenCalled();
  });
});
