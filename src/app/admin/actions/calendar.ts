"use server";

import { revalidatePath } from "next/cache";
import type { AdminFormState } from "@/components/admin/admin-form";
import { actorFor, requireAdmin } from "@/lib/auth/session";
import { setCapacityOverride } from "@/lib/capacity";
import { isIsoDate } from "@/lib/dates";

export async function setOverrideAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("capacity:override");
  const date = String(form.get("date") ?? "");
  if (!isIsoDate(date)) return { message: "Invalid date." };
  const clear = form.get("clear") === "on";
  const raw = String(form.get("capacityUnits") ?? "").trim();
  const units = clear ? null : Number(raw);
  if (!clear && (raw === "" || !Number.isInteger(units) || units! < 0 || units! > 10_000)) return { message: "Enter a whole number of units (0 closes the day).", errors: { capacityUnits: "Invalid" } };
  const res = await setCapacityOverride(actorFor(admin), date, units, String(form.get("reason") ?? "").trim().slice(0, 300));
  if (!res.ok) return { message: res.message, errors: { reason: res.message } };
  revalidatePath("/admin/calendar");
  return { ok: true, message: clear ? "Back to the normal daily capacity." : "Capacity updated for this day." };
}
