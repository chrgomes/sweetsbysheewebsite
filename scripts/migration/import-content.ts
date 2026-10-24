/**
 * Import data/content/catalog.json into the database. Idempotent: records are
 * matched by slug (products, categories, pages), question (FAQs) or image
 * path (gallery), so rerunning never duplicates anything.
 *
 *   pnpm db:seed [--file data/content/catalog.json] [--dry-run]
 *
 * Owner edits win: a product whose review status is no longer "needs_review"
 * is left untouched, as are settings fields the owner has already filled in.
 */
import { eq } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Catalog } from "../lib/catalog-format";
import { closeDb, db, redactedUrl, schema } from "../lib/db";

const { values: args } = parseArgs({ options: { file: { type: "string", default: "data/content/catalog.json" }, "dry-run": { type: "boolean", default: false } } });
if (!existsSync(args.file!)) {
  console.error(`${args.file} not found. Run the audit and pnpm migrate:normalize first (docs/content-migration.md).`);
  process.exit(1);
}
const catalog = JSON.parse(readFileSync(args.file!, "utf8")) as Catalog;
const dry = args["dry-run"];
class DryRun extends Error {}
const stats = { categories: 0, productsCreated: 0, productsUpdated: 0, productsSkippedOwnerEdited: 0, faqs: 0, pages: 0, gallery: 0, settingsFields: 0 };

await db.transaction(async (tx) => {
  const catIds = new Map<string, string>();
  for (const [i, c] of catalog.categories.entries()) {
    const [row] = await tx
      .insert(schema.categories)
      .values({ slug: c.slug, name: c.name, description: c.description, sourceUrl: c.sourceUrl, sortOrder: i })
      .onConflictDoUpdate({ target: schema.categories.slug, set: { sourceUrl: c.sourceUrl } })
      .returning({ id: schema.categories.id });
    catIds.set(c.slug, row.id);
    stats.categories++;
  }

  for (const [i, p] of catalog.products.entries()) {
    const existing = await tx.query.products.findFirst({ where: eq(schema.products.slug, p.slug) });
    if (existing && existing.migrationStatus !== "needs_review") {
      stats.productsSkippedOwnerEdited++;
      continue;
    }
    const values = {
      slug: p.slug,
      name: p.name,
      categoryId: p.category ? (catIds.get(p.category) ?? null) : null,
      summary: p.summary,
      description: p.description,
      basePriceCents: p.basePriceCents,
      currency: p.currency,
      status: p.status,
      directPurchase: p.directPurchase && p.basePriceCents !== null,
      customOrder: p.customOrder,
      servings: p.servings ?? null,
      ingredients: p.ingredients ?? null,
      allergens: p.allergens ?? null,
      leadTimeHours: p.leadTimeHours ?? null,
      sourceUrl: p.sourceUrl,
      migrationStatus: p.migrationStatus,
      migrationNotes: p.migrationNotes,
      sortOrder: i,
    };
    let productId: string;
    if (existing) {
      await tx.update(schema.products).set(values).where(eq(schema.products.id, existing.id));
      productId = existing.id;
      stats.productsUpdated++;
      // Still unreviewed, so it's safe to replace migrated options and images.
      await tx.delete(schema.productOptions).where(eq(schema.productOptions.productId, productId));
      await tx.delete(schema.productImages).where(eq(schema.productImages.productId, productId));
    } else {
      productId = (await tx.insert(schema.products).values(values).returning({ id: schema.products.id }))[0].id;
      stats.productsCreated++;
    }
    for (const [oi, o] of p.options.entries()) {
      const [opt] = await tx.insert(schema.productOptions).values({ productId, name: o.name, required: o.required, sortOrder: oi }).returning();
      if (o.values.length) await tx.insert(schema.productOptionValues).values(o.values.map((v, vi) => ({ optionId: opt.id, label: v.label, priceDeltaCents: v.priceDeltaCents, available: v.available, sortOrder: vi })));
    }
    if (p.images.length) await tx.insert(schema.productImages).values(p.images.map((im, ii) => ({ productId, src: im.src, alt: im.alt, width: im.width, height: im.height, sourceUrl: im.sourceUrl, sortOrder: ii })));
  }

  for (const [i, f] of catalog.faqs.entries()) {
    const exists = await tx.query.faqs.findFirst({ where: eq(schema.faqs.question, f.question) });
    if (!exists) await tx.insert(schema.faqs).values({ question: f.question, answer: f.answer, published: f.published, sourceUrl: f.sourceUrl, sortOrder: i }), stats.faqs++;
  }
  for (const pg of catalog.pages) {
    const exists = await tx.query.pages.findFirst({ where: eq(schema.pages.slug, pg.slug) });
    if (!exists) await tx.insert(schema.pages).values(pg), stats.pages++;
  }
  for (const [i, g] of catalog.gallery.entries()) {
    const exists = await tx.query.galleryItems.findFirst({ where: eq(schema.galleryItems.src, g.src) });
    if (!exists) await tx.insert(schema.galleryItems).values({ ...g, sortOrder: i }), stats.gallery++;
  }

  // Settings: fill only empty fields.
  const row = await tx.query.settings.findFirst({ where: eq(schema.settings.key, "site") });
  const current = (row?.value ?? {}) as Record<string, unknown>;
  const next = { ...current };
  for (const [k, v] of Object.entries(catalog.settings)) {
    const empty = current[k] === undefined || current[k] === null || (Array.isArray(current[k]) && (current[k] as unknown[]).length === 0);
    if (empty && v !== undefined) (next[k] = v), stats.settingsFields++;
  }
  if (stats.settingsFields) {
    await tx.insert(schema.settings).values({ key: "site", value: next }).onConflictDoUpdate({ target: schema.settings.key, set: { value: next, updatedAt: new Date() } });
  }
  await tx.insert(schema.auditLog).values({ actorLabel: "migration", action: "content.imported", entityType: "catalog", details: { file: args.file, ...stats } });
  if (dry) throw new DryRun();
}).catch((e) => {
  if (!(e instanceof DryRun)) throw e;
});

console.log(`${dry ? "[dry run, nothing saved] " : ""}Imported into ${redactedUrl()}:`, stats);
await closeDb();
