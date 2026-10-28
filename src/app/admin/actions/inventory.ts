"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { AdminFormState } from "@/components/admin/admin-form";
import { db, schema } from "@/db";
import { actorFor, requireAdmin } from "@/lib/auth/session";
import { ingredientInputSchema, movementInputSchema, recipeInputSchema, recordMovement, saveIngredient, saveRecipe, saveSupplier, supplierInputSchema } from "@/lib/inventory";
import { parseMoneyInput } from "@/lib/money";
import { can } from "@/lib/permissions";
import { centsPerBaseUnit } from "@/lib/recipe-math";
import { fieldErrors } from "@/lib/validation";

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v || null;
};
/** Blank → null, otherwise a number (NaN fails validation). */
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === null ? null : Number(v.replace(/,/g, ""));
};

export async function saveSupplierAction(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("inventory:manage");
  const id = str(f, "id");
  if (id && !z.uuid().safeParse(id).success) return { message: "Invalid request." };
  const parsed = supplierInputSchema.safeParse({
    name: str(f, "name") ?? "",
    contactName: str(f, "contactName"),
    email: str(f, "email"),
    phone: str(f, "phone"),
    website: str(f, "website"),
    notes: str(f, "notes"),
    active: f.get("active") === "on",
  });
  if (!parsed.success) return { message: Object.values(fieldErrors(parsed.error))[0] ?? "Please check the details.", errors: fieldErrors(parsed.error) };
  const res = await saveSupplier(actorFor(admin), id, parsed.data);
  if (!res.ok) return { message: res.message };
  revalidatePath("/admin/suppliers");
  return { ok: true, message: id ? "Supplier saved." : `Added ${parsed.data.name}.` };
}

export async function saveIngredientAction(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("inventory:manage");
  const id = str(f, "id");
  if (id && !z.uuid().safeParse(id).success) return { message: "Invalid request." };
  const unit = String(f.get("unit") ?? "");
  // Only roles that can see costs can change them; others keep the stored cost.
  let costPerUnitCents: number | null | undefined;
  if (can(admin.role, "costs:view")) {
    const raw = str(f, "cost");
    const cents = raw === null ? null : parseMoneyInput(raw);
    if (raw !== null && cents === null) return { message: "Enter the cost like 2.50.", errors: { cost: "Enter an amount like 2.50." } };
    costPerUnitCents = cents === null ? null : centsPerBaseUnit(cents, unit);
  } else if (id) {
    costPerUnitCents = (await db().query.ingredients.findFirst({ where: eq(schema.ingredients.id, id), columns: { costPerUnitCents: true } }))?.costPerUnitCents ?? null;
  } else {
    costPerUnitCents = null;
  }
  const supplierId = str(f, "supplierId");
  const parsed = ingredientInputSchema.safeParse({
    name: str(f, "name") ?? "",
    unit,
    supplierId,
    costPerUnitCents,
    reorderLevel: num(f, "reorderLevel"),
    notes: str(f, "notes"),
    active: id ? f.get("active") === "on" : true,
  });
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    return { message: Object.values(errors)[0] ?? "Please check the details.", errors };
  }
  const res = await saveIngredient(actorFor(admin), id, parsed.data);
  if (!res.ok) return { message: res.message };
  revalidatePath("/admin/inventory");
  if (!id) redirect(`/admin/inventory/${res.id}?created=1`);
  revalidatePath(`/admin/inventory/${id}`);
  return { ok: true, message: "Ingredient saved." };
}

export async function recordMovementAction(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("inventory:manage");
  const id = z.uuid().safeParse(f.get("ingredientId"));
  if (!id.success) return { message: "Invalid request." };
  const type = String(f.get("type") ?? "");
  let totalCostCents: number | null = null;
  if (type === "receipt" && can(admin.role, "costs:view")) {
    const raw = str(f, "totalCost");
    totalCostCents = raw === null ? null : parseMoneyInput(raw);
    if (raw !== null && totalCostCents === null) return { message: "Enter the delivery cost like 12.50.", errors: { totalCost: "Enter an amount like 12.50." } };
  }
  const parsed = movementInputSchema.safeParse({
    type,
    quantity: num(f, "quantity") ?? NaN,
    counted: num(f, "counted") ?? NaN,
    totalCostCents,
    note: type === "receipt" ? str(f, "note") : (str(f, "note") ?? ""),
  });
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    return { message: Object.values(errors)[0] ?? "Please check the amounts.", errors };
  }
  const res = await recordMovement(actorFor(admin), id.data, parsed.data);
  if (!res.ok) return { message: res.message };
  revalidatePath(`/admin/inventory/${id.data}`);
  revalidatePath("/admin/inventory");
  if (!res.changed) return { ok: true, message: "The count matches what's recorded; nothing changed." };
  return { ok: true, message: type === "receipt" ? "Delivery recorded." : type === "waste" ? "Waste recorded." : "Stock count updated." };
}

export async function saveRecipeAction(_p: AdminFormState, f: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("products:edit");
  const productId = z.uuid().safeParse(f.get("productId"));
  if (!productId.success) return { message: "Invalid request." };
  const ingredientIds = f.getAll("ingredientId").map(String);
  const quantities = f.getAll("quantity").map(String);
  const items = ingredientIds
    .map((ingredientId, i) => ({ ingredientId, quantity: Number((quantities[i] ?? "").replace(/,/g, "")) }))
    .filter((it) => it.ingredientId);
  const parsed = recipeInputSchema.safeParse({ yieldQuantity: num(f, "yieldQuantity") ?? NaN, notes: str(f, "notes"), items });
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Please check the recipe." };
  const res = await saveRecipe(actorFor(admin), productId.data, parsed.data);
  if (!res.ok) return { message: res.message };
  revalidatePath(`/admin/products/${productId.data}`);
  return { ok: true, message: items.length ? "Recipe saved." : "Recipe removed." };
}
