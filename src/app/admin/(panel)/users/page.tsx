import { asc } from "drizzle-orm";
import { addAdminUser, deleteAdminUserAction, updateAdminUser } from "@/app/admin/actions/settings";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
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
  const activeOwners = users.filter((u) => u.role === "owner" && u.active).length;
  return (
    <>
      <AdminHeader title="Team" description={`${users.length} account${users.length === 1 ? "" : "s"}. Each person gets their own sign-in; roles control what they can see and change.`} />

      <Panel title="Add a team member" className="mb-6">
        <AdminForm action={addAdminUser} submitLabel="Create account" resetOnSuccess>
          <div className="grid gap-4 md:grid-cols-4">
            <label className="text-sm">Name<Input id="new-name" name="name" autoComplete="off" className="mt-1 py-2" /></label>
            <label className="text-sm">Email<Input id="new-email" name="email" type="email" autoComplete="off" className="mt-1 py-2" /></label>
            <label className="text-sm">Role<Select id="new-role" name="role" defaultValue="order_manager" className="mt-1 py-2">{roleOptions}</Select></label>
            <label className="text-sm">Temporary password<Input id="new-pw" name="password" type="password" autoComplete="new-password" className="mt-1 py-2" /></label>
          </div>
          <p className="text-xs text-ink-muted">At least 12 characters. Share it privately and ask them to change it under My account.</p>
        </AdminForm>
      </Panel>

      <ul className="space-y-3" aria-label="Team members">
        {users.map((u) => {
          const isMe = u.id === me.id;
          const lastOwner = u.role === "owner" && u.active && activeOwners <= 1;
          return (
            <li key={u.id}>
              <Panel className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {u.name} {isMe && <span className="font-normal text-ink-muted">(you)</span>}
                    </p>
                    <p className="truncate text-sm text-ink-soft">{u.email}</p>
                    <p className="text-xs text-ink-muted">Last sign-in: {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "never"} · Added {formatDateTime(u.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={u.role === "owner" ? "berry" : "neutral"}>{ROLE_LABELS[u.role]}</Badge>
                    <Badge tone={u.active ? "sage" : "danger"}>{u.active ? "Active" : "Deactivated"}</Badge>
                  </div>
                </div>

                <details className="mt-3 border-t border-line pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-berry">Edit<span className="sr-only"> {u.email}</span></summary>
                  <AdminForm action={updateAdminUser} submitLabel="Save changes" className="mt-4 space-y-4">
                    <input type="hidden" name="id" value={u.id} />
                    <div className="flex flex-wrap items-end gap-4">
                      <label className="text-sm">Role<Select id={`role-${u.id}`} name="role" defaultValue={u.role} className="mt-1 py-2">{roleOptions}</Select></label>
                      <label className="text-sm">Reset password<Input id={`pw-${u.id}`} name="password" type="password" autoComplete="new-password" placeholder="Leave blank to keep" className="mt-1 py-2" /></label>
                      <label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" name="active" defaultChecked={u.active} className="size-4" /> Active</label>
                    </div>
                  </AdminForm>
                </details>

                {!isMe && !lastOwner && (
                  <details className="mt-3 border-t border-line pt-3">
                    <summary className="cursor-pointer text-sm font-medium text-danger">Delete<span className="sr-only"> {u.email}</span></summary>
                    <AdminForm action={deleteAdminUserAction} submitLabel="Delete account" variant="danger" className="mt-4 space-y-3">
                      <input type="hidden" name="id" value={u.id} />
                      <p className="text-sm text-ink-soft">
                        Permanently removes {u.email} and signs them out. Their past actions stay in the activity log. To keep the account but block access, untick <em>Active</em> instead.
                      </p>
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" className="size-4" /> I want to delete this account</label>
                    </AdminForm>
                  </details>
                )}
                {lastOwner && !isMe && <p className="mt-3 text-xs text-ink-muted">This is the only active owner, so it can&apos;t be deleted.</p>}
              </Panel>
            </li>
          );
        })}
      </ul>

      <Panel title="Roles" className="mt-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {ROLES.map((r) => (
            <div key={r}>
              <dt className="font-medium text-ink">{ROLE_LABELS[r]}</dt>
              <dd className="text-ink-soft">{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </>
  );
}
