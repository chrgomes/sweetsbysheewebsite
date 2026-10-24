import { asc, eq } from "drizzle-orm";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { saveOptions, updateProductImage, uploadProductImage } from "@/app/admin/actions/products";
import { AdminForm } from "@/components/admin/admin-form";
import { OptionsEditor } from "@/components/admin/options-editor";
import { ProductForm } from "@/components/admin/product-form";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { FormAlert, Input } from "@/components/ui/field";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "Edit product" };

export default async function EditProduct({ params, searchParams }: PageProps<"/admin/products/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [product, categories] = await Promise.all([
    db().query.products.findFirst({
      where: eq(schema.products.id, id),
      with: { images: { orderBy: (i, { asc }) => [asc(i.sortOrder)] }, options: { orderBy: (o, { asc }) => [asc(o.sortOrder)], with: { values: { orderBy: (v, { asc }) => [asc(v.sortOrder)] } } } },
    }),
    db().query.categories.findMany({ orderBy: [asc(schema.categories.sortOrder)] }),
  ]);
  if (!product) notFound();
  return (
    <>
      <AdminHeader
        title={product.name}
        actions={product.status === "active" || product.status === "unavailable" ? <Link href={`/products/${product.slug}`} className="text-sm text-berry hover:underline" target="_blank">View on site ↗</Link> : undefined}
      />
      {sp.created && <div className="mb-6"><FormAlert tone="success">Product created. Add options and photos below.</FormAlert></div>}
      <div className="grid gap-6 2xl:grid-cols-5">
        <Panel title="Details" className="2xl:col-span-3"><ProductForm product={product} categories={categories} /></Panel>
        <div className="space-y-6 2xl:col-span-2">
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
