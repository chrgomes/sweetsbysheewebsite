import { audit } from "@/lib/audit";
import { actorFor, adminCan } from "@/lib/auth/session";
import { ordersCsv, parseOrderQuery, searchOrders } from "@/lib/admin/order-search";

export const dynamic = "force-dynamic";

/** CSV of the orders matching the list filters. Contains customer data, so it's permissioned and audited. */
export async function GET(req: Request) {
  const admin = await adminCan("orders:export");
  if (!admin) return new Response("Not found", { status: 404 });
  const query = parseOrderQuery(Object.fromEntries(new URL(req.url).searchParams));
  const orders = await searchOrders(query, 5000);
  await audit(actorFor(admin), "orders.exported", "order", null, { filter: query.filter.key, from: query.from || undefined, to: query.to || undefined, count: orders.length });
  return new Response(ordersCsv(orders), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
