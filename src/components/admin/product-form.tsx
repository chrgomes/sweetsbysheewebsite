"use client";

import { saveProduct } from "@/app/admin/actions/products";
import { AdminForm } from "@/components/admin/admin-form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import type { schema } from "@/db";
import { centsToInput } from "@/lib/money";

type Product = typeof schema.products.$inferSelect;

function Check({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-[var(--berry)]" />
      <span>
        <span className="text-ink">{label}</span>
        {hint && <span className="block text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function ProductForm({ product, categories, collections = [], memberOf = [] }: { product?: Product; categories: { id: string; name: string }[]; collections?: { id: string; name: string }[]; memberOf?: string[] }) {
  const p = product;
  return (
    <AdminForm action={saveProduct} submitLabel={p ? "Save product" : "Create product"} className="space-y-6">
      {(state) => {
        const e = state.errors ?? {};
        return (
          <>
            {p && <input type="hidden" name="id" value={p.id} />}
            <div className="grid gap-5 md:grid-cols-2">
              <Field id="name" label="Name" required error={e.name}><Input id="name" defaultValue={p?.name} error={e.name} /></Field>
              <Field id="slug" label="URL slug" error={e.slug} hint="Leave blank to generate from the name."><Input id="slug" defaultValue={p?.slug} error={e.slug} hasHint /></Field>
              <Field id="categoryId" label="Category" error={e.categoryId}>
                <Select id="categoryId" defaultValue={p?.categoryId ?? ""}>
                  <option value="">No category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field id="status" label="Status" required hint="Draft and archived products are hidden from the site.">
                <Select id="status" defaultValue={p?.status ?? "draft"} hasHint>
                  <option value="draft">Draft (hidden)</option>
                  <option value="active">Active</option>
                  <option value="unavailable">Visible but unavailable</option>
                  <option value="archived">Archived (hidden)</option>
                </Select>
              </Field>
            </div>
            <Field id="summary" label="Short summary" error={e.summary}><Input id="summary" defaultValue={p?.summary ?? ""} maxLength={300} /></Field>
            <Field id="description" label="Description" error={e.description}><Textarea id="description" rows={6} defaultValue={p?.description ?? ""} /></Field>

            <fieldset className="grid gap-5 rounded-xl border border-line p-4 md:grid-cols-3">
              <legend className="px-1 text-sm font-semibold">Ordering</legend>
              <Field id="basePrice" label="Base price ($)" error={e.basePrice} hint="Leave blank for “price on request”."><Input id="basePrice" inputMode="decimal" defaultValue={centsToInput(p?.basePriceCents)} error={e.basePrice} hasHint /></Field>
              <Field id="leadTimeHours" label="Notice needed (hours)" error={e.leadTimeHours}><Input id="leadTimeHours" inputMode="numeric" defaultValue={p?.leadTimeHours?.toString() ?? ""} error={e.leadTimeHours} /></Field>
              <Field id="maxPerOrder" label="Max per order" error={e.maxPerOrder}><Input id="maxPerOrder" inputMode="numeric" defaultValue={p?.maxPerOrder?.toString() ?? ""} error={e.maxPerOrder} /></Field>
              <Field id="capacityUnits" label="Capacity units (each)" error={e.capacityUnits} hint="How much of a day's production one of these uses. 0 = doesn't count."><Input id="capacityUnits" inputMode="numeric" defaultValue={p?.capacityUnits?.toString() ?? "1"} error={e.capacityUnits} hasHint /></Field>
              <div className="space-y-3 md:col-span-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
                <Check name="directPurchase" label="Sell through online checkout" defaultChecked={p?.directPurchase ?? false} hint="Requires a base price." />
                <Check name="customOrder" label="Offer on the custom-order form" defaultChecked={p?.customOrder ?? false} />
                <Check name="pickupEligible" label="Available for pickup" defaultChecked={p?.pickupEligible ?? true} />
                <Check name="deliveryEligible" label="Available for delivery" defaultChecked={p?.deliveryEligible ?? false} />
                <Check name="featured" label="Feature on the homepage" defaultChecked={p?.featured ?? false} />
              </div>
            </fieldset>

            {collections.length > 0 && (
              <fieldset className="rounded-xl border border-line p-4">
                <legend className="px-1 text-sm font-semibold">Collections</legend>
                <div className="flex flex-wrap gap-4">
                  {collections.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="collectionIds" value={c.id} defaultChecked={memberOf.includes(c.id)} className="size-4" /> {c.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="grid gap-5 md:grid-cols-3">
              <Field id="servings" label="Serves"><Input id="servings" defaultValue={p?.servings ?? ""} /></Field>
              <Field id="sortOrder" label="Sort order" error={e.sortOrder}><Input id="sortOrder" inputMode="numeric" defaultValue={p?.sortOrder?.toString() ?? "0"} /></Field>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <Field id="ingredients" label="Ingredients"><Textarea id="ingredients" rows={3} defaultValue={p?.ingredients ?? ""} /></Field>
              <Field id="allergens" label="Allergens" hint="Only list what you've confirmed."><Textarea id="allergens" rows={3} defaultValue={p?.allergens ?? ""} hasHint /></Field>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <Field id="seoTitle" label="Search title"><Input id="seoTitle" maxLength={70} defaultValue={p?.seoTitle ?? ""} /></Field>
              <Field id="seoDescription" label="Search description"><Input id="seoDescription" maxLength={170} defaultValue={p?.seoDescription ?? ""} /></Field>
            </div>
            <fieldset className="grid gap-5 rounded-xl border border-line p-4 md:grid-cols-2">
              <legend className="px-1 text-sm font-semibold">Content review</legend>
              <Field id="migrationStatus" label="Review status" required>
                <Select id="migrationStatus" defaultValue={p?.migrationStatus ?? "owner_created"}>
                  <option value="needs_review">Needs review (migrated, unconfirmed)</option>
                  <option value="verified">Verified by owner</option>
                  <option value="owner_created">Created by owner</option>
                </Select>
              </Field>
              <Field id="migrationNotes" label="Review notes"><Textarea id="migrationNotes" rows={2} defaultValue={p?.migrationNotes ?? ""} /></Field>
              {p?.sourceUrl && <p className="text-xs text-ink-muted md:col-span-2">Migrated from <span className="break-all">{p.sourceUrl}</span></p>}
            </fieldset>
          </>
        );
      }}
    </AdminForm>
  );
}
