import { and, desc, ilike, isNull, or, sql } from "drizzle-orm";
import { AdminHeader, RowLink, Table } from "@/components/admin/ui";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  await requireAdmin("customers:view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const [rows, settings] = await Promise.all([
    db()
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        email: schema.customers.email,
        createdAt: schema.customers.createdAt,
        orders: sql<number>`(select count(*)::int from ${schema.orders} o where o.customer_id = ${schema.customers.id} and o.payment_status <> 'unpaid')`,
        paid: sql<number>`(select coalesce(sum(o.amount_paid_cents - o.amount_refunded_cents), 0)::int from ${schema.orders} o where o.customer_id = ${schema.customers.id})`,
        requests: sql<number>`(select count(*)::int from ${schema.inquiries} i where i.customer_id = ${schema.customers.id})`,
      })
      .from(schema.customers)
      .where(and(isNull(schema.customers.erasedAt), q ? or(ilike(schema.customers.name, like), ilike(schema.customers.email, like)) : undefined))
      .orderBy(desc(schema.customers.createdAt))
      .limit(200),
    getSettings(),
  ]);
  return (
    <>
      <AdminHeader title="Customers" description="Created automatically from orders and custom requests. Customers don't have accounts or passwords." />
      <form className="mb-6 flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search customers</label>
        <input id="q" name="q" defaultValue={q} placeholder="Name or email" className="rounded-full border border-line-strong bg-white px-4 py-1.5 text-sm" />
        <button className="rounded-full bg-ink px-4 py-1.5 text-sm text-cream">Search</button>
      </form>
      <Table head={["Customer", "Paid orders", "Requests", "Net paid", "First seen"]} empty={rows.length ? undefined : "No customers found."}>
        {rows.map((c) => (
          <tr key={c.id}>
            <td className="px-4 py-3"><RowLink href={`/admin/customers/${c.id}`}>{c.name}</RowLink><span className="block text-ink-muted">{c.email}</span></td>
            <td className="px-4 py-3 tabular-nums">{c.orders}</td>
            <td className="px-4 py-3 tabular-nums">{c.requests}</td>
            <td className="px-4 py-3 tabular-nums">{formatMoney(c.paid, settings.currency)}</td>
            <td className="px-4 py-3 text-ink-muted">{formatDateTime(c.createdAt)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
