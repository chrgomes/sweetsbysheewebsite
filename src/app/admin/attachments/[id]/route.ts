import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAdmin } from "@/lib/auth/session";
import { getFile } from "@/lib/storage";

/** Customer inspiration images: only signed-in admins can view them. */
export async function GET(_req: Request, ctx: RouteContext<"/admin/attachments/[id]">) {
  const admin = await getAdmin();
  if (!admin) return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const att = await db().query.inquiryAttachments.findFirst({ where: eq(schema.inquiryAttachments.id, id) });
  if (!att) return new Response("Not found", { status: 404 });
  const file = await getFile("private", att.storageKey);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": att.mimeType,
      "Content-Disposition": `inline; filename="${att.originalName.replace(/["\\]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}
