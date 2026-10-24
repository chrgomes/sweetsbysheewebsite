import "server-only";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

/** In-process outbox, used when EMAIL_PROVIDER=memory (tests and e2e). */
const globalOutbox = globalThis as unknown as { __sweetsOutbox?: EmailMessage[]; __sweetsFailNextEmail?: number };

export function memoryOutbox(): EmailMessage[] {
  globalOutbox.__sweetsOutbox ??= [];
  return globalOutbox.__sweetsOutbox;
}

/** Test hook: make the next `n` sends fail. */
export function failNextEmails(n: number) {
  globalOutbox.__sweetsFailNextEmail = n;
}

/**
 * Send an email. Never throws: email failures are reported to the caller and
 * logged so that a provider outage can't lose an order or inquiry.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const e = env();
  try {
    if ((globalOutbox.__sweetsFailNextEmail ?? 0) > 0) {
      globalOutbox.__sweetsFailNextEmail!--;
      throw new Error("Simulated email failure");
    }
    switch (e.EMAIL_PROVIDER) {
      case "memory":
        memoryOutbox().push(message);
        return { ok: true };
      case "console":
        log.info("email.console", { to: message.to, subject: message.subject, text: message.text });
        return { ok: true };
      case "resend": {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: e.EMAIL_FROM,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            reply_to: message.replyTo,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const body = (await res.json()) as { id?: string };
        return { ok: true, id: body.id };
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error("email.failed", { to: message.to, subject: message.subject, error });
    return { ok: false, error };
  }
}
