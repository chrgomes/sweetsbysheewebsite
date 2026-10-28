import { asc, eq } from "drizzle-orm";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { saveOptions, updateProductImage, uploadProductImage } from "@/app/admin/actions/products";
import { AdminForm } from "@/components/admin/admin-form";
import { RecipeEditor } from "@/components/admin/inventory-forms";
import { OptionsEditor } from "@/components/admin/options-editor";
import { ProductForm } from "@/components/admin/product-form";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { FormAlert, Input } from "@/components/ui/field";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { getRecipe, listIngredients, productCosts } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { formatQuantity, marginOf } from "@/lib/recipe-math";

export const metadata = { title: "Edit product" };

export default async function EditProduct({ params, searchParams }: PageProps<"/admin/products/[id]">) {
  const admin = await requireAdmin("products:view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [product, categories, collections, memberships] = await Promise.all([
    db().query.products.findFirst({
      where: eq(schema.products.id, id),
      with: { images: { orderBy: (i, { asc }) => [asc(i.sortOrder)] }, options: { orderBy: (o, { asc }) => [asc(o.sortOrder)], with: { values: { orderBy: (v, { asc }) => [asc(v.sortOrder)] } } } },
    }),
    db().query.categories.findMany({ orderBy: [asc(schema.categories.sortOrder)] }),
    db().query.collections.findMany({ orderBy: [asc(schema.collections.sortOrder), asc(schema.collections.name)], columns: { id: true, name: true } }),
    db().query.productCollections.findMany({ where: eq(schema.productCollections.productId, id) }),
  ]);
  if (!product) notFound();
  const showRecipe = can(admin.role, "inventory:view") || can(admin.role, "products:edit");
  const [recipe, ingredientList, costs] = showRecipe
    ? await Promise.all([getRecipe(product.id), listIngredients(), productCosts([product.id])])
    : [undefined, [], new Map()];
  const cost = costs.get(product.id);
  const margin = cost ? marginOf(product.basePriceCents, cost.cents) : null;
  return (
    <>
      <AdminHeader
        title={product.name}
        actions={
          product.status === "active" || product.status === "unavailable" ? (
            <Link href={`/products/${product.slug}`} className="text-sm text-berry hover:underline" target="_blank">View on site ↗</Link>
          ) : (
            <Link href={`/products/${product.slug}?preview=1`} className="text-sm text-berry hover:underline" target="_blank">Preview ↗</Link>
          )
        }
      />
      {sp.created && <div className="mb-6"><FormAlert tone="success">Product created. Add options and photos below.</FormAlert></div>}
      <div className="grid gap-6 2xl:grid-cols-5">
        <Panel title="Details" className="2xl:col-span-3"><ProductForm product={product} categories={categories} collections={collections} memberOf={memberships.map((m) => m.collectionId)} /></Panel>
        <div className="space-y-6 2xl:col-span-2">
          {showRecipe && (
            <Panel title="Recipe">
              {can(admin.role, "costs:view") && cost && (
                <p className="mb-4 text-sm text-ink-soft">
                  Ingredient cost: <strong className="text-ink">{cost.cents === null ? "—" : formatMoney(cost.cents, product.currency)}</strong> each
                  {margin !== null && <> · margin at the base price <strong className="text-ink">{Math.round(margin * 100)}%</strong></>}
                  {cost.cents !== null &&
                    product.options.flatMap((o) => o.values.filter((v) => v.recipeScale !== 1).map((v) => ({ o, v }))).map(({ o, v }) => (
                      <span key={v.id} className="block">
                        {o.name} “{v.label}” (×{v.recipeScale}): {formatMoney(Math.round(cost.cents! * v.recipeScale), product.currency)}
                        {product.basePriceCents !== null && <> · margin {Math.round((marginOf(product.basePriceCents + v.priceDeltaCents, Math.round(cost.cents! * v.recipeScale)) ?? 0) * 100)}%</>}
                      </span>
                    ))}
                  {cost.missing.length > 0 && <span className="block text-honey">{cost.missing.length} ingredient{cost.missing.length === 1 ? " has" : "s have"} no cost yet, so this is too low.</span>}
                </p>
              )}
              {can(admin.role, "products:edit") ? (
                <RecipeEditor
                  productId={product.id}
                  ingredients={ingredientList.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))}
                  initial={{
                    yieldQuantity: recipe?.yieldQuantity.toString() ?? "1",
                    notes: recipe?.notes ?? "",
                    items: recipe?.items.map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity.toString() })) ?? [],
                  }}
                />
              ) : recipe ? (
                <ul className="space-y-1 text-sm">
                  <li className="text-ink-muted">One batch makes {recipe.yieldQuantity}</li>
                  {recipe.items.map((i) => <li key={i.id}>{formatQuantity(i.quantity, i.ingredient.unit)} {i.ingredient.name}</li>)}
                </ul>
              ) : (
                <p className="text-sm text-ink-soft">No recipe yet.</p>
              )}
            </Panel>
          )}
          <Panel title="Options & prices">
            <AdminForm action={saveOptions} submitLabel="Save options">
              <input type="hidden" name="productId" value={product.id} />
              <OptionsEditor initial={product.options} />
            </AdminForm>
          </Panel>
          <Panel title="Photos">
            <ul className="space-y-4">
              {product.images.map((img) => (
                <li key={img.id} className="flex gap-4 rounded-xl border border-line p-3">
                  <div className="relative size-24 shrink-0 overflow-hidden rounded-lg bg-blush">
                    <Image src={img.src} alt={img.alt} fill sizes="96px" className="object-cover" />
                  </div>
                  <AdminForm action={updateProductImage} submitLabel="Update" className="flex-1 space-y-2">
                    <input type="hidden" name="imageId" value={img.id} />
                    <label className="block text-xs text-ink-muted" htmlFor={`alt-${img.id}`}>Alt text</label>
                    <Input id={`alt-${img.id}`} name="alt" defaultValue={img.alt} className="py-2 text-sm" />
                    <div className="flex items-center gap-3">
                      <label className="text-xs text-ink-muted" htmlFor={`order-${img.id}`}>Order</label>
                      <Input id={`order-${img.id}`} name="sortOrder" defaultValue={img.sortOrder} className="w-20 py-2 text-sm" inputMode="numeric" />
                      <label className="flex items-center gap-1 text-xs text-danger"><input type="checkbox" name="intent" value="delete" /> Remove</label>
                    </div>
                  </AdminForm>
                </li>
              ))}
            </ul>
            <div className="mt-6 border-t border-line pt-6">
              <AdminForm action={uploadProductImage} submitLabel="Upload photo" encType="multipart/form-data" resetOnSuccess>
                <input type="hidden" name="productId" value={product.id} />
                <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Photo file" className="block w-full text-sm" />
                <label htmlFor="new-alt" className="block text-sm">Alt text <span className="text-ink-muted">— describe what the photo shows</span></label>
                <Input id="new-alt" name="alt" placeholder="e.g. Two-tier white cake with pressed pink flowers" />
              </AdminForm>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
