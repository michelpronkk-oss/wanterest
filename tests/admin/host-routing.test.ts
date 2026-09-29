import { describe, expect, it } from "vitest";

import { resolveAdminHostRequest } from "../../apps/admin/src/host-routing";

describe("Admin hostname routing", () => {
  it("rewrites the production admin hostname into the private app namespace", () => {
    expect(resolveAdminHostRequest({ hostname: "admin.wanterest.com", pathname: "/login", isVercel: true, vercelEnvironment: "production" }))
      .toEqual({ kind: "admin", rewritePath: "/admin-internal/login" });
    expect(resolveAdminHostRequest({ hostname: "ADMIN.WANTEREST.COM.", pathname: "/", isVercel: false }))
      .toEqual({ kind: "admin", rewritePath: "/admin-internal" });
    expect(resolveAdminHostRequest({ hostname: "admin.localhost", pathname: "/login", isVercel: false, allowLocalAdminHost: true }))
      .toEqual({ kind: "admin", rewritePath: "/admin-internal/login" });
  });

  it.each(["wanterest.com", "www.wanterest.com", "app.wanterest.com", "wanterest-git-feature.vercel.app"])(
    "keeps customer routes on %s and denies the private namespace",
    (hostname) => {
      expect(resolveAdminHostRequest({ hostname, pathname: "/login", isVercel: true, vercelEnvironment: "production" }))
        .toEqual({ kind: "customer" });
      expect(resolveAdminHostRequest({ hostname, pathname: "/admin-internal/login", isVercel: true, vercelEnvironment: "production" }))
        .toEqual({ kind: "blocked" });
    },
  );

  it.each(["preview", "development", ""])("denies admin routes on Vercel %s deployments", (vercelEnvironment) => {
    expect(resolveAdminHostRequest({ hostname: "admin.wanterest.com", pathname: "/login", isVercel: true, vercelEnvironment }))
      .toEqual({ kind: "blocked" });
  });

  it("blocks case and encoded variants of the internal namespace", () => {
    expect(resolveAdminHostRequest({ hostname: "admin.wanterest.com", pathname: "/ADMIN-INTERNAL/login", isVercel: false }))
      .toEqual({ kind: "blocked" });
    expect(resolveAdminHostRequest({ hostname: "wanterest.com", pathname: "/admin-internal%2flogin", isVercel: false }))
      .toEqual({ kind: "blocked" });
  });
});
