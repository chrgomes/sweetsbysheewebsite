import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export async function listFaqs() {
  return db().query.faqs.findMany({ where: eq(schema.faqs.published, true), orderBy: [asc(schema.faqs.sortOrder), asc(schema.faqs.createdAt)] });
}

export async function listGallery(opts: { featuredOnly?: boolean; limit?: number } = {}) {
  const where = [eq(schema.galleryItems.published, true)];
  if (opts.featuredOnly) where.push(eq(schema.galleryItems.featured, true));
  return db().query.galleryItems.findMany({ where: and(...where), orderBy: [asc(schema.galleryItems.sortOrder), asc(schema.galleryItems.createdAt)], limit: opts.limit });
}

/** Only testimonials the owner has verified as genuine are ever shown. */
export async function listTestimonials(limit?: number) {
  return db().query.testimonials.findMany({
    where: and(eq(schema.testimonials.published, true), eq(schema.testimonials.verified, true)),
    orderBy: [asc(schema.testimonials.sortOrder)],
    limit,
  });
}

export async function getPage(slug: string) {
  return db().query.pages.findFirst({ where: and(eq(schema.pages.slug, slug), eq(schema.pages.published, true)) });
}

export async function listPolicyPages() {
  return db().query.pages.findMany({
    where: and(eq(schema.pages.kind, "policy"), eq(schema.pages.published, true)),
    columns: { slug: true, title: true },
    orderBy: [asc(schema.pages.title)],
  });
}
