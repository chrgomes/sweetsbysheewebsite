import type { Metadata } from "next";
import Link from "next/link";
import { CheckoutForm } from "@/components/shop/checkout-form";
import { Container, SectionHeading } from "@/components/ui/container";
import { FormAlert } from "@/components/ui/field";
import { addDays, dateInZone } from "@/lib/dates";
import { env } from "@/lib/env";
import { paymentProvider } from "@/lib/payments";
import { checkoutReadiness, getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  const sp = await searchParams;
  const settings = await getSettings();
  const provider = paymentProvider();
  const ready = checkoutReadiness(settings, provider !== null);
  return (
    <Container className="py-12 lg:py-16">
      <SectionHeading as="h1" title="Checkout" />
      <div className="mt-10">
        {ready.ready ? (
          <CheckoutForm
            cancelledRef={typeof sp.cancelled === "string" ? sp.cancelled : undefined}
            config={{
              taxRateBps: settings.taxRateBps!,
              taxLabel: settings.taxLabel,
              deliveryFeeCents: settings.deliveryFeeCents,
              deliveryArea: settings.deliveryArea,
              pickupInstructions: settings.pickupInstructions,
              maxDate: addDays(dateInZone(new Date(), settings.timezone), settings.maxAdvanceDays),
              automaticTax: provider?.name === "stripe" && env().STRIPE_AUTOMATIC_TAX,
            }}
          />
        ) : (
          <div className="max-w-xl">
            <FormAlert tone="info">
              Online checkout isn&apos;t available right now. Please <Link href="/contact" className="font-medium underline">contact us</Link> to place your order
              {settings.customOrdersEnabled && (
                <>
                  , or <Link href="/custom-orders" className="font-medium underline">send a custom order request</Link>
                </>
              )}
              .
            </FormAlert>
          </div>
        )}
      </div>
    </Container>
  );
}
