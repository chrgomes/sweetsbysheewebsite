import { describe, expect, it } from "vitest";
import { checkFulfillmentDate, earliestFulfillmentDate, orderingDay, isIsoDate, isoWeekday, startOfDayInZone, type FulfillmentRules } from "@/lib/dates";

const rules: FulfillmentRules = { timeZone: "America/New_York", leadTimeHours: 48, maxAdvanceDays: 60, weekdays: [3, 4, 5, 6], blackoutDates: ["2026-11-26"] };
// Monday 2 Nov 2026, 10:00 New York (15:00 UTC).
const now = new Date("2026-11-02T15:00:00Z");

describe("dates", () => {
  it("validates ISO dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("26-2-3")).toBe(false);
  });
  it("computes midnight in a timezone across DST", () => {
    expect(startOfDayInZone("2026-07-01", "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(startOfDayInZone("2026-12-01", "America/New_York").toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });
  it("knows ISO weekdays", () => {
    expect(isoWeekday("2026-11-02")).toBe(1);
    expect(isoWeekday("2026-11-08")).toBe(7);
  });
  it("enforces lead time from the start of the fulfilment day", () => {
    // Wednesday 00:00 is only 38h away: too soon. Thursday is fine.
    expect(checkFulfillmentDate("2026-11-04", rules, now).ok).toBe(false);
    expect(checkFulfillmentDate("2026-11-05", rules, now).ok).toBe(true);
  });
  it("rejects closed weekdays, blackout dates and dates too far ahead", () => {
    expect(checkFulfillmentDate("2026-11-09", rules, now)).toMatchObject({ ok: false }); // Monday
    expect(checkFulfillmentDate("2026-11-26", rules, now)).toMatchObject({ ok: false, reason: "That date is unavailable." });
    expect(checkFulfillmentDate("2027-03-04", rules, now)).toMatchObject({ ok: false });
  });
  it("finds the earliest bookable date", () => {
    expect(earliestFulfillmentDate(rules, now)).toBe("2026-11-05");
    expect(earliestFulfillmentDate({ ...rules, weekdays: [], maxAdvanceDays: 1, leadTimeHours: 24 * 30 }, now)).toBeNull();
  });
  it("applies the daily order cut-off as whole days from the ordering day", () => {
    const cutoff = { ...rules, weekdays: [], cutoffTime: "14:00" };
    // Monday 10:00 New York, before a 14:00 cut-off: 2 days' notice → Wednesday.
    expect(orderingDay(now, "America/New_York", "14:00")).toBe("2026-11-02");
    expect(checkFulfillmentDate("2026-11-04", cutoff, now).ok).toBe(true);
    expect(checkFulfillmentDate("2026-11-03", cutoff, now).ok).toBe(false);
    // Monday 15:00, after the cut-off: counts from Tuesday → Thursday.
    const late = new Date("2026-11-02T20:00:00Z");
    expect(orderingDay(late, "America/New_York", "14:00")).toBe("2026-11-03");
    expect(checkFulfillmentDate("2026-11-04", cutoff, late)).toMatchObject({ ok: false, reason: expect.stringMatching(/after 14:00/) });
    expect(checkFulfillmentDate("2026-11-05", cutoff, late).ok).toBe(true);
  });
});
