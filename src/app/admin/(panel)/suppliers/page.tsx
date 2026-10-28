import { saveSupplierAction } from "@/app/admin/actions/inventory";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { requireAdmin } from "@/lib/auth/session";
import { listSuppliers } from "@/lib/inventory";
import { can } from "@/lib/permissions";

export const metadata = { title: "Suppliers" };

type Supplier = Awaited<ReturnType<typeof listSuppliers>>[number];

function SupplierFields({ s }: { s?: Supplier }) {
  const k = s?.id ?? "new";
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <label className="text-sm">Name<Input id={`name-${k}`} name="name" defaultValue={s?.name} maxLength={120} className="mt-1 py-2" /></label>
      <label className="text-sm">Contact person<Input id={`contact-${k}`} name="contactName" defaultValue={s?.contactName ?? ""} className="mt-1 py-2" /></label>
      <label className="text-sm">Email<Input id={`email-${k}`} name="email" type="email" defaultValue={s?.email ?? ""} className="mt-1 py-2" /></label>
      <label className="text-sm">Phone<Input id={`phone-${k}`} name="phone" defaultValue={s?.phone ?? ""} className="mt-1 py-2" /></label>
      <label className="text-sm">Website<Input id={`web-${k}`} name="website" defaultValue={s?.website ?? ""} placeholder="https://" className="mt-1 py-2" /></label>
      <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="active" defaultChecked={s?.active ?? true} className="size-4" /> Active</label>
      <label className="text-sm md:col-span-3">Notes<Input id={`notes-${k}`} name="notes" defaultValue={s?.notes ?? ""} placeholder="Order days, minimums, account number…" className="mt-1 py-2" /></label>
    </div>
  );
}

export default async function SuppliersPage() {
  const admin = await requireAdmin("inventory:view");
  const suppliers = await listSuppliers();
  const manage = can(admin.role, "inventory:manage");
  return (
    <>
      <AdminHeader title="Suppliers" description="Who you buy ingredients from. Link each ingredient to its supplier on the ingredient's page." />
      <div className="space-y-4">
        {suppliers.length === 0 && <p className="text-sm text-ink-soft">No suppliers yet.</p>}
        {suppliers.map((s) => (
          <Panel key={s.id}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium text-ink">{s.name}</span>
              <Badge tone={s.active ? "sage" : "neutral"}>{s.active ? "Active" : "Inactive"}</Badge>
              <span className="text-sm text-ink-muted">{s.ingredients.length} ingredient{s.ingredients.length === 1 ? "" : "s"}</span>
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              {[s.contactName, s.phone].filter(Boolean).join(" · ")}
              {s.email && <> {s.contactName || s.phone ? "· " : ""}<a href={`mailto:${s.email}`} className="text-berry hover:underline">{s.email}</a></>}
              {s.website && <> · <a href={s.website} target="_blank" rel="noopener noreferrer" className="text-berry hover:underline">Website<span className="sr-only"> (opens in a new tab)</span></a></>}
            </p>
            {s.notes && <p className="mt-1 text-sm whitespace-pre-line text-ink-muted">{s.notes}</p>}
            {manage && (
              <details className="mt-3 border-t border-line pt-3">
                <summary className="cursor-pointer text-sm font-medium text-berry">Edit<span className="sr-only"> {s.name}</span></summary>
                <AdminForm action={saveSupplierAction} submitLabel="Save supplier" className="mt-4 space-y-4">
                  <input type="hidden" name="id" value={s.id} />
                  <SupplierFields s={s} />
                </AdminForm>
              </details>
            )}
          </Panel>
        ))}
        {manage && (
          <Panel title="Add a supplier">
            <AdminForm action={saveSupplierAction} submitLabel="Add supplier" resetOnSuccess>
              <SupplierFields />
            </AdminForm>
          </Panel>
        )}
      </div>
    </>
  );
}
