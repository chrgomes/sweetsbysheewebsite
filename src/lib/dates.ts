/**
 * Calendar-date helpers that work in the bakery's timezone, so "earliest
 * pickup date" is right regardless of where the server runs.
 * Dates are ISO strings (YYYY-MM-DD).
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The calendar date of `instant` in `timeZone`. */
export function dateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Offset (ms) of `timeZone` from UTC at `instant`. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant of 00:00 on `isoDate` in `timeZone`. */
export function startOfDayInZone(isoDate: string, timeZone: string): Date {
  const guess = new Date(`${isoDate}T00:00:00Z`);
  const first = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
  // Re-check once to handle DST transitions between the guess and the result.
  return new Date(guess.getTime() - zoneOffsetMs(first, timeZone));
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday … 7 = Sunday. */
export function isoWeekday(isoDate: string): number {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export type FulfillmentRules = {
  timeZone: string;
  leadTimeHours: number;
  maxAdvanceDays: number;
  weekdays: number[];
  blackoutDates: string[];
  /** "HH:MM" local. When set, lead time counts in whole days from the ordering day, which is tomorrow after the cut-off. */
  cutoffTime?: string | null;
};

/** Local wall-clock time "HH:MM" of `instant` in `timeZone`. */
export function timeInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
}

/** With a cut-off, the calendar day an order counts as placed on: today before the cut-off, tomorrow after it. */
export function orderingDay(now: Date, timeZone: string, cutoffTime: string): string {
  const today = dateInZone(now, timeZone);
  return timeInZone(now, timeZone) < cutoffTime ? today : addDays(today, 1);
}

export type DateCheck = { ok: true } | { ok: false; reason: string };

/**
 * A date is bookable when the start of that day (00:00 in the bakery's
 * timezone) is at least `leadTimeHours` from now, it is within the booking
 * window, falls on an open weekday, and is not blacked out.
 */
export function checkFulfillmentDate(isoDate: string, rules: FulfillmentRules, now = new Date()): DateCheck {
  if (!isIsoDate(isoDate)) return { ok: false, reason: "Please choose a valid date." };
  if (rules.cutoffTime) {
    // "Order by HH:MM, N days ahead": lead time counts in whole days from the ordering day.
    const earliest = addDays(orderingDay(now, rules.timeZone, rules.cutoffTime), Math.ceil(rules.leadTimeHours / 24));
    if (isoDate < earliest) {
      return { ok: false, reason: `Please allow at least ${describeHours(rules.leadTimeHours)} notice (orders after ${rules.cutoffTime} count from the next day).` };
    }
  } else {
    // Otherwise the fulfilment day must start at least the lead time from now.
    const start = startOfDayInZone(isoDate, rules.timeZone);
    if (start.getTime() < now.getTime() + rules.leadTimeHours * 3_600_000) {
      return { ok: false, reason: `Please allow at least ${describeHours(rules.leadTimeHours)} notice.` };
    }
  }
  const today = dateInZone(now, rules.timeZone);
  if (isoDate > addDays(today, rules.maxAdvanceDays)) {
    return { ok: false, reason: `Orders can be placed up to ${rules.maxAdvanceDays} days ahead.` };
  }
  if (rules.weekdays.length && !rules.weekdays.includes(isoWeekday(isoDate))) {
    return { ok: false, reason: "We aren't available on that day of the week." };
  }
  if (rules.blackoutDates.includes(isoDate)) {
    return { ok: false, reason: "That date is unavailable." };
  }
  return { ok: true };
}

/** The first bookable date within the window, or null if none. */
export function earliestFulfillmentDate(rules: FulfillmentRules, now = new Date()): string | null {
  let d = dateInZone(now, rules.timeZone);
  for (let i = 0; i <= rules.maxAdvanceDays + 1; i++) {
    if (checkFulfillmentDate(d, rules, now).ok) return d;
    d = addDays(d, 1);
  }
  return null;
}

export function describeHours(hours: number): string {
  if (hours % 24 === 0 && hours >= 24) {
    const days = hours / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

export function formatDateTime(d: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(d);
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

/** One line per opening period, e.g. "Mon 9 am – 5 pm". Day 1 = Monday. */
export function formatBusinessHours(hours: { day: number; open: string; close: string }[]): string {
  return [...hours]
    .sort((a, b) => a.day - b.day || a.open.localeCompare(b.open))
    .map((h) => `${WEEKDAYS[h.day - 1]} ${clock(h.open)} – ${clock(h.close)}`)
    .join("\n");
}
