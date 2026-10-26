import { DiscountForm } from "@/components/admin/forms";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth/session";
import { dateInZone } from "@/lib/dates";
import { listDiscounts } from "@/lib/discounts";
import { centsToInput, formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Discount codes" };

export default async function DiscountsPage() {
  await requireAdmin("discounts:manage");
  const [rows, settings] = await Promise.all([listDiscounts(), getSettings()]);
  const tz = settings.timezone;
  return (
    <>
      <AdminHeader title="Discount codes" description="Codes customers enter at checkout. Discounts apply to products before delivery and tax, and are always recalculated on the server." />
      <div className="space-y-4">
        <Panel title="New code">
          <DiscountForm />
        </Panel>
        {rows.map((d) => (
          <Panel key={d.id}>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="font-mono text-lg">{d.code}</span>
              <Badge tone={d.active ? "sage" : "neutral"}>{d.active ? "Active" : "Off"}</Badge>
              <span className="text-sm text-ink-muted">
                {d.kind === "percent" ? `${d.value / 100}% off` : `${formatMoney(d.value, settings.currency)} off`} · used {d.confirmedUses}
                {d.maxRedemptions ? ` of ${d.maxRedemptions}` : ""} on paid orders ({formatMoney(d.confirmedCents, settings.currency)}){d.pendingUses ? ` · ${d.pendingUses} in checkout` : ""}
              </span>
            </div>
            <details>
              <summary className="cursor-pointer text-sm text-berry">Edit</summary>
              <div className="mt-4">
                <DiscountForm
                  d={{
                    id: d.id,
                    code: d.code,
                    kind: d.kind,
                    value: d.kind === "percent" ? String(d.value / 100) : centsToInput(d.value),
                    minSubtotal: d.minSubtotalCents ? centsToInput(d.minSubtotalCents) : "",
                    startsOn: d.startsAt ? dateInZone(d.startsAt, tz) : "",
                    endsOn: d.endsAt ? dateInZone(d.endsAt, tz) : "",
                    maxRedemptions: d.maxRedemptions?.toString() ?? "",
                    maxPerCustomer: d.maxPerCustomer?.toString() ?? "",
                    description: d.description ?? "",
                    active: d.active,
                  }}
                />
              </div>
            </details>
          </Panel>
        ))}
      </div>
    </>
  );
}
