import Link from "next/link";
import { notFound } from "next/navigation";
import { IngredientForm, MovementForms } from "@/components/admin/inventory-forms";
import { AdminHeader, DefinitionList, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { FormAlert } from "@/components/ui/field";
import { requireAdmin } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { getIngredient, listSuppliers, MOVEMENT_LABELS } from "@/lib/inventory";
import { centsToInput, formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { formatQuantity, unitCostDisplay } from "@/lib/recipe-math";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Ingredient" };

export default async function IngredientPage({ params, searchParams }: PageProps<"/admin/inventory/[id]">) {
  const admin = await requireAdmin("inventory:view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [ing, suppliers, settings, sp] = await Promise.all([getIngredient(id), listSuppliers(), getSettings(), searchParams]);
  if (!ing) notFound();
  const showCost = can(admin.role, "costs:view");
  const manage = can(admin.role, "inventory:manage");
  const cost = ing.costPerUnitCents === null ? null : unitCostDisplay(ing.costPerUnitCents, ing.unit);
  const low = ing.reorderLevel !== null && ing.onHand <= ing.reorderLevel;
  const details = {
    id: ing.id,
    name: ing.name,
    unit: ing.unit,
    supplierId: ing.supplierId ?? "",
    cost: cost ? centsToInput(Math.round(cost.cents)) : "",
    reorderLevel: ing.reorderLevel?.toString() ?? "",
    notes: ing.notes ?? "",
    active: ing.active,
  };
  const products = [...new Map(ing.recipeItems.map((ri) => [ri.recipe.product.id, ri.recipe.product])).values()];

  return (
    <>
      <AdminHeader
        title={ing.name}
        description={<Link href="/admin/inventory" className="hover:text-berry">← Inventory</Link>}
        actions={
          <>
            {!ing.active && <Badge tone="neutral">Not in use</Badge>}
            {ing.onHand < 0 ? <Badge tone="danger">Below zero</Badge> : low ? <Badge tone="honey">Low stock</Badge> : null}
          </>
        }
      />
      {sp.created && <div className="mb-6"><FormAlert tone="success">Ingredient added. Record a delivery or a stocktake to set the starting stock.</FormAlert></div>}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Stock">
            <p className="text-3xl text-ink tabular-nums">{formatQuantity(ing.onHand, ing.unit)}</p>
            <div className="mt-4">
              <DefinitionList items={[
                ["Warn at", ing.reorderLevel === null ? null : formatQuantity(ing.reorderLevel, ing.unit)],
                ["Cost", showCost ? (cost ? `${formatMoney(Math.round(cost.cents), settings.currency)} per ${cost.per}` : "Not known yet") : null],
                ["Supplier", ing.supplier ? <Link key="s" href="/admin/suppliers" className="text-berry hover:underline">{ing.supplier.name}</Link> : null],
                ["Used in", products.length ? products.map((p) => <Link key={p.id} href={`/admin/products/${p.id}`} className="mr-3 text-berry hover:underline">{p.name}</Link>) : "No recipes yet"],
                ["Notes", ing.notes],
              ]} />
            </div>
          </Panel>
          {manage && (
            <Panel title="Update stock">
              <MovementForms ingredientId={ing.id} unit={ing.unit} showCost={showCost} />
            </Panel>
          )}
          <Panel title="History">
            {ing.movements.length === 0 ? (
              <p className="text-sm text-ink-soft">No stock recorded yet.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {ing.movements.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                    <span>
                      <span className="font-medium">{MOVEMENT_LABELS[m.kind]}</span>
                      {m.order && <> · <Link href={`/admin/orders/${m.order.id}`} className="text-berry hover:underline">{m.order.reference}</Link></>}
                      {m.note && <span className="text-ink-soft"> · {m.note}</span>}
                      <span className="block text-xs text-ink-muted">{formatDateTime(m.createdAt)}</span>
                    </span>
                    <span className={`tabular-nums ${m.quantity < 0 ? "text-danger" : "text-sage"}`}>
                      {m.quantity > 0 ? "+" : ""}
                      {formatQuantity(m.quantity, ing.unit)}
                      {showCost && m.kind === "receipt" && m.unitCostCents !== null && <span className="block text-right text-xs text-ink-muted">{formatMoney(Math.round(m.unitCostCents * m.quantity), settings.currency)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        {manage && (
          <Panel title="Details">
            {/* Keyed on the cost so a delivery that updates it remounts the form; otherwise the stale
                default would be written back by the next save. */}
            <IngredientForm
              key={details.cost}
              compact
              d={details}
              suppliers={suppliers.filter((s) => s.active || s.id === ing.supplierId)}
              showCost={showCost}
              unitLocked={ing.movements.length > 0 || ing.recipeItems.length > 0}
            />
          </Panel>
        )}
      </div>
    </>
  );
}
