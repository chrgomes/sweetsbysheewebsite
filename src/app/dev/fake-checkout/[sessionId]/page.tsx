import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { handlePaymentEvent } from "@/lib/orders";
import { randomToken } from "@/lib/tokens";

/**
 * Stand-in for a hosted payment page, available only with PAYMENTS_PROVIDER=fake
 * outside production. It produces the same provider event a real webhook would.
 */
function fakeEnabled() {
  return env().PAYMENTS_PROVIDER === "fake" && !(env().NODE_ENV === "production" && env().APP_ENV === "production");
}

function safeLocal(url: string | undefined, fallback: string) {
  if (!url) return fallback;
  try {
    const u = new URL(url, env().NEXT_PUBLIC_SITE_URL);
    return u.origin === new URL(env().NEXT_PUBLIC_SITE_URL).origin ? `${u.pathname}${u.search}` : fallback;
  } catch {
    return fallback;
  }
}

export default async function FakeCheckout({ params, searchParams }: PageProps<"/dev/fake-checkout/[sessionId]">) {
  if (!fakeEnabled()) notFound();
  const { sessionId } = await params;
  const sp = await searchParams;
  const payment = await db().query.payments.findFirst({ where: eq(schema.payments.providerSessionId, sessionId), with: { order: true } });
  if (!payment) notFound();
  const order = payment.order;
  const success = safeLocal(typeof sp.success === "string" ? sp.success : undefined, "/");
  const cancel = safeLocal(typeof sp.cancel === "string" ? sp.cancel : undefined, "/cart");

  async function complete(form: FormData) {
    "use server";
    if (!fakeEnabled()) notFound();
    const outcome = String(form.get("outcome"));
    const current = await db().query.payments.findFirst({ where: eq(schema.payments.providerSessionId, sessionId) });
    if (!current) notFound();
    await handlePaymentEvent({
      id: `fake_evt_${randomToken(10)}`,
      provider: "fake",
      type: outcome === "pay" ? "paid" : outcome === "fail" ? "failed" : "expired",
      sessionId,
      paymentIntentId: outcome === "pay" ? `fake_pi_${randomToken(8)}` : null,
      amountTotalCents: current.amountCents,
      currency: current.currency,
    });
    redirect(outcome === "cancel" ? cancel : success);
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <p className="text-xs font-semibold tracking-widest text-danger uppercase">Test payment page — not a real payment</p>
      <h1 className="mt-3 text-3xl">Pay {formatMoney(payment.amountCents, payment.currency)}</h1>
      <p className="mt-2 text-sm text-ink-soft">Order {order.reference}</p>
      <form action={complete} className="mt-8 grid gap-3">
        <button name="outcome" value="pay" className="min-h-12 rounded-full bg-berry font-medium text-white">Simulate successful payment</button>
        <button name="outcome" value="fail" className="min-h-12 rounded-full border border-line-strong">Simulate failed payment</button>
        <button name="outcome" value="cancel" className="min-h-12 rounded-full border border-line-strong">Cancel and return to shop</button>
      </form>
    </main>
  );
}
