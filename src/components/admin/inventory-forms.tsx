"use client";

import { useState } from "react";
import { recordMovementAction, saveIngredientAction, saveRecipeAction } from "@/app/admin/actions/inventory";
import { AdminForm } from "@/components/admin/admin-form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

type Unit = "g" | "ml" | "each";
const UNIT_OPTIONS: { value: Unit; label: string }[] = [
  { value: "g", label: "Grams (g)" },
  { value: "ml", label: "Millilitres (ml)" },
  { value: "each", label: "Each (eggs, boxes…)" },
];
const per = (u: Unit) => (u === "g" ? "kg" : u === "ml" ? "L" : "each");

export type IngredientFormValues = {
  id?: string;
  name: string;
  unit: Unit;
  supplierId: string;
  /** Price per kg / L / each, as typed (e.g. "2.40"). */
  cost: string;
  reorderLevel: string;
  notes: string;
  active: boolean;
};

export function IngredientForm({ d, suppliers, showCost, unitLocked, compact }: { d?: IngredientFormValues; suppliers: { id: string; name: string }[]; showCost: boolean; unitLocked?: boolean; compact?: boolean }) {
  const [unit, setUnit] = useState<Unit>(d?.unit ?? "g");
  const k = d?.id ?? "new";
  return (
    <AdminForm action={saveIngredientAction} submitLabel={d?.id ? "Save ingredient" : "Add ingredient"}>
      {(st) => {
        const e = st.errors ?? {};
        return (
          <>
            {d?.id && <input type="hidden" name="id" value={d.id} />}
            <div className={compact ? "grid gap-4" : "grid gap-4 md:grid-cols-3"}>
              <Field id={`name-${k}`} label="Name" required error={e.name}>
                <Input id={`name-${k}`} name="name" maxLength={120} defaultValue={d?.name} error={e.name} />
              </Field>
              <Field id={`unit-${k}`} label="Counted in" required hint={unitLocked ? "Can't change once used." : undefined}>
                <Select id={`unit-${k}`} name="unit" value={unit} onChange={(ev) => setUnit(ev.target.value as Unit)} disabled={unitLocked} hasHint={unitLocked}>
                  {UNIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                {unitLocked && <input type="hidden" name="unit" value={unit} />}
              </Field>
              <Field id={`supplier-${k}`} label="Supplier">
                <Select id={`supplier-${k}`} name="supplierId" defaultValue={d?.supplierId ?? ""}>
                  <option value="">None</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              {showCost && (
                <Field id={`cost-${k}`} label={`Cost per ${per(unit)} ($)`} hint="Updated automatically when you record a delivery with its cost." error={e.cost ?? e.costPerUnitCents}>
                  <Input id={`cost-${k}`} name="cost" inputMode="decimal" defaultValue={d?.cost} hasHint error={e.cost ?? e.costPerUnitCents} />
                </Field>
              )}
              <Field id={`reorder-${k}`} label={`Warn when stock is at or below (${unit})`} error={e.reorderLevel}>
                <Input id={`reorder-${k}`} name="reorderLevel" inputMode="decimal" defaultValue={d?.reorderLevel} error={e.reorderLevel} />
              </Field>
              {d?.id && (
                <label className={compact ? "flex items-center gap-2 text-sm" : "flex items-center gap-2 pt-7 text-sm"}>
                  <input type="checkbox" name="active" defaultChecked={d.active} className="size-4" /> In use
                </label>
              )}
            </div>
            <Field id={`notes-${k}`} label="Notes">
              <Textarea id={`notes-${k}`} name="notes" rows={2} maxLength={2000} defaultValue={d?.notes} />
            </Field>
          </>
        );
      }}
    </AdminForm>
  );
}

/** Delivery, stocktake and waste forms for one ingredient. */
export function MovementForms({ ingredientId, unit, showCost }: { ingredientId: string; unit: Unit; showCost: boolean }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="receive-heading">
        <h3 id="receive-heading" className="mb-3 text-sm font-semibold text-ink">Delivery received</h3>
        <AdminForm action={recordMovementAction} submitLabel="Add to stock" resetOnSuccess>
          {(st) => (
            <>
              <input type="hidden" name="ingredientId" value={ingredientId} />
              <input type="hidden" name="type" value="receipt" />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="rcv-qty" label={`Amount (${unit})`} required error={st.errors?.quantity}>
                  <Input id="rcv-qty" name="quantity" inputMode="decimal" error={st.errors?.quantity} />
                </Field>
                {showCost && (
                  <Field id="rcv-cost" label="Total paid ($)" error={st.errors?.totalCost}>
                    <Input id="rcv-cost" name="totalCost" inputMode="decimal" error={st.errors?.totalCost} />
                  </Field>
                )}
                <Field id="rcv-note" label="Note">
                  <Input id="rcv-note" name="note" maxLength={500} placeholder="e.g. Invoice 1042" />
                </Field>
              </div>
            </>
          )}
        </AdminForm>
      </section>
      <section aria-labelledby="count-heading">
        <h3 id="count-heading" className="mb-3 text-sm font-semibold text-ink">Stocktake</h3>
        <AdminForm action={recordMovementAction} submitLabel="Set stock to this count" variant="secondary" resetOnSuccess>
          {(st) => (
            <>
              <input type="hidden" name="ingredientId" value={ingredientId} />
              <input type="hidden" name="type" value="stocktake" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="cnt-qty" label={`Counted (${unit})`} required error={st.errors?.counted}>
                  <Input id="cnt-qty" name="counted" inputMode="decimal" error={st.errors?.counted} />
                </Field>
                <Field id="cnt-note" label="Reason" required error={st.errors?.note}>
                  <Input id="cnt-note" name="note" maxLength={500} placeholder="e.g. Weekly count" error={st.errors?.note} />
                </Field>
              </div>
            </>
          )}
        </AdminForm>
      </section>
      <section aria-labelledby="waste-heading">
        <h3 id="waste-heading" className="mb-3 text-sm font-semibold text-ink">Waste</h3>
        <AdminForm action={recordMovementAction} submitLabel="Record waste" variant="secondary" resetOnSuccess>
          {(st) => (
            <>
              <input type="hidden" name="ingredientId" value={ingredientId} />
              <input type="hidden" name="type" value="waste" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="wst-qty" label={`Amount (${unit})`} required error={st.errors?.quantity}>
                  <Input id="wst-qty" name="quantity" inputMode="decimal" error={st.errors?.quantity} />
                </Field>
                <Field id="wst-note" label="What happened" required error={st.errors?.note}>
                  <Input id="wst-note" name="note" maxLength={500} placeholder="e.g. Past its date" error={st.errors?.note} />
                </Field>
              </div>
            </>
          )}
        </AdminForm>
      </section>
    </div>
  );
}

export type RecipeEditorIngredient = { id: string; name: string; unit: Unit };

/** Ingredient rows for a product's recipe. Saving with no rows removes the recipe. */
export function RecipeEditor({
  productId,
  ingredients,
  initial,
}: {
  productId: string;
  ingredients: RecipeEditorIngredient[];
  initial: { yieldQuantity: string; notes: string; items: { ingredientId: string; quantity: string }[] };
}) {
  const [rows, setRows] = useState(() => initial.items.map((it, i) => ({ ...it, key: i })));
  const [nextKey, setNextKey] = useState(initial.items.length);
  const unitOf = (id: string) => ingredients.find((i) => i.id === id)?.unit ?? "";
  const update = (key: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  if (!ingredients.length) return <p className="text-sm text-ink-soft">Add ingredients under Inventory first, then build the recipe here.</p>;
  return (
    <AdminForm action={saveRecipeAction} submitLabel="Save recipe">
      <input type="hidden" name="productId" value={productId} />
      <Field id="yieldQuantity" label="One batch makes" required hint="How many of this product the quantities below make.">
        <Input id="yieldQuantity" name="yieldQuantity" inputMode="decimal" defaultValue={initial.yieldQuantity} hasHint className="sm:max-w-40" />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">Ingredients per batch</legend>
        {rows.map((r, i) => (
          <div key={r.key} className="grid grid-cols-[1fr_7rem_2.5rem_2.75rem] items-center gap-2">
            <Select id={`ri-${r.key}`} name="ingredientId" aria-label={`Ingredient ${i + 1}`} value={r.ingredientId} onChange={(e) => update(r.key, { ingredientId: e.target.value })}>
              <option value="">Choose…</option>
              {ingredients.map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
            </Select>
            <Input id={`rq-${r.key}`} name="quantity" aria-label={`Ingredient ${i + 1} quantity`} inputMode="decimal" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
            <span className="text-sm text-ink-muted">{unitOf(r.ingredientId)}</span>
            <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="min-h-11 rounded-full text-sm text-ink-muted hover:text-danger" aria-label={`Remove ingredient ${i + 1}`}>
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            setRows((rs) => [...rs, { ingredientId: "", quantity: "", key: nextKey }]);
            setNextKey((n) => n + 1);
          }}
          className="text-sm font-medium text-berry hover:underline"
        >
          + Add ingredient
        </button>
      </fieldset>
      <Field id="recipeNotes" label="Method notes">
        <Textarea id="recipeNotes" name="notes" rows={3} maxLength={4000} defaultValue={initial.notes} />
      </Field>
      <p className="text-xs text-ink-muted">When an order goes into production, these quantities (scaled by how many were ordered) come off stock automatically. Options like size don&apos;t change the amounts yet.</p>
    </AdminForm>
  );
}
