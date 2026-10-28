import Link from "next/link";
import { IngredientForm } from "@/components/admin/inventory-forms";
import { AdminHeader, Panel, RowLink, Table } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth/session";
import { listIngredients, listSuppliers } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { formatQuantity, unitCostDisplay } from "@/lib/recipe-math";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: PageProps<"/admin/inventory">) {
  const admin = await requireAdmin("inventory:view");
  const sp = await searchParams;
  const showAll = sp.show === "all";
  const lowOnly = sp.show === "low";
  const [all, suppliers, settings] = await Promise.all([listIngredients({ includeInactive: showAll }), listSuppliers(), getSettings()]);
  const rows = lowOnly ? all.filter((i) => i.low) : all;
  const lowCount = all.filter((i) => i.low).length;
  const showCost = can(admin.role, "costs:view");
  const manage = can(admin.role, "inventory:manage");
  const filters = [
    { key: "", label: "In use" },
    { key: "low", label: `Low stock (${lowCount})` },
    { key: "all", label: "All, including not in use" },
  ];
  return (
    <>
      <AdminHeader
        title="Inventory"
        description="Ingredients and stock on hand. Stock goes down automatically when an order with a recipe moves to In production, and back up if it's cancelled after that."
        actions={<Link href="/admin/suppliers" className="rounded-full border border-line-strong px-4 py-2 text-sm hover:border-ink">Suppliers</Link>}
      />
      <nav aria-label="Ingredient filters" className="mb-4 flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link key={f.key} href={f.key ? `/admin/inventory?show=${f.key}` : "/admin/inventory"} aria-current={(sp.show ?? "") === f.key ? "page" : undefined} className="rounded-full border border-line-strong px-3 py-1.5 text-sm aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-cream">
            {f.label}
          </Link>
        ))}
      </nav>
      <Table head={["Ingredient", "On hand", "Warn at", ...(showCost ? ["Cost"] : []), "Supplier"]} empty={rows.length ? undefined : lowOnly ? "Nothing is running low." : "No ingredients yet."}>
        {rows.map((i) => {
          const cost = i.costPerUnitCents === null ? null : unitCostDisplay(i.costPerUnitCents, i.unit);
          return (
            <tr key={i.id}>
              <td className="px-4 py-3">
                <RowLink href={`/admin/inventory/${i.id}`}>{i.name}</RowLink>
                {!i.active && <span className="ml-2 text-xs text-ink-muted">not in use</span>}
              </td>
              <td className="px-4 py-3 tabular-nums">
                {formatQuantity(i.onHand, i.unit)} {i.onHand < 0 ? <Badge tone="danger">Below zero</Badge> : i.low ? <Badge tone="honey">Low</Badge> : null}
              </td>
              <td className="px-4 py-3 text-ink-muted tabular-nums">{i.reorderLevel === null ? "—" : formatQuantity(i.reorderLevel, i.unit)}</td>
              {showCost && <td className="px-4 py-3 tabular-nums">{cost ? `${formatMoney(Math.round(cost.cents), settings.currency)} / ${cost.per}` : "—"}</td>}
              <td className="px-4 py-3 text-ink-soft">{i.supplier?.name ?? "—"}</td>
            </tr>
          );
        })}
      </Table>
      {manage && (
        <Panel title="Add an ingredient" className="mt-6">
          <IngredientForm suppliers={suppliers.filter((s) => s.active)} showCost={showCost} />
        </Panel>
      )}
    </>
  );
}
