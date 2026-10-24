import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PricedProduct } from "./pricing";

const { products, categories } = schema;

/** Statuses visible on the public site. Unavailable products stay visible but can't be bought. */
const PUBLIC_STATUSES = ["active", "unavailable"] as const;

export type CatalogProduct = Awaited<ReturnType<typeof getProductBySlug>> & {};

export async function listCategories() {
  return db().query.categories.findMany({ orderBy: [asc(categories.sortOrder), asc(categories.name)] });
}

/** Categories that have at least one public product. */
export async function listPublicCategories() {
  const rows = await db()
    .selectDistinct({ id: categories.id, slug: categories.slug, name: categories.name, description: categories.description, sortOrder: categories.sortOrder })
    .from(categories)
    .innerJoin(products, eq(products.categoryId, categories.id))
    .where(inArray(products.status, [...PUBLIC_STATUSES]))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  return rows;
}

export async function getCategoryBySlug(slug: string) {
  return db().query.categories.findFirst({ where: eq(categories.slug, slug) });
}

export async function listPublicProducts(opts: { categoryId?: string; featuredOnly?: boolean; limit?: number } = {}) {
  const where = [inArray(products.status, [...PUBLIC_STATUSES])];
  if (opts.categoryId) where.push(eq(products.categoryId, opts.categoryId));
  if (opts.featuredOnly) where.push(eq(products.featured, true));
  return db().query.products.findMany({
    where: and(...where),
    with: { category: true, images: { orderBy: (i, { asc }) => [asc(i.sortOrder)], limit: 1 }, options: { with: { values: true } } },
    orderBy: [asc(products.sortOrder), asc(products.name)],
    limit: opts.limit,
  });
}

export type ProductCardData = Awaited<ReturnType<typeof listPublicProducts>>[number];

export async function getProductBySlug(slug: string) {
  return db().query.products.findFirst({
    where: and(eq(products.slug, slug), inArray(products.status, [...PUBLIC_STATUSES])),
    with: {
      category: true,
      images: { orderBy: (i, { asc }) => [asc(i.sortOrder)] },
      options: {
        orderBy: (o, { asc }) => [asc(o.sortOrder)],
        with: { values: { orderBy: (v, { asc }) => [asc(v.sortOrder)] } },
      },
    },
  });
}

export async function listRelatedProducts(productId: string, categoryId: string | null, limit = 3) {
  if (!categoryId) return [];
  return db().query.products.findMany({
    where: and(eq(products.categoryId, categoryId), ne(products.id, productId), inArray(products.status, [...PUBLIC_STATUSES])),
    with: { category: true, images: { orderBy: (i, { asc }) => [asc(i.sortOrder)], limit: 1 }, options: { with: { values: true } } },
    orderBy: [asc(products.sortOrder)],
    limit,
  });
}

/** Load products in the shape the pricing engine needs. Includes non-public products so we can explain why they can't be bought. */
export async function loadPricedProducts(ids: string[]): Promise<Map<string, PricedProduct>> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!unique.length) return new Map();
  const rows = await db().query.products.findMany({
    where: inArray(products.id, unique),
    with: {
      images: { orderBy: (i, { asc }) => [asc(i.sortOrder)], limit: 1 },
      options: { with: { values: true } },
    },
  });
  return new Map(
    rows.map((p) => [
      p.id,
      {
        id: p.id,
        name: p.name,
        slug: p.slug,
        status: p.status,
        basePriceCents: p.basePriceCents,
        currency: p.currency,
        directPurchase: p.directPurchase,
        leadTimeHours: p.leadTimeHours,
        pickupEligible: p.pickupEligible,
        deliveryEligible: p.deliveryEligible,
        maxPerOrder: p.maxPerOrder,
        image: p.images[0] ? { src: p.images[0].src, alt: p.images[0].alt } : null,
        options: p.options.map((o) => ({
          id: o.id,
          name: o.name,
          required: o.required,
          values: o.values.map((v) => ({ id: v.id, label: v.label, priceDeltaCents: v.priceDeltaCents, available: v.available })),
        })),
      } satisfies PricedProduct,
    ]),
  );
}

/** Products that can be named on the custom-order form. */
export async function listCustomOrderProducts() {
  return db().query.products.findMany({
    where: and(eq(products.customOrder, true), inArray(products.status, [...PUBLIC_STATUSES])),
    columns: { id: true, name: true, slug: true },
    orderBy: [asc(products.sortOrder), asc(products.name)],
  });
}

/** Lowest price a customer could pay for a product, for "From $X" labels. */
export function fromPrice(p: { basePriceCents: number | null; options?: { required: boolean; values: { priceDeltaCents: number; available: boolean }[] }[] }) {
  if (p.basePriceCents === null) return null;
  let min = p.basePriceCents;
  let hasRange = false;
  for (const o of p.options ?? []) {
    const deltas = o.values.filter((v) => v.available).map((v) => v.priceDeltaCents);
    if (!deltas.length) continue;
    if (new Set(deltas).size > 1) hasRange = true;
    if (o.required) min += Math.min(...deltas);
  }
  return { cents: min, isFrom: hasRange };
}
