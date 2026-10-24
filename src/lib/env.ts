import { z } from "zod";

/**
 * Server-side environment. Validated once on first use so a misconfigured
 * deployment fails loudly instead of misbehaving. Nothing here is exposed to
 * the browser; only NEXT_PUBLIC_* variables are, and we only use one.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: z.enum(["local", "test", "staging", "production"]).default("local"),
    NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
    DATABASE_URL: z.string().min(1).default("postgres://sweets@127.0.0.1:54329/sweets"),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    /** "stripe" for real payments, "fake" for local/e2e testing only, "none" to disable checkout. */
    PAYMENTS_PROVIDER: z.enum(["none", "stripe", "fake"]).default("none"),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_AUTOMATIC_TAX: z.stringbool().default(false),

    /** "resend" sends real email; "console" logs it; "memory" keeps it in-process (tests). */
    EMAIL_PROVIDER: z.enum(["console", "resend", "memory"]).default("console"),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default("Sweets by Shee <orders@example.com>"),
    BUSINESS_NOTIFICATION_EMAIL: z.string().optional(),

    /** Root directory for uploaded files. Must not be inside /public. */
    STORAGE_DIR: z.string().default("./storage"),
    MAX_UPLOAD_MB: z.coerce.number().positive().default(8),
    MAX_UPLOAD_FILES: z.coerce.number().int().positive().default(5),

    /** Secret used to hash IPs for rate limiting and to sign short-lived tokens. */
    APP_SECRET: z.string().min(16).default("dev-only-insecure-secret-change-me"),
    TRUST_PROXY_HEADERS: z.stringbool().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === "production" && v.APP_ENV === "production") {
      if (v.APP_SECRET.startsWith("dev-only")) {
        ctx.addIssue({ code: "custom", path: ["APP_SECRET"], message: "Set a real APP_SECRET in production" });
      }
      if (v.PAYMENTS_PROVIDER === "fake") {
        ctx.addIssue({ code: "custom", path: ["PAYMENTS_PROVIDER"], message: "The fake payment provider is not allowed in production" });
      }
      if (v.EMAIL_PROVIDER === "memory") {
        ctx.addIssue({ code: "custom", path: ["EMAIL_PROVIDER"], message: "The memory email provider is not allowed in production" });
      }
    }
    if (v.PAYMENTS_PROVIDER === "stripe" && (!v.STRIPE_SECRET_KEY || !v.STRIPE_WEBHOOK_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENTS_PROVIDER"],
        message: "PAYMENTS_PROVIDER=stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET",
      });
    }
    if (v.EMAIL_PROVIDER === "resend" && !v.RESEND_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "EMAIL_PROVIDER=resend requires RESEND_API_KEY" });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests that change process.env between cases. */
export function resetEnvCache() {
  cached = undefined;
}

export function siteUrl(path = "/"): string {
  return new URL(path, env().NEXT_PUBLIC_SITE_URL).toString();
}
