"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AdminFormState } from "@/components/admin/admin-form";
import { actorFor, requireAdmin } from "@/lib/auth/session";
import { INQUIRY_STATUSES, updateInquiry } from "@/lib/inquiries";
import { parseMoneyInput } from "@/lib/money";
import { quoteDraftSchema, saveDraftQuote, sendQuote, withdrawQuote } from "@/lib/quotes";
import { fieldErrors } from "@/lib/validation";

const text = (v: FormDataEntryValue | null, max = 5000) => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
};

function refresh(inquiryId: string) {
  revalidatePath(`/admin/inquiries/${inquiryId}`);
  revalidatePath("/admin/inquiries");
}

export async function saveInquiry(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("inquiries:manage");
  const id = z.uuid().safeParse(form.get("inquiryId"));
  const status = z.enum(INQUIRY_STATUSES).safeParse(form.get("status"));
  if (!id.success || !status.success) return { message: "Invalid request." };
  const res = await updateInquiry(actorFor(admin), id.data, { status: status.data, internalNotes: text(form.get("internalNotes")) });
  refresh(id.data);
  return res.ok ? { ok: true, message: "Saved." } : { message: res.message };
}

/** Money fields: blank → fallback, invalid → error. */
function money(raw: FormDataEntryValue | null, fallback: number | null): number | null | "invalid" {
  const s = String(raw ?? "").trim();
  if (!s) return fallback;
  return parseMoneyInput(s) ?? "invalid";
}

export async function saveQuoteAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("quotes:manage");
  const id = z.uuid().safeParse(form.get("inquiryId"));
  if (!id.success) return { message: "Invalid request." };
  const descriptions = form.getAll("lineDescription").map(String);
  const quantities = form.getAll("lineQuantity").map(String);
  const prices = form.getAll("linePrice").map(String);
  const errors: Record<string, string> = {};
  const lines = descriptions
    .map((description, i) => ({ description: description.trim(), quantity: Number(quantities[i] || 1), price: money(prices[i] ?? "", null), i }))
    .filter((l) => l.description || l.price !== null);
  for (const l of lines) if (l.price === "invalid" || l.price === null) errors[`line${l.i}`] = "Enter a price like 120.00.";
  const deliveryFee = money(form.get("deliveryFee"), 0);
  const deposit = money(form.get("deposit"), null);
  if (deliveryFee === "invalid") errors.deliveryFee = "Enter an amount like 15.00.";
  if (deposit === "invalid") errors.deposit = "Enter an amount like 50.00, or leave blank for the default.";
  if (Object.keys(errors).length) return { message: "Please check the highlighted amounts.", errors };

  const parsed = quoteDraftSchema.safeParse({
    fulfillmentMethod: form.get("fulfillmentMethod"),
    fulfillmentDate: form.get("fulfillmentDate"),
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPriceCents: l.price as number })),
    deliveryFeeCents: deliveryFee,
    depositCents: deposit,
    capacityUnits: Number(form.get("capacityUnits") || 0),
    customerMessage: text(form.get("customerMessage"), 2000),
  });
  if (!parsed.success) {
    const fe = fieldErrors(parsed.error);
    return { message: Object.values(fe)[0] ?? "Please check the quote.", errors: fe };
  }
  const res = await saveDraftQuote(actorFor(admin), id.data, parsed.data);
  refresh(id.data);
  return res.ok ? { ok: true, message: "Draft saved. Review it, then send it to the customer." } : { message: res.message };
}

export async function sendQuoteAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("quotes:manage");
  const inquiryId = z.uuid().safeParse(form.get("inquiryId"));
  const quoteId = z.uuid().safeParse(form.get("quoteId"));
  if (!inquiryId.success || !quoteId.success) return { message: "Invalid request." };
  const res = await sendQuote(actorFor(admin), quoteId.data, { force: form.get("force") === "on" });
  refresh(inquiryId.data);
  return res.ok ? { ok: true, message: "Quote sent to the customer." } : { message: res.message };
}

export async function withdrawQuoteAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("quotes:manage");
  const inquiryId = z.uuid().safeParse(form.get("inquiryId"));
  const quoteId = z.uuid().safeParse(form.get("quoteId"));
  if (!inquiryId.success || !quoteId.success) return { message: "Invalid request." };
  const res = await withdrawQuote(actorFor(admin), quoteId.data);
  refresh(inquiryId.data);
  return res.ok ? { ok: true, message: "Quote withdrawn. The customer's link no longer accepts it." } : { message: res.message };
}
