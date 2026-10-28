"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AdminFormState } from "@/components/admin/admin-form";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { actorFor, requireAdmin } from "@/lib/auth/session";
import { eraseCustomer } from "@/lib/customers";

export async function saveCustomerNotes(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("orders:manage");
  const id = z.uuid().safeParse(form.get("customerId"));
  if (!id.success) return { message: "Invalid request." };
  const notes = String(form.get("internalNotes") ?? "").trim().slice(0, 5000) || null;
  await db().update(schema.customers).set({ internalNotes: notes }).where(eq(schema.customers.id, id.data));
  await audit(actorFor(admin), "customer.notes_updated", "customer", id.data);
  revalidatePath(`/admin/customers/${id.data}`);
  return { ok: true, message: "Notes saved." };
}

export async function eraseCustomerAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("customers:erase");
  const id = z.uuid().safeParse(form.get("customerId"));
  if (!id.success) return { message: "Invalid request." };
  const customer = await db().query.customers.findFirst({ where: eq(schema.customers.id, id.data), columns: { email: true } });
  if (!customer) return { message: "Customer not found." };
  if (String(form.get("confirmEmail") ?? "").trim().toLowerCase() !== customer.email) return { message: "Type the customer's email address exactly to confirm." };
  const res = await eraseCustomer(actorFor(admin), id.data);
  revalidatePath(`/admin/customers/${id.data}`);
  revalidatePath("/admin/customers");
  return res.ok ? { ok: true, message: "Personal data erased. Order amounts are kept for your records." } : { message: res.message };
}
