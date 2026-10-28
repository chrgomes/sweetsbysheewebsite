import Link from "next/link";
import { AdminHeader, Panel, RowLink, Table } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { FormAlert } from "@/components/ui/field";
import { requireAdmin } from "@/lib/auth/session";
import { addDays, dateInZone, formatDate, isIsoDate } from "@/lib/dates";
import { ingredientForecast } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { formatQuantity } from "@/lib/recipe-math";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Ingredient forecast" };

const PRESETS = [
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "Next 3 days" },
  { days: 7, label: "Next 7 days" },
  { days: 14, label: "Next 14 days" },
];

export default async function ForecastPage({ searchParams }: PageProps<"/admin/inventory/forecast">) {
  const admin = await requireAdmin("inventory:view");
  const sp = await searchParams;
  const settings = await getSettings();
  const today = dateInZone(new Date(), settings.timezone);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  let from = isIsoDate(str(sp.from)) ? str(sp.from) : today;
  let to = isIsoDate(str(sp.to)) ? str(sp.to) : addDays(today, 6);
  if (to < from) [from, to] = [to, from];
  if (to > addDays(from, 92)) to = addDays(from, 92);
  const includePending = sp.pending === "1";
  const f = await ingredientForecast(from, to, { includePending });
  const showCost = can(admin.role, "costs:view");
  const short = f.rows.filter((r) => r.toBuy > 0);
  const bySupplier = new Map<string, typeof short>();
  for (const r of short) {
    const k = r.supplier?.name ?? "No supplier set";
    bySupplier.set(k, [...(bySupplier.get(k) ?? []), r]);
  }
  const qs = (patch: Record<string, string>) => new URLSearchParams({ from, to, ...(includePending ? { pending: "1" } : {}), ...patch }).toString();
  const estimate = (cents: number | null, qty: number) => (cents === null ? null : Math.round(cents * qty));
  const totalEstimate = short.reduce((n, r) => n + (estimate(r.costPerUnitCents, r.toBuy) ?? 0), 0);
  const inputCls = "rounded-full border border-line-strong bg-white px-4 py-1.5 text-sm";

  return (
    <>
      <AdminHeader
        title="Ingredient forecast"
        description={`What upcoming orders will use, compared with what's in stock. ${formatDate(from)}${from !== to ? ` – ${formatDate(to)}` : ""}.`}
        actions={<Link href="/admin/inventory" className="rounded-full border border-line-strong px-4 py-2 text-sm hover:border-ink">Inventory</Link>}
      />
      <nav aria-label="Date range" className="mb-4 flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const pf = p.days === 1 ? addDays(today, 1) : today;
          const pt = p.days === 1 ? addDays(today, 1) : addDays(today, p.days - 1);
          return (
            <Link key={p.label} href={`/admin/inventory/forecast?${qs({ from: pf, to: pt })}`} aria-current={pf === from && pt === to ? "page" : undefined} className="rounded-full border border-line-strong px-3 py-1.5 text-sm aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-cream">
              {p.label}
            </Link>
          );
        })}
      </nav>
      <form className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">From<input type="date" name="from" defaultValue={from} className={inputCls} /></label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">To<input type="date" name="to" defaultValue={to} className={inputCls} /></label>
        <label className="flex items-center gap-2 pb-1.5 text-sm"><input type="checkbox" name="pending" value="1" defaultChecked={includePending} className="size-4" /> Include orders awaiting payment</label>
        <button className="rounded-full bg-ink px-4 py-1.5 text-sm text-cream">Show</button>
      </form>

      <p className="mb-4 text-sm text-ink-soft">
        {f.orderCount} order{f.orderCount === 1 ? "" : "s"} counted (confirmed{includePending ? ", awaiting payment" : ""} and on hold, not yet in production).
      </p>
      {(f.withoutRecipe.length > 0 || f.quoteOrders > 0) && (
        <div className="mb-6">
          <FormAlert tone="info">
            Not included:{" "}
            {f.withoutRecipe.length > 0 && <>products without a recipe ({f.withoutRecipe.join(", ")}). </>}
            {f.quoteOrders > 0 && <>{f.quoteOrders} custom-quote order{f.quoteOrders === 1 ? "" : "s"}, whose ingredients aren&apos;t listed. </>}
          </FormAlert>
        </div>
      )}

      <Table head={["Ingredient", "Needed", "In stock", "Left after", "To buy"]} empty={f.rows.length ? undefined : "No ingredients needed for orders in this range."}>
        {f.rows.map((r) => (
          <tr key={r.id}>
            <td className="px-4 py-3"><RowLink href={`/admin/inventory/${r.id}`}>{r.name}</RowLink></td>
            <td className="px-4 py-3 tabular-nums">{formatQuantity(r.needed, r.unit)}</td>
            <td className="px-4 py-3 tabular-nums">{formatQuantity(r.onHand, r.unit)}</td>
            <td className="px-4 py-3 tabular-nums">
              {formatQuantity(r.after, r.unit)} {r.short > 0 ? <Badge tone="danger">Short {formatQuantity(r.short, r.unit)}</Badge> : r.reorderLevel !== null && r.after <= r.reorderLevel ? <Badge tone="honey">Below warn level</Badge> : null}
            </td>
            <td className="px-4 py-3 tabular-nums">{r.toBuy > 0 ? formatQuantity(r.toBuy, r.unit) : "—"}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-ink-muted">“To buy” covers these orders and brings stock back up to each ingredient&apos;s warn level.</p>

      {short.length > 0 && (
        <Panel title="Shopping list" className="mt-8">
          <div className="grid gap-6 md:grid-cols-2">
            {[...bySupplier].map(([supplier, rows]) => (
              <section key={supplier} aria-label={supplier}>
                <h3 className="mb-2 font-medium text-ink">{supplier}</h3>
                <ul className="space-y-1 text-sm">
                  {rows.map((r) => {
                    const est = estimate(r.costPerUnitCents, r.toBuy);
                    return (
                      <li key={r.id} className="flex justify-between gap-3">
                        <span>{r.name}: {formatQuantity(r.toBuy, r.unit)}</span>
                        {showCost && <span className="text-ink-muted tabular-nums">{est === null ? "—" : `≈ ${formatMoney(est, settings.currency)}`}</span>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          {showCost && totalEstimate > 0 && <p className="mt-6 text-sm text-ink-soft">Estimated total at last known prices: <strong className="text-ink">{formatMoney(totalEstimate, settings.currency)}</strong></p>}
        </Panel>
      )}
    </>
  );
}
