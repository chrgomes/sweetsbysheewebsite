import { asc } from "drizzle-orm";
import { addAdminUser, updateAdminUser } from "@/app/admin/actions/settings";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { Input, Select } from "@/components/ui/field";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "@/lib/permissions";

const roleOptions = ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>);

export const metadata = { title: "Team" };

export default async function UsersPage() {
  const me = await requireAdmin("users:manage");
  const users = await db().query.adminUsers.findMany({ orderBy: [asc(schema.adminUsers.createdAt)], columns: { passwordHash: false } });
  return (
    <>
      <AdminHeader title="Team" description="Each person gets their own sign-in. Roles control what they can see and change." />
      <Panel title="Roles" className="mb-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {ROLES.map((r) => (
            <div key={r}>
              <dt className="font-medium text-ink">{ROLE_LABELS[r]}</dt>
              <dd className="text-ink-soft">{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <div className="space-y-4">
        {users.map((u) => (
          <Panel key={u.id}>
            <AdminForm action={updateAdminUser} submitLabel="Update">
              <input type="hidden" name="id" value={u.id} />
              <p className="font-medium">{u.name} <span className="font-normal text-ink-muted">· {u.email}{u.id === me.id ? " (you)" : ""}</span></p>
              <p className="text-xs text-ink-muted">Last sign-in: {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "never"}</p>
              <div className="flex flex-wrap items-end gap-4">
                <label className="text-sm">Role<Select id={`role-${u.id}`} name="role" defaultValue={u.role} className="mt-1 py-2">{roleOptions}</Select></label>
                <label className="text-sm">Reset password<Input id={`pw-${u.id}`} name="password" type="password" autoComplete="new-password" placeholder="Leave blank to keep" className="mt-1 py-2" /></label>
                <label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" name="active" defaultChecked={u.active} className="size-4" /> Active</label>
              </div>
            </AdminForm>
          </Panel>
        ))}
        <Panel title="Add a team member">
          <AdminForm action={addAdminUser} submitLabel="Create account" resetOnSuccess>
            <div className="grid gap-4 md:grid-cols-4">
              <label className="text-sm">Name<Input id="new-name" name="name" className="mt-1 py-2" /></label>
              <label className="text-sm">Email<Input id="new-email" name="email" type="email" className="mt-1 py-2" /></label>
              <label className="text-sm">Role<Select id="new-role" name="role" defaultValue="order_manager" className="mt-1 py-2">{roleOptions}</Select></label>
              <label className="text-sm">Temporary password<Input id="new-pw" name="password" type="password" autoComplete="new-password" className="mt-1 py-2" /></label>
            </div>
          </AdminForm>
        </Panel>
      </div>
    </>
  );
}
