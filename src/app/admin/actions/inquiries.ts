"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AdminFormState } from "@/components/admin/admin-form";
import { actorFor, requireAdmin } from "@/lib/auth/session";
import { convertInquiryToOrder, INQUIRY_STATUSES, updateInquiry } from "@/lib/inquiries";
import { parseMoneyInput } from "@/lib/money";

const text = (v: FormDataEntryValue | null, max = 5000) => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
};

export async function saveInquiry(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const id = z.uuid().safeParse(form.get("inquiryId"));
  const status = z.enum(INQUIRY_STATUSES).safeParse(form.get("status"));
  if (!id.success || !status.success) return { message: "Invalid request." };
  const priceRaw = String(form.get("quotedPrice") ?? "").trim();
  const price = priceRaw ? parseMoneyInput(priceRaw) : null;
  if (priceRaw && price === null) return { message: "Enter the quoted price as a number, e.g. 185.00.", errors: { quotedPrice: "Invalid amount" } };
  const res = await updateInquiry(actorFor(admin), id.data, {
    status: status.data,
    quotedPriceCents: price,
    quoteNotes: text(form.get("quoteNotes")),
    internalNotes: text(form.get("internalNotes")),
  });
  revalidatePath(`/admin/inquiries/${id.data}`);
  return res.ok ? { ok: true, message: "Saved." } : { message: res.message };
}

export async function convertInquiry(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const id = z.uuid().safeParse(form.get("inquiryId"));
  if (!id.success) return { message: "Invalid request." };
  const res = await convertInquiryToOrder(actorFor(admin), id.data, { sendEmail: form.get("sendEmail") === "on" });
  revalidatePath(`/admin/inquiries/${id.data}`);
  if (!res.ok) return { message: res.message };
  const parts = ["Order created."];
  parts.push(res.paymentUrl ? "A payment link was generated." : "No payment provider is configured, so arrange payment directly with the customer.");
  if (form.get("sendEmail") === "on") parts.push(res.emailed ? "The quote email was sent." : "The quote email could not be sent — please contact the customer directly.");
  return { ok: true, message: parts.join(" ") };
}
