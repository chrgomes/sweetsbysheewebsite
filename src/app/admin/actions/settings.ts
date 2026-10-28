"use server";

import { and, count, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AdminFormState } from "@/components/admin/admin-form";
import { db, schema } from "@/db";
import { deleteAdminUser } from "@/lib/admin-users";
import { audit } from "@/lib/audit";
import { hashPassword, passwordProblems } from "@/lib/auth/password";
import { actorFor, requireAdmin } from "@/lib/auth/session";
import { parseMoneyInput } from "@/lib/money";
import { ROLES } from "@/lib/permissions";
import { getSettings, saveSettings, siteSettingsSchema } from "@/lib/settings";
import { emailSchema } from "@/lib/validation";

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v || null;
};
const lines = (f: FormData, k: string) => String(f.get(k) ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

export async function updateSettings(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("settings:edit");
  const before = await getSettings();

  const taxRaw = str(f, "taxRate");
  const taxRateBps = taxRaw === null ? null : Math.round(Number(taxRaw) * 100);
  if (taxRaw !== null && (!Number.isFinite(Number(taxRaw)) || taxRateBps! < 0 || taxRateBps! > 5000)) return { message: "Enter the tax rate as a percentage, e.g. 8.25 (or 0 if no tax applies).", errors: { taxRate: "Invalid" } };
  const feeRaw = str(f, "deliveryFee");
  const deliveryFeeCents = feeRaw === null ? null : parseMoneyInput(feeRaw);
  if (feeRaw !== null && deliveryFeeCents === null) return { message: "Enter the delivery fee as an amount, e.g. 15.00.", errors: { deliveryFee: "Invalid" } };

  const social: { label: string; url: string }[] = [];
  for (const line of lines(f, "socialLinks")) {
    const [label, url] = line.split("|").map((x) => x.trim());
    if (!label || !url || !/^https:\/\//.test(url)) return { message: `Social link "${line}" should look like: Instagram | https://instagram.com/yourname` };
    social.push({ label, url });
  }

  const depositRaw = str(f, "depositPercent");
  const depositPercentBps = depositRaw === null ? null : Math.round(Number(depositRaw) * 100);
  if (depositRaw !== null && (!Number.isFinite(Number(depositRaw)) || depositPercentBps! < 0 || depositPercentBps! > 10000)) return { message: "Enter the deposit as a percentage between 0 and 100, or leave it blank.", errors: { depositPercent: "Invalid" } };
  const capRaw = str(f, "dailyCapacityUnits");
  const dailyCapacityUnits = capRaw === null ? null : Number(capRaw);
  if (dailyCapacityUnits !== null && (!Number.isInteger(dailyCapacityUnits) || dailyCapacityUnits < 0)) return { message: "Daily capacity must be a whole number, or blank for no limit.", errors: { dailyCapacityUnits: "Invalid" } };

  const DAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const businessHours: { day: number; open: string; close: string }[] = [];
  for (const line of lines(f, "businessHours")) {
    const m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/i.exec(line);
    const day = m ? DAY.indexOf(m[1].toLowerCase()) + 1 : 0;
    const open = m ? `${m[2].padStart(2, "0")}:${m[3]}` : "";
    const close = m ? `${m[4].padStart(2, "0")}:${m[5]}` : "";
    if (!m || !day || open >= close || close > "24:00") return { message: `Opening hours "${line}" should look like: Mon 09:00-17:00`, errors: { businessHours: "Invalid" } };
    businessHours.push({ day, open, close });
  }

  const candidate = {
    ...before,
    businessName: str(f, "businessName") ?? before.businessName,
    tagline: str(f, "tagline"),
    heroHeading: str(f, "heroHeading"),
    heroSubheading: str(f, "heroSubheading"),
    heroImage: str(f, "heroImage"),
    heroImageAlt: str(f, "heroImageAlt"),
    storyHeading: str(f, "storyHeading"),
    storyBody: str(f, "storyBody"),
    storyImage: str(f, "storyImage"),
    storyImageAlt: str(f, "storyImageAlt"),
    announcement: str(f, "announcement"),
    contactEmail: str(f, "contactEmail"),
    contactPhone: str(f, "contactPhone"),
    addressLines: lines(f, "addressLines"),
    showAddress: f.get("showAddress") === "on",
    serviceArea: str(f, "serviceArea"),
    hours: str(f, "hours"),
    socialLinks: social,
    taxRateBps,
    taxLabel: str(f, "taxLabel") ?? "Sales tax",
    pickupEnabled: f.get("pickupEnabled") === "on",
    pickupInstructions: str(f, "pickupInstructions"),
    deliveryEnabled: f.get("deliveryEnabled") === "on",
    deliveryFeeCents,
    deliveryArea: str(f, "deliveryArea"),
    minLeadTimeHours: Number(f.get("minLeadTimeHours") ?? before.minLeadTimeHours),
    maxAdvanceDays: Number(f.get("maxAdvanceDays") ?? before.maxAdvanceDays),
    fulfillmentWeekdays: f.getAll("fulfillmentWeekdays").map(Number),
    blackoutDates: lines(f, "blackoutDates"),
    timezone: str(f, "timezone") ?? before.timezone,
    checkoutEnabled: f.get("checkoutEnabled") === "on",
    customOrdersEnabled: f.get("customOrdersEnabled") === "on",
    customOrderMinNoticeDays: Number(f.get("customOrderMinNoticeDays") ?? before.customOrderMinNoticeDays),
    customOrderNotice: str(f, "customOrderNotice"),
    customOrderTypes: lines(f, "customOrderTypes"),
    askBudget: f.get("askBudget") === "on",
    dailyCapacityUnits,
    orderCutoffTime: str(f, "orderCutoffTime"),
    businessHours,
    fulfillmentWindows: lines(f, "fulfillmentWindows"),
    depositPercentBps,
    balanceDueDaysBefore: Number(f.get("balanceDueDaysBefore") ?? before.balanceDueDaysBefore),
    quoteValidityDays: Number(f.get("quoteValidityDays") ?? before.quoteValidityDays),
    newArrivalDays: Number(f.get("newArrivalDays") ?? before.newArrivalDays),
    bestsellerMinOrders: Number(f.get("bestsellerMinOrders") ?? before.bestsellerMinOrders),
    notifyStatusChanges: f.get("notifyStatusChanges") === "on",
  };
  for (const k of ["heroImage", "storyImage"] as const) {
    const v = candidate[k];
    if (v && !/^\/(images|media)\//.test(v)) return { message: `${k === "heroImage" ? "Hero" : "Story"} image must be a site path starting with /images/ or /media/.` };
  }
  if (candidate.contactEmail && !emailSchema.safeParse(candidate.contactEmail).success) return { message: "Contact email isn't valid." };
  try {
    Intl.DateTimeFormat("en-US", { timeZone: candidate.timezone });
  } catch {
    return { message: "Unknown timezone. Use a name like America/New_York." };
  }
  const parsed = siteSettingsSchema.safeParse(candidate);
  if (!parsed.success) return { message: `Invalid settings: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };

  await saveSettings(parsed.data);
  const changed = Object.keys(parsed.data).filter((k) => JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(parsed.data[k as keyof typeof parsed.data]));
  await audit(actorFor(admin), "settings.updated", "settings", "site", Object.fromEntries(changed.map((k) => [k, { from: before[k as keyof typeof before], to: parsed.data[k as keyof typeof parsed.data] }])));
  revalidatePath("/", "layout");
  return { ok: true, message: changed.length ? "Settings saved." : "No changes." };
}

export async function addAdminUser(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("users:manage");
  const email = emailSchema.safeParse(f.get("email"));
  const name = String(f.get("name") ?? "").trim().slice(0, 120);
  const role = z.enum(ROLES).safeParse(f.get("role"));
  const password = String(f.get("password") ?? "");
  if (!email.success || !name || !role.success) return { message: "Name, a valid email and a role are required." };
  const problem = passwordProblems(password);
  if (problem) return { message: problem };
  const exists = await db().query.adminUsers.findFirst({ where: eq(schema.adminUsers.email, email.data) });
  if (exists) return { message: "There's already an account with that email." };
  const [u] = await db().insert(schema.adminUsers).values({ email: email.data, name, role: role.data, passwordHash: await hashPassword(password) }).returning({ id: schema.adminUsers.id });
  await audit(actorFor(admin), "admin.user_created", "admin_user", u.id, { email: email.data, role: role.data });
  revalidatePath("/admin/users");
  return { ok: true, message: `Account created for ${email.data}. Share the temporary password securely and ask them to change it.` };
}

export async function updateAdminUser(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("users:manage");
  const id = z.uuid().safeParse(f.get("id"));
  if (!id.success) return { message: "Invalid user." };
  const user = await db().query.adminUsers.findFirst({ where: eq(schema.adminUsers.id, id.data) });
  if (!user) return { message: "User not found." };
  const role = z.enum(ROLES).safeParse(f.get("role"));
  const active = f.get("active") === "on";
  const password = String(f.get("password") ?? "");
  if (!role.success) return { message: "Invalid role." };
  if (user.id === admin.id && (!active || role.data !== "owner")) return { message: "You can't deactivate or demote your own account." };
  if (user.role === "owner" && (role.data !== "owner" || !active)) {
    const [{ value }] = await db().select({ value: count() }).from(schema.adminUsers).where(and(eq(schema.adminUsers.role, "owner"), eq(schema.adminUsers.active, true), ne(schema.adminUsers.id, user.id)));
    if (value === 0) return { message: "There must always be at least one active owner." };
  }
  const patch: Partial<typeof schema.adminUsers.$inferInsert> = { role: role.data, active };
  if (password) {
    const problem = passwordProblems(password);
    if (problem) return { message: problem };
    patch.passwordHash = await hashPassword(password);
  }
  await db().update(schema.adminUsers).set(patch).where(eq(schema.adminUsers.id, user.id));
  if (!active || password) await db().delete(schema.adminSessions).where(eq(schema.adminSessions.userId, user.id));
  await audit(actorFor(admin), "admin.user_updated", "admin_user", user.id, { role: role.data, active, passwordReset: !!password });
  revalidatePath("/admin/users");
  return { ok: true, message: "Account updated." };
}

export async function deleteAdminUserAction(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("users:manage");
  const id = z.uuid().safeParse(f.get("id"));
  if (!id.success) return { message: "Invalid user." };
  if (f.get("confirm") !== "on") return { message: "Tick the box to confirm." };
  const res = await deleteAdminUser(actorFor(admin), id.data);
  revalidatePath("/admin/users");
  return res.ok ? { ok: true, message: `Deleted ${res.email}.` } : { message: res.message };
}

export async function changeOwnPassword(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const password = String(f.get("password") ?? "");
  const problem = passwordProblems(password);
  if (problem) return { message: problem };
  if (password !== String(f.get("confirm") ?? "")) return { message: "The passwords don't match." };
  await db().update(schema.adminUsers).set({ passwordHash: await hashPassword(password) }).where(eq(schema.adminUsers.id, admin.id));
  await audit(actorFor(admin), "admin.password_changed", "admin_user", admin.id);
  return { ok: true, message: "Password changed." };
}
