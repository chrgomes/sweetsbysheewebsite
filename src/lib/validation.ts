import { z } from "zod";

/** Trim; turn empty strings into undefined so optional fields stay optional. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Please keep this under ${max} characters.`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const requiredText = (max: number, message = "This field is required.") =>
  z.string({ error: message }).trim().min(1, message).max(max, `Please keep this under ${max} characters.`);

export const nameSchema = requiredText(120, "Please enter your name.");

export const emailSchema = z
  .string({ error: "Please enter your email address." })
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email("Please enter a valid email address."));

export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || /^[+()\d\s.-]{7,}$/.test(v), "Please enter a valid phone number.");

export const addressSchema = z.object({
  line1: requiredText(200, "Please enter a street address."),
  line2: optionalText(200),
  city: requiredText(100, "Please enter a city."),
  region: requiredText(100, "Please enter a state."),
  postalCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9 -]{3,10}$/, "Please enter a valid ZIP / postal code."),
});

/** Flatten zod issues into { "field.path": "first message" } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    out[key] ??= issue.message;
  }
  return out;
}
