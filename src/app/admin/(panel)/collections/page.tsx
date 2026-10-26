import { asc } from "drizzle-orm";
import Link from "next/link";
import { saveCollection } from "@/app/admin/actions/content";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "Collections" };

type Collection = typeof schema.collections.$inferSelect;

function CollectionFields({ c }: { c?: Collection }) {
  const k = c?.id ?? "new";
  return (
    <div className="grid gap-3 md:grid-cols-6">
      <label className="text-sm md:col-span-2">Name<Input id={`name-${k}`} name="name" defaultValue={c?.name} className="mt-1 py-2" /></label>
      <label className="text-sm md:col-span-2">Slug<Input id={`slug-${k}`} name="slug" defaultValue={c?.slug} placeholder="auto" className="mt-1 py-2" /></label>
      <label className="text-sm">Order<Input id={`sort-${k}`} name="sortOrder" defaultValue={c?.sortOrder ?? 0} inputMode="numeric" className="mt-1 py-2" /></label>
      <div className="space-y-2 pt-6 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={c?.active ?? true} className="size-4" /> Active</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="featured" defaultChecked={c?.featured ?? false} className="size-4" /> On homepage</label>
      </div>
      <label className="text-sm md:col-span-4">Description<Input id={`desc-${k}`} name="description" defaultValue={c?.description ?? ""} className="mt-1 py-2" /></label>
      <label className="text-sm">Starts<Input id={`starts-${k}`} name="startsOn" type="date" defaultValue={c?.startsOn ?? ""} className="mt-1 py-2" /></label>
      <label className="text-sm">Ends<Input id={`ends-${k}`} name="endsOn" type="date" defaultValue={c?.endsOn ?? ""} className="mt-1 py-2" /></label>
    </div>
  );
}

export default async function CollectionsPage() {
  await requireAdmin("products:edit");
  const rows = await db().query.collections.findMany({ orderBy: [asc(schema.collections.sortOrder), asc(schema.collections.name)], with: { products: { columns: { productId: true } } } });
  return (
    <>
      <AdminHeader title="Collections" description="Seasonal or themed groups such as “Holiday treats”. Dates are optional and limit when a collection shows. Add products from each product's page." />
      <div className="space-y-4">
        {rows.map((c) => (
          <Panel key={c.id}>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={c.active ? "sage" : "neutral"}>{c.active ? "Active" : "Hidden"}</Badge>
              {c.featured && <Badge tone="berry">Homepage</Badge>}
              <span className="text-ink-muted">{c.products.length} product{c.products.length === 1 ? "" : "s"}</span>
              {c.active && c.products.length > 0 && <Link href={`/collections/${c.slug}`} target="_blank" className="text-berry hover:underline">View ↗</Link>}
            </div>
            <AdminForm action={saveCollection}>
              <input type="hidden" name="id" value={c.id} />
              <CollectionFields c={c} />
              <label className="flex items-center gap-2 text-sm text-danger"><input type="checkbox" name="intent" value="delete" /> Delete this collection</label>
            </AdminForm>
          </Panel>
        ))}
        <Panel title="Add a collection">
          <AdminForm action={saveCollection} submitLabel="Add collection" resetOnSuccess><CollectionFields /></AdminForm>
        </Panel>
      </div>
    </>
  );
}
