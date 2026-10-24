"use server";

import { and, eq, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import sharp from "sharp";
import { z } from "zod";
import type { AdminFormState } from "@/components/admin/admin-form";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { actorFor, requireAdmin } from "@/lib/auth/session";
import { parseMoneyInput } from "@/lib/money";
import { slugify, SLUG_PATTERN } from "@/lib/slug";
import { deleteFile, putFile } from "@/lib/storage";
import { validateImageUploads } from "@/lib/uploads";
import { fieldErrors } from "@/lib/validation";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const optInt = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: "Enter a whole number." });
      return z.NEVER;
    }
    return n;
  });

const productSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(160),
    slug: z.string().trim().max(80),
    categoryId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()),
    summary: optText(300),
    description: optText(8000),
    status: z.enum(schema.productStatus.enumValues),
    basePrice: z.string().trim(),
    directPurchase: z.boolean(),
    customOrder: z.boolean(),
    servings: optText(200),
    ingredients: optText(4000),
    allergens: optText(2000),
    leadTimeHours: optInt,
    maxPerOrder: optInt,
    pickupEligible: z.boolean(),
    deliveryEligible: z.boolean(),
    featured: z.boolean(),
    sortOrder: optInt,
    seoTitle: optText(70),
    seoDescription: optText(170),
    migrationStatus: z.enum(schema.migrationStatus.enumValues),
    migrationNotes: optText(2000),
  })
  .transform((v, ctx) => {
    const basePriceCents = v.basePrice ? parseMoneyInput(v.basePrice) : null;
    if (v.basePrice && basePriceCents === null) ctx.addIssue({ code: "custom", path: ["basePrice"], message: "Enter a price like 45 or 45.00." });
    if (v.directPurchase && basePriceCents === null) ctx.addIssue({ code: "custom", path: ["basePrice"], message: "Products sold online need a price." });
    const slug = v.slug ? v.slug.toLowerCase() : slugify(v.name);
    if (!SLUG_PATTERN.test(slug)) ctx.addIssue({ code: "custom", path: ["slug"], message: "Use lowercase letters, numbers and hyphens." });
    return { ...v, slug, basePriceCents, sortOrder: v.sortOrder ?? 0 };
  });

const bool = (form: FormData, k: string) => form.get(k) === "on";

export async function saveProduct(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const id = form.get("id") ? z.uuid().safeParse(form.get("id")) : null;
  if (id && !id.success) return { message: "Invalid product." };
  const raw = Object.fromEntries(
    ["name", "slug", "categoryId", "summary", "description", "status", "basePrice", "servings", "ingredients", "allergens", "leadTimeHours", "maxPerOrder", "sortOrder", "seoTitle", "seoDescription", "migrationStatus", "migrationNotes"].map((k) => [k, String(form.get(k) ?? "")]),
  );
  const parsed = productSchema.safeParse({
    ...raw,
    directPurchase: bool(form, "directPurchase"),
    customOrder: bool(form, "customOrder"),
    pickupEligible: bool(form, "pickupEligible"),
    deliveryEligible: bool(form, "deliveryEligible"),
    featured: bool(form, "featured"),
  });
  if (!parsed.success) return { message: "Please fix the highlighted fields.", errors: fieldErrors(parsed.error) };
  const { basePrice: _bp, ...values } = parsed.data;
  void _bp;

  const clash = await db().query.products.findFirst({ where: eq(schema.products.slug, values.slug), columns: { id: true } });
  if (clash && clash.id !== id?.data) return { message: "Another product already uses that URL slug.", errors: { slug: "Already in use" } };

  let productId = id?.data;
  if (productId) {
    const before = await db().query.products.findFirst({ where: eq(schema.products.id, productId) });
    if (!before) return { message: "Product not found." };
    await db().update(schema.products).set(values).where(eq(schema.products.id, productId));
    const changed = Object.keys(values).filter((k) => before[k as keyof typeof before] !== values[k as keyof typeof values]);
    await audit(actorFor(admin), "product.updated", "product", productId, {
      changed,
      ...(before.basePriceCents !== values.basePriceCents ? { price: { from: before.basePriceCents, to: values.basePriceCents } } : {}),
    });
  } else {
    const [row] = await db().insert(schema.products).values(values).returning({ id: schema.products.id });
    productId = row.id;
    await audit(actorFor(admin), "product.created", "product", productId, { name: values.name });
  }
  revalidatePath("/admin/products");
  if (!id) redirect(`/admin/products/${productId}?created=1`);
  return { ok: true, message: "Product saved." };
}

const optionsSchema = z
  .array(
    z.object({
      id: z.uuid().optional(),
      name: z.string().trim().min(1, "Every option needs a name.").max(80),
      required: z.boolean(),
      values: z
        .array(
          z.object({
            id: z.uuid().optional(),
            label: z.string().trim().min(1, "Every choice needs a label.").max(120),
            priceDeltaCents: z.number().int().min(-1_000_000).max(1_000_000),
            available: z.boolean(),
          }),
        )
        .min(1, "Every option needs at least one choice.")
        .max(40),
    }),
  )
  .max(12);

/** Save options, keeping the ids of existing options/values so customers' carts stay valid. */
export async function saveOptions(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const productId = z.uuid().safeParse(form.get("productId"));
  if (!productId.success) return { message: "Invalid product." };
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("options") ?? "[]"));
  } catch {
    return { message: "Couldn't read the options." };
  }
  const parsed = optionsSchema.safeParse(raw);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Invalid options." };

  await db().transaction(async (tx) => {
    const existing = await tx.query.productOptions.findMany({ where: eq(schema.productOptions.productId, productId.data), with: { values: true } });
    const existingIds = new Set(existing.map((o) => o.id));
    const keepOptionIds = parsed.data.map((o) => o.id).filter((x): x is string => !!x && existingIds.has(x));
    await tx.delete(schema.productOptions).where(and(eq(schema.productOptions.productId, productId.data), keepOptionIds.length ? notInArray(schema.productOptions.id, keepOptionIds) : undefined));

    for (const [i, o] of parsed.data.entries()) {
      let optionId = o.id && existingIds.has(o.id) ? o.id : undefined;
      if (optionId) {
        await tx.update(schema.productOptions).set({ name: o.name, required: o.required, sortOrder: i }).where(eq(schema.productOptions.id, optionId));
      } else {
        optionId = (await tx.insert(schema.productOptions).values({ productId: productId.data, name: o.name, required: o.required, sortOrder: i }).returning({ id: schema.productOptions.id }))[0].id;
      }
      const prevValues = new Set(existing.find((e) => e.id === optionId)?.values.map((v) => v.id) ?? []);
      const keepValueIds = o.values.map((v) => v.id).filter((x): x is string => !!x && prevValues.has(x));
      await tx.delete(schema.productOptionValues).where(and(eq(schema.productOptionValues.optionId, optionId), keepValueIds.length ? notInArray(schema.productOptionValues.id, keepValueIds) : undefined));
      for (const [j, v] of o.values.entries()) {
        const data = { label: v.label, priceDeltaCents: v.priceDeltaCents, available: v.available, sortOrder: j };
        if (v.id && prevValues.has(v.id)) await tx.update(schema.productOptionValues).set(data).where(eq(schema.productOptionValues.id, v.id));
        else await tx.insert(schema.productOptionValues).values({ ...data, optionId });
      }
    }
  });
  await audit(actorFor(admin), "product.options_updated", "product", productId.data, { options: parsed.data.map((o) => ({ name: o.name, values: o.values.map((v) => `${v.label} (${v.priceDeltaCents})`) })) });
  revalidatePath(`/admin/products/${productId.data}`);
  return { ok: true, message: "Options saved." };
}

export async function uploadProductImage(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const productId = z.uuid().safeParse(form.get("productId"));
  if (!productId.success) return { message: "Invalid product." };
  const alt = String(form.get("alt") ?? "").trim().slice(0, 300);
  if (!alt) return { message: "Describe the photo for people who can't see it (alt text).", errors: { alt: "Required" } };
  const files = form.getAll("image").filter((f): f is File => f instanceof File);
  if (!files.some((f) => f.size > 0)) return { message: "Choose an image to upload." };
  const checked = await validateImageUploads(files.slice(0, 1), { maxFiles: 1, maxBytes: 15 * 1024 * 1024 });
  if (!checked.ok) return { message: checked.errors[0].message };
  const [file] = checked.files;
  // Normalise orientation and strip metadata (e.g. GPS) before publishing.
  const img = sharp(file.bytes).rotate();
  const output = await img.toBuffer({ resolveWithObject: true });
  const key = await putFile("media", file.kind.ext, new Uint8Array(output.data));
  const count = await db().$count(schema.productImages, eq(schema.productImages.productId, productId.data));
  await db().insert(schema.productImages).values({ productId: productId.data, src: `/media/${key}`, alt, width: output.info.width, height: output.info.height, sortOrder: count });
  await audit(actorFor(admin), "product.image_added", "product", productId.data, { key });
  revalidatePath(`/admin/products/${productId.data}`);
  return { ok: true, message: "Photo added." };
}

export async function updateProductImage(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const id = z.uuid().safeParse(form.get("imageId"));
  if (!id.success) return { message: "Invalid image." };
  const image = await db().query.productImages.findFirst({ where: eq(schema.productImages.id, id.data) });
  if (!image) return { message: "Image not found." };
  if (form.get("intent") === "delete") {
    await db().delete(schema.productImages).where(eq(schema.productImages.id, image.id));
    if (image.src.startsWith("/media/")) await deleteFile("media", image.src.slice("/media/".length)).catch(() => undefined);
    await audit(actorFor(admin), "product.image_removed", "product", image.productId, { src: image.src });
  } else {
    const alt = String(form.get("alt") ?? "").trim().slice(0, 300);
    const sortOrder = Number(form.get("sortOrder") ?? image.sortOrder);
    if (!alt) return { message: "Alt text is required." };
    await db().update(schema.productImages).set({ alt, sortOrder: Number.isInteger(sortOrder) ? sortOrder : image.sortOrder }).where(eq(schema.productImages.id, image.id));
  }
  revalidatePath(`/admin/products/${image.productId}`);
  return { ok: true, message: form.get("intent") === "delete" ? "Photo removed." : "Photo updated." };
}
