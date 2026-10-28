import { formatMoney } from "@/lib/money";

/** Round a maximum up to a clean axis value (1, 2, 2.5 or 5 × 10ⁿ). */
function niceMax(v: number) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

const compact = (cents: number, currency: string) =>
  cents >= 100_000 ? new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), notation: "compact", maximumFractionDigits: 1 }).format(cents / 100) : formatMoney(cents, currency);

/**
 * Daily revenue as columns: one series, so no legend (the heading names it).
 * Hover or focus a column for the exact figures; a table view sits below.
 */
export function RevenueChart({ days, currency }: { days: { date: string; revenueCents: number; orders: number }[]; currency: string }) {
  const max = niceMax(Math.max(...days.map((d) => d.revenueCents)));
  const ticks = [max, max / 2, 0];
  const label = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const every = Math.ceil(days.length / 8);
  const best = days.reduce((a, b) => (b.revenueCents > a.revenueCents ? b : a), days[0]);
  return (
    <figure>
      <div className="grid grid-cols-[auto_1fr] gap-x-3">
        <div className="relative h-48 text-right text-xs text-ink-muted tabular-nums" aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}>
              {compact(t, currency)}
            </span>
          ))}
        </div>
        <div className="relative h-48">
          {ticks.map((t, i) => (
            <div key={t} aria-hidden="true" className="absolute inset-x-0 border-t border-line" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }} />
          ))}
          <ul className="absolute inset-0 flex items-end gap-[2px]" aria-label="Revenue by day">
            {days.map((d) => {
              const pct = (d.revenueCents / max) * 100;
              const text = `${label(d.date)}: ${formatMoney(d.revenueCents, currency)} from ${d.orders} order${d.orders === 1 ? "" : "s"}`;
              return (
                <li key={d.date} className="group relative flex h-full flex-1 items-end justify-center outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)]" tabIndex={0} aria-label={text}>
                  <span className="block w-full max-w-6 rounded-t-[4px] bg-berry" style={{ height: d.revenueCents > 0 ? `max(${pct}%, 2px)` : 0 }} />
                  <span role="tooltip" className="pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max max-w-48 rounded-lg bg-ink px-2 py-1 text-xs text-cream shadow-[var(--shadow-soft)] group-hover:block group-focus-visible:block">
                    {text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <span />
        <div className="mt-1 flex gap-[2px] text-xs text-ink-muted" aria-hidden="true">
          {days.map((d, i) => (
            <span key={d.date} className="flex-1 overflow-visible text-center whitespace-nowrap">
              {i % every === 0 ? label(d.date) : ""}
            </span>
          ))}
        </div>
      </div>
      {best && best.revenueCents > 0 && (
        <figcaption className="mt-3 text-xs text-ink-muted">
          Best day: {label(best.date)}, {formatMoney(best.revenueCents, currency)}. Hover or tab to a column for details.
        </figcaption>
      )}
    </figure>
  );
}
