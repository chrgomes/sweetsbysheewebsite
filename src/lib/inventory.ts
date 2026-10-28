import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type DbOrTx, type Tx } from "@/db";
import { audit, type Actor } from "@/lib/audit";
import { ingredientNeeds, recipeUnitCost, round3, type RecipeForMath } from "@/lib/recipe-math";

/**
 * Ingredients, suppliers, the stock ledger and recipes. Stock on hand is the
 * sum of an ingredient's movements; nothing stores a running total. Orders use
 * stock when they go into production and give it back if cancelled afterwards
 * (see updateOrderStatus). Costs are admin-only and never reach public pages.
 */

export const BASE_UNITS = schema.baseUnit.enumValues;
export type BaseUnit = (typeof BASE_UNITS)[number];
export const UNIT_LABELS: Record<BaseUnit, string> = { g: "grams (g)", ml: "millilitres (ml)", each: "each" };

export const MOVEMENT_LABELS: Record<(typeof schema.stockMovementKind.enumValues)[number], string> = {
  receipt: "Delivery",
  usage: "Used by order",
  reversal: "Returned (order cancelled)",
  adjustment: "Stocktake",
  waste: "Waste",
};

const onHand = sql<number>`coalesce(sum(${schema.stockMovements.quantity}), 0)::float8`.mapWith(Number);

async function stockLevels(ids?: string[]) {
  const rows = await db()
    .select({ ingredientId: schema.stockMovements.ingredientId, onHand })
    .from(schema.stockMovements)
    .where(ids ? inArray(schema.stockMovements.ingredientId, ids) : undefined)
    .groupBy(schema.stockMovements.ingredientId);
  return new Map(rows.map((r) => [r.ingredientId, round3(r.onHand)]));
}

export type IngredientRow = Awaited<ReturnType<typeof listIngredients>>[number];

export async function listIngredients(opts: { includeInactive?: boolean } = {}) {
  const [rows, levels] = await Promise.all([
    db().query.ingredients.findMany({
      where: opts.includeInactive ? undefined : eq(schema.ingredients.active, true),
      with: { supplier: { columns: { id: true, name: true } } },
      orderBy: [asc(schema.ingredients.name)],
    }),
    stockLevels(),
  ]);
  return rows.map((i) => {
    const stock = levels.get(i.id) ?? 0;
    return { ...i, onHand: stock, low: i.active && i.reorderLevel !== null && stock <= i.reorderLevel };
  });
}

/** Active ingredients at or below their reorder level, for the dashboard. */
export async function lowStock() {
  return (await listIngredients()).filter((i) => i.low);
}

export async function getIngredient(id: string) {
  const ingredient = await db().query.ingredients.findFirst({
    where: eq(schema.ingredients.id, id),
    with: {
      supplier: true,
      movements: { orderBy: (m) => [desc(m.createdAt)], limit: 100, with: { order: { columns: { id: true, reference: true } } } },
      recipeItems: { with: { recipe: { with: { product: { columns: { id: true, name: true } } } } } },
    },
  });
  if (!ingredient) return null;
  return { ...ingredient, onHand: (await stockLevels([id])).get(id) ?? 0 };
}

/* ------------------------------------------------------------------ */
/* Suppliers and ingredients                                           */
/* ------------------------------------------------------------------ */

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  contactName: optText(120),
  email: z
    .string()
    .trim()
    .max(254)
    .nullish()
    .transform((v) => v || null)
    .pipe(z.email("Enter a valid email.").nullable()),
  phone: optText(40),
  website: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^https?:\/\//.test(v), "Start the website with https://"),
  notes: optText(2000),
  active: z.boolean(),
});
export type SupplierInput = z.infer<typeof supplierInputSchema>;

export async function saveSupplier(actor: Actor, id: string | null, input: SupplierInput) {
  const clash = await db().query.suppliers.findFirst({ where: eq(schema.suppliers.name, input.name), columns: { id: true } });
  if (clash && clash.id !== id) return { ok: false as const, message: "There's already a supplier with that name." };
  if (id) await db().update(schema.suppliers).set(input).where(eq(schema.suppliers.id, id));
  else id = (await db().insert(schema.suppliers).values(input).returning({ id: schema.suppliers.id }))[0].id;
  await audit(actor, "supplier.saved", "supplier", id, { name: input.name, active: input.active });
  return { ok: true as const, id };
}

export async function listSuppliers() {
  return db().query.suppliers.findMany({ orderBy: [asc(schema.suppliers.name)], with: { ingredients: { columns: { id: true } } } });
}

const nonNegative = (max: number) => z.number({ error: "Enter a number." }).finite().min(0, "Can't be negative.").max(max);

export const ingredientInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  unit: z.enum(BASE_UNITS),
  supplierId: z.uuid().nullable(),
  /** Cents per base unit. */
  costPerUnitCents: nonNegative(10_000_000).nullable(),
  reorderLevel: nonNegative(100_000_000).nullable(),
  notes: optText(2000),
  active: z.boolean(),
});
export type IngredientInput = z.infer<typeof ingredientInputSchema>;

/** Create or update an ingredient. The unit can't change once stock or recipes use it. */
export async function saveIngredient(actor: Actor, id: string | null, input: IngredientInput) {
  const clash = await db().query.ingredients.findFirst({ where: eq(schema.ingredients.name, input.name), columns: { id: true } });
  if (clash && clash.id !== id) return { ok: false as const, message: "There's already an ingredient with that name." };
  const values = { ...input, costPerUnitCents: input.costPerUnitCents === null ? null : Math.round(input.costPerUnitCents * 1e6) / 1e6 };
  if (id) {
    const before = await db().query.ingredients.findFirst({ where: eq(schema.ingredients.id, id) });
    if (!before) return { ok: false as const, message: "Ingredient not found." };
    if (before.unit !== input.unit) {
      const [used] = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.stockMovements)
        .where(eq(schema.stockMovements.ingredientId, id));
      const inRecipes = await db().query.recipeItems.findFirst({ where: eq(schema.recipeItems.ingredientId, id), columns: { id: true } });
      if (used.n > 0 || inRecipes) return { ok: false as const, message: "The unit can't change once the ingredient has stock or is in a recipe. Create a new ingredient instead." };
    }
    await db().update(schema.ingredients).set(values).where(eq(schema.ingredients.id, id));
    await audit(actor, "ingredient.updated", "ingredient", id, {
      name: input.name,
      ...(before.costPerUnitCents !== values.costPerUnitCents ? { cost: { from: before.costPerUnitCents, to: values.costPerUnitCents } } : {}),
    });
    return { ok: true as const, id };
  }
  const [row] = await db().insert(schema.ingredients).values(values).returning({ id: schema.ingredients.id });
  await audit(actor, "ingredient.created", "ingredient", row.id, { name: input.name, unit: input.unit });
  return { ok: true as const, id: row.id };
}

/* ------------------------------------------------------------------ */
/* Stock movements                                                     */
/* ------------------------------------------------------------------ */

export const movementInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("receipt"),
    quantity: z.number({ error: "Enter how much arrived." }).finite().positive("Enter how much arrived.").max(100_000_000),
    /** What the delivery cost in total; updates the ingredient's cost per unit. */
    totalCostCents: z.number().int().min(0).max(100_000_000).nullable(),
    note: optText(500),
  }),
  z.object({
    type: z.literal("stocktake"),
    counted: z.number({ error: "Enter the amount you counted." }).finite().min(0, "Enter the amount you counted.").max(100_000_000),
    note: z.string().trim().min(1, "Say why the count changed (e.g. weekly stocktake).").max(500),
  }),
  z.object({
    type: z.literal("waste"),
    quantity: z.number({ error: "Enter how much was thrown away." }).finite().positive("Enter how much was thrown away.").max(100_000_000),
    note: z.string().trim().min(1, "Say what happened (e.g. expired, dropped).").max(500),
  }),
]);
export type MovementInput = z.infer<typeof movementInputSchema>;

/** Record a delivery, a stocktake count or waste. Audited. */
export async function recordMovement(actor: Actor, ingredientId: string, input: MovementInput) {
  const res = await db().transaction(async (tx) => {
    // Lock the ingredient so a stocktake's difference is computed against a stable total.
    const [ingredient] = await tx.select().from(schema.ingredients).where(eq(schema.ingredients.id, ingredientId)).for("update");
    if (!ingredient) return { ok: false as const, message: "Ingredient not found." };
    const [{ total }] = await tx
      .select({ total: onHand })
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.ingredientId, ingredientId));
    const current = round3(total);
    let quantity: number;
    let kind: "receipt" | "adjustment" | "waste";
    let unitCostCents = ingredient.costPerUnitCents;
    if (input.type === "receipt") {
      kind = "receipt";
      quantity = round3(input.quantity);
      if (input.totalCostCents !== null) {
        unitCostCents = Math.round((input.totalCostCents / quantity) * 1e6) / 1e6;
        await tx.update(schema.ingredients).set({ costPerUnitCents: unitCostCents }).where(eq(schema.ingredients.id, ingredientId));
      }
    } else if (input.type === "stocktake") {
      kind = "adjustment";
      quantity = round3(input.counted - current);
      if (quantity === 0) return { ok: true as const, changed: false, onHand: current };
    } else {
      kind = "waste";
      quantity = -round3(input.quantity);
    }
    await tx.insert(schema.stockMovements).values({ ingredientId, kind, quantity, unitCostCents, note: input.note, createdBy: actor.id });
    return { ok: true as const, changed: true, kind, quantity, onHand: round3(current + quantity), name: ingredient.name, previousCost: ingredient.costPerUnitCents, unitCostCents };
  });
  if (res.ok && res.changed) {
    await audit(actor, `stock.${res.kind}`, "ingredient", ingredientId, {
      name: res.name,
      quantity: res.quantity,
      onHand: res.onHand,
      note: input.note ?? undefined,
      ...(res.kind === "receipt" && res.previousCost !== res.unitCostCents ? { cost: { from: res.previousCost, to: res.unitCostCents } } : {}),
    });
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Recipes and costing                                                 */
/* ------------------------------------------------------------------ */

export const recipeInputSchema = z.object({
  yieldQuantity: z.number({ error: "How many does one batch make?" }).finite().positive("How many does one batch make?").max(100_000),
  notes: optText(4000),
  items: z
    .array(z.object({ ingredientId: z.uuid(), quantity: z.number({ error: "Enter a quantity for every ingredient." }).finite().positive("Quantities must be more than zero.").max(10_000_000) }))
    .max(60)
    .refine((items) => new Set(items.map((i) => i.ingredientId)).size === items.length, "Each ingredient can appear only once."),
});
export type RecipeInput = z.infer<typeof recipeInputSchema>;

export async function getRecipe(productId: string) {
  return db().query.recipes.findFirst({
    where: eq(schema.recipes.productId, productId),
    with: { items: { orderBy: (i) => [asc(i.sortOrder)], with: { ingredient: true } } },
  });
}

/** Replace a product's recipe. An empty ingredient list removes it. */
export async function saveRecipe(actor: Actor, productId: string, input: RecipeInput) {
  const product = await db().query.products.findFirst({ where: eq(schema.products.id, productId), columns: { id: true, name: true } });
  if (!product) return { ok: false as const, message: "Product not found." };
  if (input.items.length) {
    const found = await db().query.ingredients.findMany({ where: inArray(schema.ingredients.id, input.items.map((i) => i.ingredientId)), columns: { id: true } });
    if (found.length !== input.items.length) return { ok: false as const, message: "One of the ingredients no longer exists." };
  }
  await db().transaction(async (tx) => {
    if (!input.items.length) {
      await tx.delete(schema.recipes).where(eq(schema.recipes.productId, productId));
      return;
    }
    const [recipe] = await tx
      .insert(schema.recipes)
      .values({ productId, yieldQuantity: input.yieldQuantity, notes: input.notes })
      .onConflictDoUpdate({ target: schema.recipes.productId, set: { yieldQuantity: input.yieldQuantity, notes: input.notes, updatedAt: new Date() } })
      .returning({ id: schema.recipes.id });
    await tx.delete(schema.recipeItems).where(eq(schema.recipeItems.recipeId, recipe.id));
    await tx.insert(schema.recipeItems).values(input.items.map((i, n) => ({ recipeId: recipe.id, ingredientId: i.ingredientId, quantity: round3(i.quantity), sortOrder: n })));
  });
  await audit(actor, input.items.length ? "recipe.saved" : "recipe.removed", "product", productId, { yield: input.yieldQuantity, ingredients: input.items.length });
  return { ok: true as const };
}

async function recipesFor(tx: DbOrTx, productIds: string[]) {
  if (!productIds.length) return new Map<string, RecipeForMath & { costs: Map<string, number | null> }>();
  const rows = await tx.query.recipes.findMany({
    where: inArray(schema.recipes.productId, productIds),
    with: { items: { with: { ingredient: { columns: { costPerUnitCents: true } } } } },
  });
  return new Map(
    rows.map((r) => [
      r.productId,
      {
        yieldQuantity: r.yieldQuantity,
        items: r.items.map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity })),
        costs: new Map(r.items.map((i) => [i.ingredientId, i.ingredient.costPerUnitCents])),
      },
    ]),
  );
}

/** Ingredient cost per unit of each product (base recipe; options don't change it). Admin-only. */
export async function productCosts(productIds: string[]) {
  const recipes = await recipesFor(db(), productIds);
  return new Map([...recipes].map(([productId, r]) => [productId, recipeUnitCost(r, r.costs)]));
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

/**
 * Deduct ingredients for an order going into production, inside the status
 * change's transaction. Idempotent: the unique (order, ingredient, kind) index
 * means a repeat (e.g. resuming from hold) adds nothing. Orders made from a
 * custom quote are skipped — their lines are free text, so staff record
 * their usage as waste/stocktake instead.
 */
export async function consumeStockForOrder(tx: Tx, orderId: string) {
  const order = await tx.query.orders.findFirst({ where: eq(schema.orders.id, orderId), columns: { sourceQuoteId: true }, with: { items: { columns: { productId: true, quantity: true } } } });
  if (!order || order.sourceQuoteId) return { used: 0, uncounted: [] as string[] };
  const productIds = [...new Set(order.items.map((i) => i.productId).filter((x): x is string => !!x))];
  const recipes = await recipesFor(tx, productIds);
  const { needs, uncounted } = ingredientNeeds(order.items, recipes);
  if (!needs.size) return { used: 0, uncounted };
  const costs = await tx.query.ingredients.findMany({ where: inArray(schema.ingredients.id, [...needs.keys()]), columns: { id: true, costPerUnitCents: true } });
  const costOf = new Map(costs.map((c) => [c.id, c.costPerUnitCents]));
  const inserted = await tx
    .insert(schema.stockMovements)
    .values([...needs].map(([ingredientId, qty]) => ({ ingredientId, kind: "usage" as const, quantity: -qty, unitCostCents: costOf.get(ingredientId) ?? null, orderId })))
    .onConflictDoNothing()
    .returning({ id: schema.stockMovements.id });
  return { used: inserted.length, uncounted };
}

/** Put back what an order used, when it's cancelled after going into production. Idempotent. */
export async function reverseStockForOrder(tx: Tx, orderId: string) {
  const used = await tx.query.stockMovements.findMany({ where: and(eq(schema.stockMovements.orderId, orderId), eq(schema.stockMovements.kind, "usage")) });
  if (!used.length) return 0;
  const inserted = await tx
    .insert(schema.stockMovements)
    .values(used.map((u) => ({ ingredientId: u.ingredientId, kind: "reversal" as const, quantity: -u.quantity, unitCostCents: u.unitCostCents, orderId, note: "Order cancelled" })))
    .onConflictDoNothing()
    .returning({ id: schema.stockMovements.id });
  return inserted.length;
}

/** Stock movements for one order, for the order page. */
export async function stockForOrder(orderId: string) {
  return db().query.stockMovements.findMany({
    where: eq(schema.stockMovements.orderId, orderId),
    with: { ingredient: { columns: { id: true, name: true, unit: true } } },
    orderBy: [asc(schema.stockMovements.createdAt)],
  });
}
