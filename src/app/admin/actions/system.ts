"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AdminFormState } from "@/components/admin/admin-form";
import { audit } from "@/lib/audit";
import { actorFor, requireAdmin } from "@/lib/auth/session";
import { runJobs } from "@/lib/jobs";
import { retryNotification } from "@/lib/notifications";

export async function retryNotificationAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin("orders:manage");
  const id = z.uuid().safeParse(form.get("notificationId"));
  if (!id.success) return { message: "Invalid request." };
  await retryNotification(id.data);
  await audit(actorFor(admin), "notification.retried", "notification", id.data);
  const back = String(form.get("back") ?? "");
  if (back.startsWith("/admin")) revalidatePath(back);
  revalidatePath("/admin/system");
  return { ok: true, message: "Retry queued." };
}

export async function runJobsAction(): Promise<AdminFormState> {
  const admin = await requireAdmin("system:view");
  const results = await runJobs();
  const failed = Object.entries(results)
    .filter(([, r]) => typeof r === "object" && r !== null && "error" in r)
    .map(([k]) => k);
  await audit(actorFor(admin), "jobs.run_manually", "system", null, { failed });
  revalidatePath("/admin/system");
  return failed.length ? { message: `Some jobs failed: ${failed.join(", ")}. Check the server logs.` } : { ok: true, message: "Background jobs ran successfully." };
}
