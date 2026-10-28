import Link from "next/link";
import { RevenueChart } from "@/components/admin/revenue-chart";
import { AdminHeader, Panel, RowLink, Table } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/session";
import { addDays, dateInZone, formatDate, isIsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { productSales } from "@/lib/reports";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const admin = await requireAdmin("reports:view");
  const sp = await searchParams;
  const settings = await getSettings();
  const today = dateInZone(new Date(), settings.timezone);
  const presets = [
    { label: "Last 7 days", from: addDays(today, -6) },
    { label: "Last 30 days", from: addDays(today, -29) },
    { label: "Last 90 days", from: addDays(today, -89) },
    { label: "This month", from: `${today.slice(0, 8)}01` },
  ];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  let from = isIsoDate(str(sp.from)) ? str(sp.from) : presets[1].from;
  let to = isIsoDate(str(sp.to)) ? str(sp.to) : today;
  if (to < from) [from, to] = [to, from];
  if (from < addDays(to, -365)) from = addDays(to, -365);
  const report = await productSales(from, to, settings);
  const showCost = can(admin.role, "costs:view");
  const cur = settings.currency;
  const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
  const inputCls = "rounded-full border border-line-strong bg-white px-4 py-1.5 text-sm";

  return (
    <>
      <AdminHeader title="Reports" description={`Sales by product for orders confirmed ${formatDate(from)}${from !== to ? ` – ${formatDate(to)}` : ""}. Definitions: docs/reporting.md.`} />
      <nav aria-label="Date range" className="mb-4 flex flex-wrap gap-2">
        {presets.map((p) => (
          <Link key={p.label} href={`/admin/reports?from=${p.from}&to=${today}`} aria-current={p.from === from && to === today ? "page" : undefined} className="rounded-full border border-line-strong px-3 py-1.5 text-sm aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-cream">
            {p.label}
          </Link>
        ))}
      </nav>
      <form className="mb-8 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">From<input type="date" name="from" defaultValue={from} className={inputCls} /></label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">To<input type="date" name="to" defaultValue={to} className={inputCls} /></label>
        <button className="rounded-full bg-ink px-4 py-1.5 text-sm text-cream">Show</button>
      </form>

      <ul className="mb-8 grid gap-4 sm:grid-cols-3">
        <li className="rounded-2xl border border-line bg-paper p-5"><p className="text-3xl text-ink tabular-nums">{formatMoney(report.revenueCents, cur)}</p><p className="mt-1 text-sm text-ink-soft">Product sales</p><p className="mt-2 text-xs text-ink-muted">Line totals, before discounts, tax and delivery.</p></li>
        <li className="rounded-2xl border border-line bg-paper p-5"><p className="text-3xl text-ink tabular-nums">{report.orders}</p><p className="mt-1 text-sm text-ink-soft">Orders confirmed</p><p className="mt-2 text-xs text-ink-muted">First payment in this period; cancelled orders excluded.</p></li>
        <li className="rounded-2xl border border-line bg-paper p-5"><p className="text-3xl text-ink tabular-nums">{report.products.reduce((n, p) => n + p.units, 0)}</p><p className="mt-1 text-sm text-ink-soft">Items sold</p></li>
      </ul>

      <Panel title="Product sales by day" className="mb-8">
        {report.orders === 0 ? (
          <p className="text-sm text-ink-soft">No confirmed orders in this period.</p>
        ) : (
          <>
            <RevenueChart days={report.daily} currency={cur} />
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-berry">Show as a table</summary>
              <table className="mt-3 w-full max-w-md text-sm">
                <thead className="text-left text-xs text-ink-muted"><tr><th scope="col" className="py-1 font-medium">Day</th><th scope="col" className="py-1 font-medium">Orders</th><th scope="col" className="py-1 text-right font-medium">Sales</th></tr></thead>
                <tbody>
                  {report.daily.filter((d) => d.orders > 0).map((d) => (
                    <tr key={d.date} className="border-t border-line"><td className="py-1">{formatDate(d.date)}</td><td className="py-1 tabular-nums">{d.orders}</td><td className="py-1 text-right tabular-nums">{formatMoney(d.revenueCents, cur)}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </Panel>

      <h2 className="mb-3 text-xl text-ink">By product</h2>
      <Table head={["Product", "Orders", "Units", "Sales", "Share", ...(showCost ? ["Est. ingredient cost", "Est. margin"] : [])]} empty={report.products.length ? undefined : "Nothing sold in this period."}>
        {report.products.map((p) => (
          <tr key={p.key}>
            <td className="px-4 py-3">{p.productId ? <RowLink href={`/admin/products/${p.productId}`}>{p.name}</RowLink> : p.name}</td>
            <td className="px-4 py-3 tabular-nums">{p.orders}</td>
            <td className="px-4 py-3 tabular-nums">{p.units}</td>
            <td className="px-4 py-3 tabular-nums">{formatMoney(p.revenueCents, cur)}</td>
            <td className="px-4 py-3 tabular-nums text-ink-muted">{pct(p.revenueCents, report.revenueCents)}</td>
            {showCost && <td className="px-4 py-3 tabular-nums">{p.costCents === null ? "—" : formatMoney(p.costCents, cur)}</td>}
            {showCost && <td className="px-4 py-3 tabular-nums">{p.marginCents === null ? "—" : `${formatMoney(p.marginCents, cur)} (${pct(p.marginCents, p.revenueCents)})`}</td>}
          </tr>
        ))}
      </Table>
      {showCost && <p className="mt-2 text-xs text-ink-muted">Costs use each product&apos;s current recipe and ingredient prices, scaled by the options chosen. “—” means no recipe, or an ingredient without a cost. Labour, packaging and overheads aren&apos;t included.</p>}
    </>
  );
}
