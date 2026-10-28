import { uploadSiteImage } from "@/app/admin/actions/content";
import { updateSettings } from "@/app/admin/actions/settings";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { Field, Input, Textarea } from "@/components/ui/field";
import { requireAdmin } from "@/lib/auth/session";
import { centsToInput } from "@/lib/money";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Settings" };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Check({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-[var(--berry)]" />
      <span>{label}{hint && <span className="block text-ink-muted">{hint}</span>}</span>
    </label>
  );
}

export default async function SettingsPage() {
  await requireAdmin("settings:edit");
  const s = await getSettings();
  return (
    <>
      <AdminHeader title="Settings" description="Business details and ordering rules. Anything left blank is hidden from the site." />
      <AdminForm action={updateSettings} submitLabel="Save settings" className="space-y-6">
        <Panel title="Business & homepage">
          <div className="grid gap-5 md:grid-cols-2">
            <Field id="businessName" label="Business name" required><Input id="businessName" defaultValue={s.businessName} /></Field>
            <Field id="tagline" label="Tagline"><Input id="tagline" defaultValue={s.tagline ?? ""} /></Field>
            <Field id="heroHeading" label="Homepage headline"><Input id="heroHeading" defaultValue={s.heroHeading ?? ""} /></Field>
            <Field id="heroSubheading" label="Homepage introduction"><Input id="heroSubheading" defaultValue={s.heroSubheading ?? ""} /></Field>
            <Field id="heroImage" label="Homepage photo path" hint="e.g. /images/banners/hero.jpg or an uploaded /media/… path"><Input id="heroImage" defaultValue={s.heroImage ?? ""} hasHint /></Field>
            <Field id="heroImageAlt" label="Homepage photo alt text"><Input id="heroImageAlt" defaultValue={s.heroImageAlt ?? ""} /></Field>
            <Field id="announcement" label="Announcement bar" className="md:col-span-2" hint="Short notice shown on every page, e.g. holiday ordering deadlines."><Input id="announcement" defaultValue={s.announcement ?? ""} hasHint /></Field>
          </div>
        </Panel>
        <Panel title="Our story">
          <div className="grid gap-5 md:grid-cols-2">
            <Field id="storyHeading" label="Heading"><Input id="storyHeading" defaultValue={s.storyHeading ?? ""} /></Field>
            <Field id="storyImage" label="Photo path"><Input id="storyImage" defaultValue={s.storyImage ?? ""} /></Field>
            <Field id="storyImageAlt" label="Photo alt text" className="md:col-span-2"><Input id="storyImageAlt" defaultValue={s.storyImageAlt ?? ""} /></Field>
            <Field id="storyBody" label="Story" className="md:col-span-2" hint="Separate paragraphs with a blank line."><Textarea id="storyBody" rows={6} defaultValue={s.storyBody ?? ""} hasHint /></Field>
          </div>
        </Panel>
        <Panel title="Contact">
          <div className="grid gap-5 md:grid-cols-2">
            <Field id="contactEmail" label="Public email" hint="Also receives order and request notifications unless BUSINESS_NOTIFICATION_EMAIL is set."><Input id="contactEmail" type="email" defaultValue={s.contactEmail ?? ""} hasHint /></Field>
            <Field id="contactPhone" label="Public phone"><Input id="contactPhone" defaultValue={s.contactPhone ?? ""} /></Field>
            <Field id="serviceArea" label="Service area"><Input id="serviceArea" defaultValue={s.serviceArea ?? ""} /></Field>
            <Field id="hours" label="Hours (free text)" hint="Used only when structured opening hours below are empty."><Textarea id="hours" rows={2} defaultValue={s.hours ?? ""} hasHint /></Field>
            <Field id="businessHours" label="Opening hours" hint="One period per line, e.g. Sat 09:00-14:00. Leave blank to hide."><Textarea id="businessHours" rows={3} defaultValue={s.businessHours.map((h) => `${DAYS[h.day - 1]} ${h.open}-${h.close}`).join("\n")} hasHint /></Field>
            <Field id="addressLines" label="Address (one line each)"><Textarea id="addressLines" rows={3} defaultValue={s.addressLines.join("\n")} /></Field>
            <div className="pt-7"><Check name="showAddress" label="Show address publicly" defaultChecked={s.showAddress} hint="Leave off for a home bakery; share pickup details by email instead." /></div>
            <Field id="socialLinks" label="Social links" className="md:col-span-2" hint="One per line: Label | https://…"><Textarea id="socialLinks" rows={3} defaultValue={s.socialLinks.map((l) => `${l.label} | ${l.url}`).join("\n")} hasHint /></Field>
          </div>
        </Panel>
        <Panel title="Online checkout">
          <div className="grid gap-5 md:grid-cols-3">
            <div className="md:col-span-3"><Check name="checkoutEnabled" label="Accept online orders and payments" defaultChecked={s.checkoutEnabled} hint="Only turn on after confirming tax, fulfilment days and fees below, and testing a payment." /></div>
            <Field id="taxRate" label="Sales tax rate (%)" hint="Confirm with your accountant. Use 0 if none applies. Blank = checkout disabled."><Input id="taxRate" inputMode="decimal" defaultValue={s.taxRateBps === null ? "" : (s.taxRateBps / 100).toString()} hasHint /></Field>
            <Field id="taxLabel" label="Tax label"><Input id="taxLabel" defaultValue={s.taxLabel} /></Field>
            <Field id="timezone" label="Timezone" required><Input id="timezone" defaultValue={s.timezone} /></Field>
            <Field id="minLeadTimeHours" label="Minimum notice (hours)" required><Input id="minLeadTimeHours" inputMode="numeric" defaultValue={s.minLeadTimeHours} /></Field>
            <Field id="maxAdvanceDays" label="Book up to (days ahead)" required><Input id="maxAdvanceDays" inputMode="numeric" defaultValue={s.maxAdvanceDays} /></Field>
            <fieldset className="md:col-span-3">
              <legend className="text-sm font-medium">Pickup / delivery days</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {DAYS.map((d, i) => (
                  <label key={d} className="flex items-center gap-2 text-sm"><input type="checkbox" name="fulfillmentWeekdays" value={i + 1} defaultChecked={s.fulfillmentWeekdays.includes(i + 1)} className="size-4" /> {d}</label>
                ))}
              </div>
            </fieldset>
            <Field id="orderCutoffTime" label="Daily order cut-off" hint="HH:MM. Orders after this count as placed the next day. Blank = none."><Input id="orderCutoffTime" type="time" defaultValue={s.orderCutoffTime ?? ""} hasHint /></Field>
            <Field id="dailyCapacityUnits" label="Daily capacity (units)" hint="Production slots per day. Each product uses its own number of units. Blank = no limit."><Input id="dailyCapacityUnits" inputMode="numeric" defaultValue={s.dailyCapacityUnits ?? ""} hasHint /></Field>
            <Field id="fulfillmentWindows" label="Pickup / delivery time windows" hint="One per line, e.g. 10:00–12:00. Blank = no window choice."><Textarea id="fulfillmentWindows" rows={3} defaultValue={s.fulfillmentWindows.join("\n")} hasHint /></Field>
            <Field id="blackoutDates" label="Unavailable dates" hint="One per line, YYYY-MM-DD"><Textarea id="blackoutDates" rows={3} defaultValue={s.blackoutDates.join("\n")} hasHint /></Field>
            <div className="space-y-4 md:col-span-2">
              <Check name="pickupEnabled" label="Offer pickup" defaultChecked={s.pickupEnabled} />
              <Field id="pickupInstructions" label="Pickup instructions"><Textarea id="pickupInstructions" rows={2} defaultValue={s.pickupInstructions ?? ""} /></Field>
            </div>
            <div className="space-y-4 md:col-span-3 md:grid md:grid-cols-3 md:gap-5 md:space-y-0">
              <div className="pt-7"><Check name="deliveryEnabled" label="Offer delivery" defaultChecked={s.deliveryEnabled} /></div>
              <Field id="deliveryFee" label="Delivery fee ($)"><Input id="deliveryFee" inputMode="decimal" defaultValue={centsToInput(s.deliveryFeeCents)} /></Field>
              <Field id="deliveryArea" label="Delivery area"><Input id="deliveryArea" defaultValue={s.deliveryArea ?? ""} /></Field>
            </div>
          </div>
        </Panel>
        <Panel title="Custom orders">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2"><Check name="customOrdersEnabled" label="Accept custom order requests" defaultChecked={s.customOrdersEnabled} /></div>
            <Field id="customOrderMinNoticeDays" label="Minimum notice (days)" required><Input id="customOrderMinNoticeDays" inputMode="numeric" defaultValue={s.customOrderMinNoticeDays} /></Field>
            <Field id="customOrderNotice" label="Extra note on the form"><Input id="customOrderNotice" defaultValue={s.customOrderNotice ?? ""} /></Field>
            <div className="md:col-span-2"><Check name="askBudget" label="Ask for a budget on the request form" defaultChecked={s.askBudget} /></div>
            <Field id="depositPercent" label="Default deposit (%)" hint="Suggested on new quotes. Blank = full payment up front."><Input id="depositPercent" inputMode="decimal" defaultValue={s.depositPercentBps === null ? "" : (s.depositPercentBps / 100).toString()} hasHint /></Field>
            <Field id="balanceDueDaysBefore" label="Balance due (days before the date)" required hint="The reminder email is sent then."><Input id="balanceDueDaysBefore" inputMode="numeric" defaultValue={s.balanceDueDaysBefore} hasHint /></Field>
            <Field id="quoteValidityDays" label="Quotes valid for (days)" required><Input id="quoteValidityDays" inputMode="numeric" defaultValue={s.quoteValidityDays} /></Field>
            <Field id="customOrderTypes" label="“What would you like?” choices" className="md:col-span-2" hint="One per line. Leave blank to list products marked for custom orders."><Textarea id="customOrderTypes" rows={4} defaultValue={s.customOrderTypes.join("\n")} hasHint /></Field>
          </div>
        </Panel>
        <Panel title="Shop display & notifications">
          <div className="grid gap-5 md:grid-cols-2">
            <Field id="newArrivalDays" label="“New” badge for (days after publishing)" required hint="0 turns the badge and New arrivals off."><Input id="newArrivalDays" inputMode="numeric" defaultValue={s.newArrivalDays} hasHint /></Field>
            <Field id="bestsellerMinOrders" label="Bestseller threshold (paid orders, last 90 days)" required hint="Bestsellers only appear once real sales reach this."><Input id="bestsellerMinOrders" inputMode="numeric" defaultValue={s.bestsellerMinOrders} hasHint /></Field>
            <div className="md:col-span-2"><Check name="notifyStatusChanges" label="Email customers when an order is in production, ready or completed" defaultChecked={s.notifyStatusChanges} hint="Confirmation, cancellation and refund emails are always sent." /></div>
          </div>
        </Panel>
      </AdminForm>
      <Panel title="Upload a site photo" className="mt-6">
        <AdminForm action={uploadSiteImage} submitLabel="Upload" encType="multipart/form-data">
          <p className="text-sm text-ink-soft">Upload a photo, then paste the path it gives you into a photo field above.</p>
          <input type="file" name="image" accept="image/jpeg,image/png,image/webp" aria-label="Photo file" className="block text-sm" />
        </AdminForm>
      </Panel>
    </>
  );
}
