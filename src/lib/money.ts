/** All money is integer minor units (cents). Never use floats for prices. */

export function formatMoney(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

/** Tax on an amount, rounded half-up to the cent. */
export function taxFor(amountCents: number, rateBps: number): number {
  return Math.round((amountCents * rateBps) / 10_000);
}

/** Parse a user-entered dollar amount ("12", "12.5", "$12.50") into cents, or null. */
export function parseMoneyInput(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}
