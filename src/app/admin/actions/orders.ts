"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AdminFormState } from "@/components/admin/admin-form";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { actorFor, requireAdmin } from "@/lib/auth/session";
import { updateOrderStatus } from "@/lib/orders";

export async function changeOrderStatus(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const id = z.uuid().safeParse(form.get("orderId"));
  const status = z.string().max(40).safeParse(form.get("status"));
  if (!id.success || !status.success) return { message: "Invalid request." };
  const res = await updateOrderStatus(actorFor(admin), id.data, status.data);
  revalidatePath(`/admin/orders/${id.data}`);
  return res.ok ? { ok: true, message: "Status updated." } : { message: res.message };
}

export async function saveOrderNotes(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const id = z.uuid().safeParse(form.get("orderId"));
  if (!id.success) return { message: "Invalid request." };
  const notes = String(form.get("internalNotes") ?? "").slice(0, 5000) || null;
  await db().update(schema.orders).set({ internalNotes: notes }).where(eq(schema.orders.id, id.data));
  await audit(actorFor(admin), "order.notes_updated", "order", id.data);
  revalidatePath(`/admin/orders/${id.data}`);
  return { ok: true, message: "Notes saved." };
}
