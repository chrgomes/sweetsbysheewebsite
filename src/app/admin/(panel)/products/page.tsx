import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { AdminHeader, RowLink, Table } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  await requireAdmin("products:view");
  const sp = await searchParams;
  const review = sp.review === "1";
  const rows = await db().query.products.findMany({
    where: review ? eq(schema.products.migrationStatus, "needs_review") : undefined,
    with: { category: true, images: { columns: { id: true }, limit: 1 } },
    orderBy: [asc(schema.products.sortOrder), asc(schema.products.name)],
  });
  return (
    <>
      <AdminHeader title={review ? "Products needing review" : "Products"} description={review ? "Migrated products whose details haven't been confirmed yet." : undefined} actions={<ButtonLink href="/admin/products/new" size="sm">New product</ButtonLink>} />
      <Table head={["Name", "Category", "Price", "Ordering", "Status"]} empty={rows.length ? undefined : "No products yet."}>
        {rows.map((p) => (
          <tr key={p.id}>
            <td className="px-4 py-3">
              <RowLink href={`/admin/products/${p.id}`}>{p.name}</RowLink>
              {!p.images.length && <span className="block text-xs text-ink-muted">No photo</span>}
            </td>
            <td className="px-4 py-3">{p.category?.name ?? "—"}</td>
            <td className="px-4 py-3 tabular-nums">{p.basePriceCents === null ? "On request" : formatMoney(p.basePriceCents, p.currency)}</td>
            <td className="px-4 py-3 text-ink-soft">{[p.directPurchase && "Online", p.customOrder && "Custom"].filter(Boolean).join(" · ") || "—"}</td>
            <td className="space-x-1 px-4 py-3">
              <Badge tone={p.status === "active" ? "sage" : "neutral"}>{p.status}</Badge>
              {p.migrationStatus === "needs_review" && <Badge tone="honey">review</Badge>}
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
