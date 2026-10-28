import type { Metadata } from "next";
import { lookupAction } from "@/app/actions/customer";
import { SimpleActionForm } from "@/components/site/simple-action-form";
import { Container, SectionHeading } from "@/components/ui/container";

export const metadata: Metadata = { title: "Find my orders", description: "Get links to your orders, custom requests and quotes by email.", alternates: { canonical: "/orders/find" } };

export default function FindOrdersPage() {
  return (
    <Container size="narrow" className="py-12 lg:py-20">
      <SectionHeading as="h1" eyebrow="Your orders" title="Find my orders" intro="Enter the email you ordered with and we'll send you links to your recent orders, custom requests and quotes. No account needed." />
      <div className="mt-10 max-w-md">
        <SimpleActionForm action={lookupAction} hidden={{}} submitLabel="Email me my links" pendingLabel="Sending…">
          <label htmlFor="email" className="block text-sm font-medium text-ink">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="block w-full rounded-xl border border-line-strong bg-white px-4 py-3 focus:border-ink focus:outline-none" />
        </SimpleActionForm>
      </div>
    </Container>
  );
}
