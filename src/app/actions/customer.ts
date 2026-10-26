"use server";

import { redirect } from "next/navigation";
import { sendLookupEmail } from "@/lib/lookup";
import { getOrderForCustomer, startOrderPayment } from "@/lib/orders";
import { acceptQuote, declineQuote } from "@/lib/quotes";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { emailSchema } from "@/lib/validation";

export type SimpleState = { message?: string; ok?: boolean };

/** Customer pays a deposit or balance from their order link. */
export async function payOrderAction(_prev: SimpleState, form: FormData): Promise<SimpleState> {
  const order = await getOrderForCustomer(String(form.get("reference") ?? ""), String(form.get("t") ?? ""));
  if (!order) return { message: "This order link isn't valid." };
  const res = await startOrderPayment(order.id);
  if (!res.ok) return { message: res.message };
  redirect(res.url);
}

export async function acceptQuoteAction(_prev: SimpleState, form: FormData): Promise<SimpleState> {
  const limit = await rateLimit("quote-response", await clientIp(), 20, 600);
  if (!limit.allowed) return { message: "Too many attempts. Please wait a few minutes." };
  if (form.get("agree") !== "on") return { message: "Please confirm you've reviewed the quote." };
  const res = await acceptQuote(String(form.get("reference") ?? ""), String(form.get("t") ?? ""));
  if (!res.ok) return { message: res.message };
  redirect(res.redirectUrl);
}

export async function declineQuoteAction(_prev: SimpleState, form: FormData): Promise<SimpleState> {
  const limit = await rateLimit("quote-response", await clientIp(), 20, 600);
  if (!limit.allowed) return { message: "Too many attempts. Please wait a few minutes." };
  const reason = String(form.get("reason") ?? "").trim().slice(0, 1000) || null;
  const res = await declineQuote(String(form.get("reference") ?? ""), String(form.get("t") ?? ""), reason);
  return res.ok ? { ok: true, message: "Thanks for letting us know. We've passed your response to the team." } : { message: res.message };
}

/** "Find my orders". Always gives the same answer so it can't reveal who is a customer. */
export async function lookupAction(_prev: SimpleState, form: FormData): Promise<SimpleState> {
  const email = emailSchema.safeParse(form.get("email"));
  if (!email.success) return { message: "Please enter a valid email address." };
  const ip = await clientIp();
  const [byIp, byEmail] = await Promise.all([rateLimit("lookup-ip", ip, 5, 3600), rateLimit("lookup-email", email.data, 3, 3600)]);
  if (byIp.allowed && byEmail.allowed) await sendLookupEmail(email.data);
  return { ok: true, message: "If we have orders or requests for that address, we've emailed links to them. Check your inbox (and spam folder) in a few minutes." };
}

