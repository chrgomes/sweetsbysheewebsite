import { asc } from "drizzle-orm";
import { saveCategory } from "@/app/admin/actions/content";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { Input } from "@/components/ui/field";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "Categories" };

function CategoryFields({ c }: { c?: typeof schema.categories.$inferSelect }) {
  const k = c?.id ?? "new";
  return (
    <div className="grid gap-3 md:grid-cols-6">
      <label className="text-sm md:col-span-2">Name<Input id={`name-${k}`} name="name" defaultValue={c?.name} className="mt-1 py-2" /></label>
      <label className="text-sm md:col-span-2">Slug<Input id={`slug-${k}`} name="slug" defaultValue={c?.slug} placeholder="auto" className="mt-1 py-2" /></label>
      <label className="text-sm">Order<Input id={`sort-${k}`} name="sortOrder" defaultValue={c?.sortOrder ?? 0} inputMode="numeric" className="mt-1 py-2" /></label>
      <label className="text-sm md:col-span-6">Description<Input id={`desc-${k}`} name="description" defaultValue={c?.description ?? ""} className="mt-1 py-2" /></label>
      <label className="text-sm md:col-span-3">Search title<Input id={`seot-${k}`} name="seoTitle" defaultValue={c?.seoTitle ?? ""} className="mt-1 py-2" /></label>
      <label className="text-sm md:col-span-3">Search description<Input id={`seod-${k}`} name="seoDescription" defaultValue={c?.seoDescription ?? ""} className="mt-1 py-2" /></label>
    </div>
  );
}

export default async function CategoriesPage() {
  await requireAdmin("products:view");
  const cats = await db().query.categories.findMany({ orderBy: [asc(schema.categories.sortOrder), asc(schema.categories.name)] });
  return (
    <>
      <AdminHeader title="Categories" />
      <div className="space-y-4">
        {cats.map((c) => (
          <Panel key={c.id}>
            <AdminForm action={saveCategory}>
              <input type="hidden" name="id" value={c.id} />
              <CategoryFields c={c} />
              <label className="flex items-center gap-2 text-sm text-danger"><input type="checkbox" name="intent" value="delete" /> Delete this category</label>
            </AdminForm>
          </Panel>
        ))}
        <Panel title="Add a category">
          <AdminForm action={saveCategory} submitLabel="Add category" resetOnSuccess><CategoryFields /></AdminForm>
        </Panel>
      </div>
    </>
  );
}
