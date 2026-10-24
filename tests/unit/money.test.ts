import { describe, expect, it } from "vitest";
import { formatMoney, parseMoneyInput, taxFor } from "@/lib/money";

describe("money", () => {
  it("formats cents as currency", () => {
    expect(formatMoney(4550)).toBe("$45.50");
    expect(formatMoney(0)).toBe("$0.00");
  });
  it("rounds tax half-up to the cent", () => {
    expect(taxFor(1000, 825)).toBe(83); // 82.5 -> 83
    expect(taxFor(5500, 800)).toBe(440);
    expect(taxFor(999, 0)).toBe(0);
  });
  it("parses dollar input strictly", () => {
    expect(parseMoneyInput("12")).toBe(1200);
    expect(parseMoneyInput("$1,234.5")).toBe(123450);
    expect(parseMoneyInput("12.345")).toBeNull();
    expect(parseMoneyInput("-5")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
  });
});
