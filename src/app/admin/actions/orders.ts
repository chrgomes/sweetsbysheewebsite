"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AdminFormState } from "@/components/admin/admin-form";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { actorFor, requireAdmin } from "@/lib/auth/session";
import { parseMoneyInput } from "@/lib/money";
import { can } from "@/lib/permissions";
import { offlinePaymentSchema, ORDER_STATUSES, recordOfflinePayment, refundPayment, transitionPermission, updateOrderStatus } from "@/lib/orders";
import { fieldErrors } from "@/lib/validation";

const uuid = z.uuid();

function done(orderId: string, message: string): AdminFormState {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true, message };
}

export async function changeOrderStatus(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("orders:progress");
  const id = uuid.safeParse(form.get("orderId"));
  const status = z.enum(ORDER_STATUSES).safeParse(form.get("status"));
  if (!id.success || !status.success) return { message: "Invalid request." };
  const order = await db().query.orders.findFirst({ where: eq(schema.orders.id, id.data), columns: { status: true } });
  if (!order) return { message: "Order not found." };
  // Production staff may only move orders forward; everything else needs orders:manage.
  if (!can(admin.role, transitionPermission(order.status, status.data))) return { message: "Your role can't make that change." };
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500) || null;
  const res = await updateOrderStatus(actorFor(admin), id.data, status.data, { reason, notify: form.get("notify") === "on" });
  if (!res.ok) return { message: res.message };
  return done(id.data, res.notified ? "Status updated and the customer was emailed." : "Status updated.");
}

export async function saveOrderNotes(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("orders:manage");
  const id = uuid.safeParse(form.get("orderId"));
  if (!id.success) return { message: "Invalid request." };
  const notes = String(form.get("internalNotes") ?? "").slice(0, 5000) || null;
  await db().update(schema.orders).set({ internalNotes: notes }).where(eq(schema.orders.id, id.data));
  await audit(actorFor(admin), "order.notes_updated", "order", id.data);
  return done(id.data, "Notes saved.");
}

export async function recordPaymentAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("orders:payments");
  const id = uuid.safeParse(form.get("orderId"));
  if (!id.success) return { message: "Invalid request." };
  const parsed = offlinePaymentSchema.safeParse({
    amountCents: parseMoneyInput(String(form.get("amount") ?? "")) ?? undefined,
    method: form.get("method"),
    note: form.get("note"),
  });
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (errors.amountCents) errors.amount = errors.amountCents;
    return { message: "Please check the payment details.", errors };
  }
  const res = await recordOfflinePayment(actorFor(admin), id.data, parsed.data);
  if (!res.ok) return { message: res.message };
  return done(id.data, "Payment recorded.");
}

export async function refundAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("orders:refund");
  const orderId = uuid.safeParse(form.get("orderId"));
  const paymentId = uuid.safeParse(form.get("paymentId"));
  if (!orderId.success || !paymentId.success) return { message: "Invalid request." };
  const amount = parseMoneyInput(String(form.get("amount") ?? ""));
  if (amount === null || amount <= 0) return { message: "Enter the amount to refund.", errors: { amount: "Enter an amount." } };
  if (form.get("confirm") !== "on") return { message: "Tick the box to confirm the refund.", errors: { confirm: "Please confirm." } };
  const res = await refundPayment(actorFor(admin), paymentId.data, amount, String(form.get("reason") ?? "").slice(0, 500));
  if (!res.ok) return { message: res.message };
  return done(orderId.data, res.pending ? "Refund requested — it will show as completed once the provider confirms it." : "Refund issued.");
}
