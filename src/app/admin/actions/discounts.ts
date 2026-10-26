"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AdminFormState } from "@/components/admin/admin-form";
import { actorFor, requireAdmin } from "@/lib/auth/session";
import { discountInputSchema, saveDiscount } from "@/lib/discounts";
import { parseMoneyInput } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { fieldErrors } from "@/lib/validation";

const opt = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v || null;
};
const optInt = (f: FormData, k: string) => {
  const v = opt(f, k);
  return v === null ? null : Number(v);
};

export async function saveDiscountAction(_prev: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("discounts:manage");
  const id = opt(f, "id");
  if (id && !z.uuid().safeParse(id).success) return { message: "Invalid request." };
  const kind = f.get("kind") === "fixed" ? "fixed" : "percent";
  const rawValue = String(f.get("value") ?? "");
  const value = kind === "percent" ? Math.round(Number(rawValue) * 100) : parseMoneyInput(rawValue);
  const min = opt(f, "minSubtotal");
  const parsed = discountInputSchema.safeParse({
    code: String(f.get("code") ?? ""),
    description: opt(f, "description"),
    kind,
    value: Number.isFinite(value) ? value : NaN,
    minSubtotalCents: min === null ? 0 : (parseMoneyInput(min) ?? -1),
    startsOn: opt(f, "startsOn"),
    endsOn: opt(f, "endsOn"),
    maxRedemptions: optInt(f, "maxRedemptions"),
    maxPerCustomer: optInt(f, "maxPerCustomer"),
    active: f.get("active") === "on",
  });
  if (!parsed.success) return { message: "Please check the highlighted fields.", errors: fieldErrors(parsed.error) };
  const res = await saveDiscount(actorFor(admin), id, parsed.data, (await getSettings()).timezone);
  if (!res.ok) return { message: res.message, errors: { code: res.message } };
  revalidatePath("/admin/discounts");
  return { ok: true, message: id ? "Code updated." : `Code ${parsed.data.code} created.` };
}
