import { env } from "@/lib/env";
import { hmac, safeEqual } from "@/lib/tokens";

/**
 * Lightweight bot protection for public forms, with no third-party script:
 *  - a hidden "website" honeypot field that people never fill in;
 *  - a signed render timestamp, rejecting submissions faster than a human.
 */
export const HONEYPOT_FIELD = "website";
export const FORM_TOKEN_FIELD = "formToken";
const MIN_SECONDS = 3;
const MAX_AGE_SECONDS = 60 * 60 * 6;

export function issueFormToken(now = Date.now()): string {
  const ts = String(now);
  return `${ts}.${hmac(env().APP_SECRET, `form:${ts}`).slice(0, 32)}`;
}

export function checkSpam(form: { honeypot?: string | null; token?: string | null }, now = Date.now()): string | null {
  if (form.honeypot) return "honeypot";
  const [ts, sig] = (form.token ?? "").split(".");
  if (!ts || !sig || !safeEqual(sig, hmac(env().APP_SECRET, `form:${ts}`).slice(0, 32))) return "bad_token";
  const age = (now - Number(ts)) / 1000;
  if (age < MIN_SECONDS) return "too_fast";
  if (age > MAX_AGE_SECONDS) return "expired";
  return null;
}
