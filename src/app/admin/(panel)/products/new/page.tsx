import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { ProductForm } from "@/components/admin/product-form";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "New product" };

export default async function NewProduct() {
  await requireAdmin();
  const categories = await db().query.categories.findMany({ orderBy: [asc(schema.categories.sortOrder)] });
  return (
    <>
      <AdminHeader title="New product" description="You can add options and photos after creating it." />
      <Panel><ProductForm categories={categories} /></Panel>
    </>
  );
}
