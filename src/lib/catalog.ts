import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
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

/** `preview` includes hidden (draft/archived) products; only pass it after an admin permission check. */
export async function getProductBySlug(slug: string, opts: { preview?: boolean } = {}) {
  return db().query.products.findFirst({
    where: and(eq(products.slug, slug), opts.preview ? undefined : inArray(products.status, [...PUBLIC_STATUSES])),
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
        capacityUnits: p.capacityUnits,
        image: p.images[0] ? { src: p.images[0].src, alt: p.images[0].alt } : null,
        options: p.options.map((o) => ({
          id: o.id,
          name: o.name,
          kind: o.kind,
          required: o.required,
          maxLength: o.maxLength,
          priceDeltaCents: o.priceDeltaCents,
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
export function fromPrice(p: {
  basePriceCents: number | null;
  options?: { kind?: "choice" | "text"; required: boolean; priceDeltaCents?: number; values: { priceDeltaCents: number; available: boolean }[] }[];
}) {
  if (p.basePriceCents === null) return null;
  let min = p.basePriceCents;
  let hasRange = false;
  for (const o of p.options ?? []) {
    if (o.kind === "text") {
      if (o.required) min += o.priceDeltaCents ?? 0;
      else if (o.priceDeltaCents) hasRange = true;
      continue;
    }
    const deltas = o.values.filter((v) => v.available).map((v) => v.priceDeltaCents);
    if (!deltas.length) continue;
    if (new Set(deltas).size > 1) hasRange = true;
    if (o.required) min += Math.min(...deltas);
  }
  return { cents: min, isFrom: hasRange };
}

/* Merchandising ----------------------------------------------------------- */

/** Collections that are active and in season on `today` (YYYY-MM-DD), with their public products. */
export async function listActiveCollections(today: string, opts: { featuredOnly?: boolean } = {}) {
  const cols = await db().query.collections.findMany({
    where: and(
      eq(schema.collections.active, true),
      opts.featuredOnly ? eq(schema.collections.featured, true) : undefined,
      or(isNull(schema.collections.startsOn), lte(schema.collections.startsOn, today)),
      or(isNull(schema.collections.endsOn), gte(schema.collections.endsOn, today)),
    ),
    orderBy: [asc(schema.collections.sortOrder), asc(schema.collections.name)],
    with: {
      products: {
        orderBy: (pc, o) => [o.asc(pc.sortOrder)],
        with: { product: { with: { category: true, images: { orderBy: (i, o) => [o.asc(i.sortOrder)], limit: 1 }, options: { with: { values: true } } } } },
      },
    },
  });
  return cols
    .map((c) => ({ ...c, products: c.products.map((pc) => pc.product).filter((p) => PUBLIC_STATUSES.includes(p.status as (typeof PUBLIC_STATUSES)[number])) }))
    .filter((c) => c.products.length > 0);
}

export async function getCollectionBySlug(slug: string, today: string) {
  return (await listActiveCollections(today)).find((c) => c.slug === slug) ?? null;
}

/** Products first published within the last `days` days. Derived from data, never hand-labelled. */
export async function listNewArrivals(days: number, limit = 6) {
  if (days <= 0) return [];
  const since = new Date(Date.now() - days * 86_400_000);
  return db().query.products.findMany({
    where: and(inArray(products.status, ["active"]), gte(products.publishedAt, since)),
    with: { category: true, images: { orderBy: (i, o) => [o.asc(i.sortOrder)], limit: 1 }, options: { with: { values: true } } },
    orderBy: [desc(products.publishedAt)],
    limit,
  });
}

/**
 * Bestsellers: products with at least `minOrders` paid orders in the last 90
 * days, ranked by paid order count. Empty until there's real sales history.
 */
export async function listBestsellers(minOrders: number, limit = 6) {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const ranked = await db()
    .select({ productId: schema.orderItems.productId, orders: sql<number>`count(distinct ${schema.orderItems.orderId})::int` })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .where(and(inArray(schema.orders.paymentStatus, ["deposit_paid", "paid"]), gte(schema.orders.createdAt, since)))
    .groupBy(schema.orderItems.productId)
    .having(sql`count(distinct ${schema.orderItems.orderId}) >= ${minOrders}`)
    .orderBy(sql`count(distinct ${schema.orderItems.orderId}) desc`)
    .limit(limit);
  const ids = ranked.map((r) => r.productId).filter((x): x is string => !!x);
  if (!ids.length) return [];
  const rows = await db().query.products.findMany({ where: and(inArray(products.id, ids), eq(products.status, "active")), with: { category: true, images: { orderBy: (i, o) => [o.asc(i.sortOrder)], limit: 1 }, options: { with: { values: true } } } });
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is (typeof rows)[number] => !!r);
}

/** Cut-off (ms since epoch) for the "New" badge, or undefined when the badge is off. */
export function newSince(days: number, now = Date.now()): number | undefined {
  return days > 0 ? now - days * 86_400_000 : undefined;
}
