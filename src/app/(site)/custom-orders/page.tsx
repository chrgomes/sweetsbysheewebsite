import type { Metadata } from "next";
import { InquiryForm } from "@/components/site/inquiry-form";
import { Container, SectionHeading } from "@/components/ui/container";
import { FormAlert } from "@/components/ui/field";
import { listCustomOrderProducts } from "@/lib/catalog";
import { addDays, dateInZone } from "@/lib/dates";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { issueFormToken } from "@/lib/spam";

export const metadata: Metadata = {
  title: "Custom orders",
  description: "Request a personalised cake or dessert for your celebration. Tell us your date, servings and design ideas and we'll reply with a quote.",
  alternates: { canonical: "/custom-orders" },
};

export default async function CustomOrdersPage({ searchParams }: PageProps<"/custom-orders">) {
  const sp = await searchParams;
  const [settings, products] = await Promise.all([getSettings(), listCustomOrderProducts()]);
  const today = dateInZone(new Date(), settings.timezone);

  const productTypes = settings.customOrderTypes.length
    ? settings.customOrderTypes.map((t) => ({ value: t, label: t }))
    : products.map((p) => ({ value: p.name, label: p.name, productId: p.id }));
  productTypes.push({ value: "Something else", label: "Something else / not sure" });
  const preselectSlug = typeof sp.product === "string" ? sp.product : undefined;
  const preselect = products.find((p) => p.slug === preselectSlug)?.name;

  return (
    <Container className="py-12 lg:py-16">
      <div className="grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-28">
            <SectionHeading as="h1" eyebrow="Custom orders" title="Let's make something special" intro="Share the details of your celebration and we'll get back to you with availability and a personal quote." />
            <ol className="mt-10 space-y-6 text-sm">
              {[
                ["Send your request", "The more detail and inspiration, the better."],
                ["We reply with a quote", "We'll confirm availability, pricing and any questions."],
                ["Confirm your order", "Your date is booked only once we've both agreed the details."],
              ].map(([t, b], i) => (
                <li key={t} className="flex gap-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blush font-display text-berry">{i + 1}</span>
                  <span>
                    <span className="block font-medium text-ink">{t}</span>
                    <span className="text-ink-soft">{b}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="lg:col-span-7 lg:col-start-6">
          {settings.customOrdersEnabled ? (
            <InquiryForm
              config={{
                productTypes,
                minDate: addDays(today, settings.customOrderMinNoticeDays),
                maxDate: addDays(today, 730),
                minNoticeDays: settings.customOrderMinNoticeDays,
                deliveryEnabled: settings.deliveryEnabled,
                deliveryArea: settings.deliveryArea,
                askBudget: settings.askBudget,
                maxFiles: env().MAX_UPLOAD_FILES,
                maxMb: env().MAX_UPLOAD_MB,
                notice: settings.customOrderNotice,
                formToken: issueFormToken(),
                preselect,
              }}
            />
          ) : (
            <FormAlert tone="info">We aren&apos;t taking custom order requests right now. Please check back soon.</FormAlert>
          )}
        </div>
      </div>
    </Container>
  );
}
