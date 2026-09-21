import { describe, expect, it } from "vitest";

import { isActiveProduct, nextActiveProductId, partitionProducts } from "../../src/server/modules/products/product-lifecycle";

describe("product lifecycle", () => {
  it("counts only active products in the dashboard context", () => {
    const result = partitionProducts([
      { id: "checkoutleak", status: "active" },
      { id: "historical", status: "archived" },
    ]);
    expect(result.active.map((product) => product.id)).toEqual(["checkoutleak"]);
    expect(result.archived.map((product) => product.id)).toEqual(["historical"]);
  });

  it("recognizes archived products as unavailable for new scans", () => {
    expect(isActiveProduct({ status: "active" })).toBe(true);
    expect(isActiveProduct({ status: "archived" })).toBe(false);
  });

  it("reconciles the active product selection after archiving", () => {
    expect(nextActiveProductId("checkoutleak", "checkoutleak", ["linear"])).toBe("linear");
    expect(nextActiveProductId("checkoutleak", "checkoutleak", [])).toBeNull();
    expect(nextActiveProductId("stale-product", "checkoutleak", ["linear"])).toBe("linear");
    expect(nextActiveProductId("linear", "checkoutleak", ["linear"])).toBe("linear");
  });
});
