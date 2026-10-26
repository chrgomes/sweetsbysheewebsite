"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { z } from "zod";
import type { AdminFormState } from "@/components/admin/admin-form";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { actorFor, requireAdmin } from "@/lib/auth/session";
import { isIsoDate } from "@/lib/dates";
import { slugify, SLUG_PATTERN } from "@/lib/slug";
import { deleteFile, putFile } from "@/lib/storage";
import { validateImageUploads } from "@/lib/uploads";

const s = (f: FormData, k: string, max = 10000) => String(f.get(k) ?? "").trim().slice(0, max);
const n = (f: FormData, k: string) => {
  const v = Number(f.get(k) ?? 0);
  return Number.isInteger(v) ? v : 0;
};
const b = (f: FormData, k: string) => f.get(k) === "on";
const isDelete = (f: FormData) => f.get("intent") === "delete";
const idOf = (f: FormData) => {
  const r = z.uuid().safeParse(f.get("id"));
  return r.success ? r.data : null;
};

/** Upload an owner image to public media storage, stripping metadata. Returns its public path. */
async function storeMediaImage(form: FormData, field: string): Promise<{ src: string; width: number; height: number } | { error: string } | null> {
  const files = form.getAll(field).filter((x): x is File => x instanceof File && x.size > 0);
  if (!files.length) return null;
  const checked = await validateImageUploads(files.slice(0, 1), { maxFiles: 1, maxBytes: 15 * 1024 * 1024 });
  if (!checked.ok) return { error: checked.errors[0].message };
  const out = await sharp(checked.files[0].bytes).rotate().toBuffer({ resolveWithObject: true });
  const key = await putFile("media", checked.files[0].kind.ext, new Uint8Array(out.data));
  return { src: `/media/${key}`, width: out.info.width, height: out.info.height };
}

export async function saveCategory(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("products:edit");
  const id = idOf(f);
  if (id && isDelete(f)) {
    await db().delete(schema.categories).where(eq(schema.categories.id, id));
    await audit(actorFor(admin), "category.deleted", "category", id);
    revalidatePath("/admin/categories");
    return { ok: true, message: "Category deleted. Its products are now uncategorised." };
  }
  const name = s(f, "name", 120);
  if (!name) return { message: "Name is required." };
  const slug = (s(f, "slug", 80) || slugify(name)).toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return { message: "Slug may only contain lowercase letters, numbers and hyphens." };
  const values = { name, slug, description: s(f, "description", 1000) || null, sortOrder: n(f, "sortOrder"), seoTitle: s(f, "seoTitle", 70) || null, seoDescription: s(f, "seoDescription", 170) || null };
  const clash = await db().query.categories.findFirst({ where: eq(schema.categories.slug, slug) });
  if (clash && clash.id !== id) return { message: "Another category already uses that slug." };
  if (id) await db().update(schema.categories).set(values).where(eq(schema.categories.id, id));
  else await db().insert(schema.categories).values(values);
  await audit(actorFor(admin), id ? "category.updated" : "category.created", "category", id, { name });
  revalidatePath("/admin/categories");
  return { ok: true, message: "Category saved." };
}

export async function saveCollection(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("products:edit");
  const id = idOf(f);
  if (id && isDelete(f)) {
    await db().delete(schema.collections).where(eq(schema.collections.id, id));
    await audit(actorFor(admin), "collection.deleted", "collection", id);
    revalidatePath("/admin/collections");
    return { ok: true, message: "Collection deleted. Its products are unchanged." };
  }
  const name = s(f, "name", 120);
  if (!name) return { message: "Name is required." };
  const slug = (s(f, "slug", 80) || slugify(name)).toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return { message: "Slug may only contain lowercase letters, numbers and hyphens." };
  const startsOn = s(f, "startsOn", 10) || null;
  const endsOn = s(f, "endsOn", 10) || null;
  if ((startsOn && !isIsoDate(startsOn)) || (endsOn && !isIsoDate(endsOn))) return { message: "Dates must be valid." };
  if (startsOn && endsOn && endsOn < startsOn) return { message: "The end date is before the start date." };
  const values = { name, slug, description: s(f, "description", 1000) || null, active: f.get("active") === "on", featured: f.get("featured") === "on", startsOn, endsOn, sortOrder: n(f, "sortOrder") };
  const clash = await db().query.collections.findFirst({ where: eq(schema.collections.slug, slug) });
  if (clash && clash.id !== id) return { message: "Another collection already uses that slug." };
  if (id) await db().update(schema.collections).set(values).where(eq(schema.collections.id, id));
  else await db().insert(schema.collections).values(values);
  await audit(actorFor(admin), id ? "collection.updated" : "collection.created", "collection", id, { name, active: values.active, featured: values.featured });
  revalidatePath("/admin/collections");
  revalidatePath("/", "layout");
  return { ok: true, message: "Collection saved. Add products to it from each product's page." };
}

export async function saveFaq(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("content:edit");
  const id = idOf(f);
  if (id && isDelete(f)) {
    await db().delete(schema.faqs).where(eq(schema.faqs.id, id));
    await audit(actorFor(admin), "faq.deleted", "faq", id);
  } else {
    const values = { question: s(f, "question", 300), answer: s(f, "answer", 5000), sortOrder: n(f, "sortOrder"), published: b(f, "published") };
    if (!values.question || !values.answer) return { message: "Question and answer are required." };
    if (id) await db().update(schema.faqs).set(values).where(eq(schema.faqs.id, id));
    else await db().insert(schema.faqs).values(values);
    await audit(actorFor(admin), id ? "faq.updated" : "faq.created", "faq", id);
  }
  revalidatePath("/admin/content");
  return { ok: true, message: "Saved." };
}

export async function savePage(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("content:edit");
  const id = idOf(f);
  if (id && isDelete(f)) {
    await db().delete(schema.pages).where(eq(schema.pages.id, id));
    await audit(actorFor(admin), "page.deleted", "page", id);
    revalidatePath("/admin/content");
    return { ok: true, message: "Page deleted." };
  }
  const title = s(f, "title", 200);
  const slug = (s(f, "slug", 80) || slugify(title)).toLowerCase();
  const kind = f.get("kind") === "about" ? "about" : "policy";
  const values = { title, slug: kind === "about" ? "about" : slug, body: s(f, "body", 50000), kind, published: b(f, "published"), seoTitle: s(f, "seoTitle", 70) || null, seoDescription: s(f, "seoDescription", 170) || null };
  if (!title || !values.body) return { message: "Title and body are required." };
  if (!SLUG_PATTERN.test(values.slug)) return { message: "Invalid slug." };
  const clash = await db().query.pages.findFirst({ where: eq(schema.pages.slug, values.slug) });
  if (clash && clash.id !== id) return { message: "Another page already uses that slug." };
  if (id) await db().update(schema.pages).set(values).where(eq(schema.pages.id, id));
  else await db().insert(schema.pages).values(values);
  await audit(actorFor(admin), id ? "page.updated" : "page.created", "page", id, { slug: values.slug });
  revalidatePath("/admin/content");
  return { ok: true, message: "Page saved." };
}

export async function saveGalleryItem(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("content:edit");
  const id = idOf(f);
  if (id && isDelete(f)) {
    const item = await db().query.galleryItems.findFirst({ where: eq(schema.galleryItems.id, id) });
    await db().delete(schema.galleryItems).where(eq(schema.galleryItems.id, id));
    if (item?.src.startsWith("/media/")) await deleteFile("media", item.src.slice(7)).catch(() => undefined);
    await audit(actorFor(admin), "gallery.deleted", "gallery_item", id);
    revalidatePath("/admin/content");
    return { ok: true, message: "Photo removed." };
  }
  const alt = s(f, "alt", 300);
  if (!alt) return { message: "Alt text is required — describe what the photo shows." };
  const values = { alt, caption: s(f, "caption", 300) || null, collection: s(f, "collection", 80) || null, sortOrder: n(f, "sortOrder"), featured: b(f, "featured"), published: b(f, "published") };
  if (id) {
    await db().update(schema.galleryItems).set(values).where(eq(schema.galleryItems.id, id));
  } else {
    const img = await storeMediaImage(f, "image");
    if (!img) return { message: "Choose a photo to upload." };
    if ("error" in img) return { message: img.error };
    await db().insert(schema.galleryItems).values({ ...values, ...img });
  }
  await audit(actorFor(admin), id ? "gallery.updated" : "gallery.created", "gallery_item", id);
  revalidatePath("/admin/content");
  return { ok: true, message: "Saved." };
}

export async function saveTestimonial(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("content:edit");
  const id = idOf(f);
  if (id && isDelete(f)) {
    await db().delete(schema.testimonials).where(eq(schema.testimonials.id, id));
    await audit(actorFor(admin), "testimonial.deleted", "testimonial", id);
  } else {
    const values = { quote: s(f, "quote", 1500), author: s(f, "author", 120), context: s(f, "context", 120) || null, verified: b(f, "verified"), published: b(f, "published"), sortOrder: n(f, "sortOrder") };
    if (!values.quote || !values.author) return { message: "Quote and author are required." };
    if (values.published && !values.verified) return { message: "Only testimonials you've verified as genuine can be published." };
    if (id) await db().update(schema.testimonials).set(values).where(eq(schema.testimonials.id, id));
    else await db().insert(schema.testimonials).values(values);
    await audit(actorFor(admin), id ? "testimonial.updated" : "testimonial.created", "testimonial", id);
  }
  revalidatePath("/admin/content");
  return { ok: true, message: "Saved." };
}

export async function uploadSiteImage(_p: AdminFormState, f: FormData): Promise<AdminFormState & { src?: string }> {
  await requireAdmin("content:edit");
  const img = await storeMediaImage(f, "image");
  if (!img) return { message: "Choose a photo to upload." };
  if ("error" in img) return { message: img.error };
  return { ok: true, message: `Uploaded. Path: ${img.src}`, src: img.src };
}
