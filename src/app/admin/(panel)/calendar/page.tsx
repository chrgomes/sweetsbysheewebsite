import { eq } from "drizzle-orm";
import Link from "next/link";
import { CapacityOverrideForm } from "@/components/admin/forms";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { cn } from "@/components/ui/cn";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { calendarOrders, usageRange, type DayUsage } from "@/lib/capacity";
import { addDays, dateInZone, formatDate, isIsoDate, isoWeekday } from "@/lib/dates";
import { statusLabel } from "@/lib/orders";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Calendar" };

const VIEWS = ["month", "week", "day"] as const;
type View = (typeof VIEWS)[number];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthStart(d: string) {
  return `${d.slice(0, 8)}01`;
}
function monthEnd(d: string) {
  const [y, m] = d.split("-").map(Number);
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
}
function weekStart(d: string) {
  return addDays(d, 1 - isoWeekday(d));
}

function usageText(u: DayUsage | undefined) {
  if (!u || u.capacity === null) return u && u.confirmed + u.held > 0 ? `${u.confirmed + u.held} units` : "";
  return `${u.confirmed + u.held}/${u.capacity} units`;
}

export default async function CalendarPage({ searchParams }: PageProps<"/admin/calendar">) {
  const admin = await requireAdmin("calendar:view");
  const sp = await searchParams;
  const settings = await getSettings();
  const today = dateInZone(new Date(), settings.timezone);
  const view: View = VIEWS.includes(sp.view as View) ? (sp.view as View) : "month";
  const date = typeof sp.date === "string" && isIsoDate(sp.date) ? sp.date : today;

  const [from, to] = view === "month" ? [weekStart(monthStart(date)), addDays(weekStart(monthEnd(date)), 6)] : view === "week" ? [weekStart(date), addDays(weekStart(date), 6)] : [date, date];
  const [usage, orders, override] = await Promise.all([
    usageRange(from, to, settings),
    calendarOrders(from, to),
    view === "day" ? db().query.capacityOverrides.findFirst({ where: eq(schema.capacityOverrides.date, date) }) : Promise.resolve(undefined),
  ]);
  const usageBy = new Map(usage.map((u) => [u.date, u]));
  const ordersBy = new Map<string, typeof orders>();
  for (const o of orders) ordersBy.set(o.fulfillmentDate, [...(ordersBy.get(o.fulfillmentDate) ?? []), o]);
  const closed = (d: string) => settings.blackoutDates.includes(d) || (settings.fulfillmentWeekdays.length > 0 && !settings.fulfillmentWeekdays.includes(isoWeekday(d)));

  const step = view === "month" ? null : view === "week" ? 7 : 1;
  const prev = step ? addDays(date, -step) : addDays(monthStart(date), -1);
  const next = step ? addDays(date, step) : addDays(monthEnd(date), 1);
  const href = (v: View, d: string) => `/admin/calendar?view=${v}&date=${d}`;
  const title = view === "month" ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : view === "week" ? `Week of ${formatDate(from)}` : formatDate(date);

  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);

  return (
    <>
      <AdminHeader title="Production calendar" description="Orders by pickup/delivery date, with capacity. Pending orders hold capacity until their payment window ends." />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={href(view, prev)} className="rounded-full border border-line-strong px-3 py-1.5 text-sm" aria-label="Previous">←</Link>
          <Link href={href(view, today)} className="rounded-full border border-line-strong px-3 py-1.5 text-sm">Today</Link>
          <Link href={href(view, next)} className="rounded-full border border-line-strong px-3 py-1.5 text-sm" aria-label="Next">→</Link>
          <h2 className="ml-2 text-xl text-ink">{title}</h2>
        </div>
        <nav aria-label="Calendar view" className="flex gap-2">
          {VIEWS.map((v) => (
            <Link key={v} href={href(v, date)} aria-current={v === view ? "page" : undefined} className="rounded-full border border-line-strong px-3 py-1.5 text-sm capitalize aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-cream">{v}</Link>
          ))}
        </nav>
      </div>

      {view === "month" && (
        <div className="overflow-x-auto">
          <div className="grid min-w-[44rem] grid-cols-7 gap-px overflow-hidden rounded-2xl border border-line bg-line text-sm">
            {WEEKDAYS.map((d) => <div key={d} className="bg-paper px-2 py-2 text-xs font-medium text-ink-muted">{d}</div>)}
            {days.map((d) => {
              const u = usageBy.get(d);
              const n = ordersBy.get(d)?.length ?? 0;
              const full = !!u && u.remaining !== null && u.remaining <= 0;
              return (
                <Link key={d} href={href("day", d)} className={cn("min-h-24 bg-paper p-2 hover:bg-blush/40", d.slice(0, 7) !== date.slice(0, 7) && "text-ink-muted/60", d === today && "ring-2 ring-berry ring-inset")}>
                  <span className="font-medium">{Number(d.slice(8))}</span>
                  {closed(d) && <span className="ml-1 text-xs text-ink-muted">closed</span>}
                  {n > 0 && <span className="mt-1 block text-xs">{n} order{n === 1 ? "" : "s"}</span>}
                  {usageText(u) && <span className={cn("block text-xs", full ? "font-medium text-danger" : "text-ink-muted")}>{usageText(u)}{full ? " · full" : ""}</span>}
                  {u?.overridden && <span className="block text-xs text-honey">adjusted</span>}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {view !== "month" && (
        <div className={cn("grid gap-4", view === "week" && "lg:grid-cols-7")}>
          {days.map((d) => {
            const list = ordersBy.get(d) ?? [];
            const u = usageBy.get(d);
            return (
              <Panel key={d} className={view === "week" ? "p-3 sm:p-3" : undefined}>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={href("day", d)} className="font-medium text-ink hover:text-berry">{view === "week" ? `${WEEKDAYS[isoWeekday(d) - 1]} ${Number(d.slice(8))}` : formatDate(d)}</Link>
                  <span className="text-xs text-ink-muted">{closed(d) ? "Closed · " : ""}{usageText(u)}{u?.overridden ? " (adjusted)" : ""}</span>
                </div>
                {list.length === 0 ? (
                  <p className="text-xs text-ink-muted">No orders.</p>
                ) : (
                  <ul className="space-y-3 text-sm">
                    {list.map((o) => (
                      <li key={o.id} className={cn("rounded-lg border border-line p-2", o.status === "pending" && "border-dashed opacity-80")}>
                        <Link href={`/admin/orders/${o.id}`} className="font-medium hover:text-berry">{o.reference}</Link>
                        <span className="block text-xs text-ink-muted">{o.fulfillmentWindow ? `${o.fulfillmentWindow} · ` : ""}{o.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"} · {o.status === "pending" ? "Awaiting payment" : statusLabel(o)}</span>
                        {view === "day" && (
                          <ul className="mt-2 space-y-1">
                            {o.items.map((i) => (
                              <li key={i.id}>{i.quantity} × {i.productName}{i.options.length > 0 && <span className="block text-xs text-ink-muted">{i.options.map((x) => `${x.option}: ${x.value}`).join(" · ")}</span>}</li>
                            ))}
                            {o.notes && <li className="text-xs text-ink-soft">Customer note: {o.notes}</li>}
                          </ul>
                        )}
                        {view === "week" && <span className="block text-xs">{o.items.map((i) => `${i.quantity}× ${i.productName}`).join(", ")}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {view === "day" && can(admin.role, "capacity:override") && (
        <Panel title="Capacity for this day" className="mt-6 max-w-xl">
          <p className="mb-4 text-sm text-ink-soft">
            Normal daily capacity: {settings.dailyCapacityUnits ?? "no limit"}.
            {override ? ` Currently adjusted to ${override.capacityUnits} — “${override.reason}”.` : ""}
          </p>
          <CapacityOverrideForm date={date} units={override?.capacityUnits ?? settings.dailyCapacityUnits ?? ""} hasOverride={!!override} />
        </Panel>
      )}
    </>
  );
}
