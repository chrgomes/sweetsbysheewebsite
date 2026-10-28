import { desc } from "drizzle-orm";
import { AdminHeader, Table } from "@/components/admin/ui";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Activity log" };

export default async function AuditPage() {
  await requireAdmin("audit:view");
  const rows = await db().query.auditLog.findMany({ orderBy: [desc(schema.auditLog.createdAt)], limit: 300 });
  return (
    <>
      <AdminHeader title="Activity log" description="Sign-ins, price and product changes, order and request updates. Most recent 300 entries." />
      <Table head={["When", "Who", "Action", "Record", "Details"]} empty={rows.length ? undefined : "No activity yet."}>
        {rows.map((r) => (
          <tr key={r.id} className="align-top">
            <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{formatDateTime(r.createdAt)}</td>
            <td className="px-4 py-3">{r.actorLabel}</td>
            <td className="px-4 py-3 font-mono text-xs">{r.action}</td>
            <td className="px-4 py-3 text-xs text-ink-muted">{r.entityType}{r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ""}</td>
            <td className="max-w-md px-4 py-3"><code className="block text-xs break-all whitespace-pre-wrap text-ink-soft">{r.details ? JSON.stringify(r.details).slice(0, 600) : ""}</code></td>
          </tr>
        ))}
      </Table>
    </>
  );
}
