import { changeOwnPassword } from "@/app/admin/actions/settings";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { Field, Input } from "@/components/ui/field";
import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const me = await requireAdmin();
  return (
    <>
      <AdminHeader title="My account" description={`${me.name} · ${me.email} · ${me.role}`} />
      <Panel title="Change password" className="max-w-lg">
        <AdminForm action={changeOwnPassword} submitLabel="Change password" resetOnSuccess>
          <Field id="password" label="New password" required hint="At least 12 characters."><Input id="password" type="password" autoComplete="new-password" hasHint /></Field>
          <Field id="confirm" label="Confirm new password" required><Input id="confirm" type="password" autoComplete="new-password" /></Field>
        </AdminForm>
      </Panel>
    </>
  );
}
