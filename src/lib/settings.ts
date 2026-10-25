import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { BRAND_NAME } from "@/lib/brand";

/**
 * Business settings, editable by the owner in /admin/settings.
 *
 * Every fact about the business defaults to "unset" (null / empty / false).
 * The site hides anything unset rather than showing invented values, and
 * checkout stays disabled until the owner confirms tax and fulfilment rules.
 */
export const siteSettingsSchema = z.object({
  businessName: z.string().min(1).default(BRAND_NAME),
  tagline: z.string().nullable().default(null),
  heroHeading: z.string().nullable().default(null),
  heroSubheading: z.string().nullable().default(null),
  heroImage: z.string().nullable().default(null),
  heroImageAlt: z.string().nullable().default(null),
  storyHeading: z.string().nullable().default(null),
  storyBody: z.string().nullable().default(null),
  storyImage: z.string().nullable().default(null),
  storyImageAlt: z.string().nullable().default(null),
  announcement: z.string().nullable().default(null),
  contactEmail: z.string().nullable().default(null),
  contactPhone: z.string().nullable().default(null),
  /** Shown publicly only if the owner wants it shown (home bakeries often don't). */
  addressLines: z.array(z.string()).default([]),
  showAddress: z.boolean().default(false),
  serviceArea: z.string().nullable().default(null),
  hours: z.string().nullable().default(null),
  socialLinks: z
    .array(z.object({ label: z.string().min(1), url: z.url() }))
    .default([]),
  logoImage: z.string().nullable().default(null),

  /* Commerce rules -------------------------------------------------- */
  currency: z.string().length(3).default("usd"),
  /** Sales tax in basis points (e.g. 825 = 8.25%). Null = not configured; checkout disabled. */
  taxRateBps: z.number().int().min(0).max(5000).nullable().default(null),
  taxLabel: z.string().default("Sales tax"),
  pickupEnabled: z.boolean().default(false),
  pickupInstructions: z.string().nullable().default(null),
  deliveryEnabled: z.boolean().default(false),
  /** Flat delivery fee in cents. Null with delivery enabled = misconfigured. */
  deliveryFeeCents: z.number().int().min(0).nullable().default(null),
  deliveryArea: z.string().nullable().default(null),
  /** Minimum notice for any order, in hours. */
  minLeadTimeHours: z.number().int().min(0).default(48),
  /** How far ahead customers may book, in days. */
  maxAdvanceDays: z.number().int().min(1).default(90),
  /** ISO weekdays (1 = Monday … 7 = Sunday) on which orders can be collected or delivered. */
  fulfillmentWeekdays: z.array(z.number().int().min(1).max(7)).default([]),
  /** Specific dates (YYYY-MM-DD) that are unavailable, e.g. holidays. */
  blackoutDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
  timezone: z.string().default("America/New_York"),
  /** Master switch: the owner must turn checkout on once rules are confirmed. */
  checkoutEnabled: z.boolean().default(false),
  customOrdersEnabled: z.boolean().default(true),
  customOrderMinNoticeDays: z.number().int().min(0).default(7),
  customOrderNotice: z.string().nullable().default(null),
  /** Choices for "What would you like?" on the custom-order form. Empty = use custom-order products. */
  customOrderTypes: z.array(z.string().min(1)).default([]),
});

export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export const DEFAULT_SETTINGS: SiteSettings = siteSettingsSchema.parse({});

const KEY = "site";

export async function getSettings(): Promise<SiteSettings> {
  const row = await db().query.settings.findFirst({ where: eq(schema.settings.key, KEY) });
  if (!row) return DEFAULT_SETTINGS;
  const parsed = siteSettingsSchema.safeParse(row.value);
  if (!parsed.success) {
    console.error("[settings] stored settings are invalid; using defaults", parsed.error.issues);
    return DEFAULT_SETTINGS;
  }
  return parsed.data;
}

export async function saveSettings(next: SiteSettings): Promise<SiteSettings> {
  const value = siteSettingsSchema.parse(next);
  await db()
    .insert(schema.settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
  return value;
}

export type CheckoutReadiness = { ready: true } | { ready: false; reasons: string[] };

/** Why checkout cannot accept orders right now, for both customers and the admin dashboard. */
export function checkoutReadiness(s: SiteSettings, paymentsConfigured: boolean): CheckoutReadiness {
  const reasons: string[] = [];
  if (!paymentsConfigured) reasons.push("No payment provider is configured.");
  if (!s.checkoutEnabled) reasons.push("Online checkout has not been switched on in settings.");
  if (s.taxRateBps === null) reasons.push("Sales tax has not been configured.");
  if (!s.pickupEnabled && !s.deliveryEnabled) reasons.push("Neither pickup nor delivery is enabled.");
  if (s.deliveryEnabled && s.deliveryFeeCents === null) reasons.push("Delivery is enabled but has no delivery fee set.");
  if (s.fulfillmentWeekdays.length === 0) reasons.push("No fulfilment days are configured.");
  return reasons.length ? { ready: false, reasons } : { ready: true };
}
