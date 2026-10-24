import type { Metadata } from "next";
import { CartView } from "@/components/shop/cart-view";
import { Container, SectionHeading } from "@/components/ui/container";
import { paymentProvider } from "@/lib/payments";
import { checkoutReadiness, getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Cart", robots: { index: false } };

export default async function CartPage() {
  const settings = await getSettings();
  const checkoutOpen = checkoutReadiness(settings, paymentProvider() !== null).ready;
  return (
    <Container className="py-12 lg:py-16">
      <SectionHeading as="h1" title="Your cart" />
      <div className="mt-10">
        <CartView checkoutOpen={checkoutOpen} />
      </div>
    </Container>
  );
}
