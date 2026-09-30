import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isAdminHostnameRequest: vi.fn<() => Promise<boolean>>() }));

vi.mock("../../apps/admin/src/server/request", () => ({ isAdminHostnameRequest: mocks.isAdminHostnameRequest }));

import { GET } from "../../src/app/admin-internal/robots.txt/route";

describe("private Admin robots response", () => {
  beforeEach(() => {
    mocks.isAdminHostnameRequest.mockResolvedValue(true);
  });

  it("serves a plain noindex crawl policy only on the approved Admin host", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(await response.text()).toBe("User-agent: *\nDisallow: /\n");
  });

  it("returns a non-cacheable not-found when the host guard rejects the request", async () => {
    mocks.isAdminHostnameRequest.mockResolvedValue(false);
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(await response.text()).toBe("");
  });
});
