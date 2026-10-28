import { describe, expect, it } from "vitest";
import { can, PERMISSIONS, ROLES } from "@/lib/permissions";

describe("role permissions", () => {
  it("gives the owner everything and nobody else team management", () => {
    for (const p of PERMISSIONS) expect(can("owner", p)).toBe(true);
    for (const r of ROLES.filter((x) => x !== "owner")) expect(can(r, "users:manage")).toBe(false);
  });
  it("keeps money and settings away from operational roles", () => {
    for (const r of ["order_manager", "production", "reporting"] as const) {
      expect(can(r, "orders:refund")).toBe(false);
      expect(can(r, "settings:edit")).toBe(false);
      expect(can(r, "products:edit")).toBe(false);
    }
  });
  it("lets production move orders forward but not cancel them or see customers", () => {
    expect(can("production", "orders:progress")).toBe(true);
    expect(can("production", "orders:manage")).toBe(false);
    expect(can("production", "customers:view")).toBe(false);
    expect(can("production", "orders:export")).toBe(false);
  });
  it("makes reporting read-only", () => {
    expect(can("reporting", "reports:view")).toBe(true);
    expect(can("reporting", "orders:export")).toBe(true);
    for (const p of ["orders:progress", "orders:manage", "orders:payments", "inquiries:manage", "quotes:manage", "content:edit"] as const) {
      expect(can("reporting", p)).toBe(false);
    }
  });
});
