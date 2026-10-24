import { getFile } from "@/lib/storage";
import { sniffImage } from "@/lib/uploads";

/** Public, owner-uploaded site images. Content type comes from the file's bytes. */
export async function GET(_req: Request, ctx: RouteContext<"/media/[key]">) {
  const { key } = await ctx.params;
  const file = await getFile("media", key).catch(() => null);
  if (!file) return new Response("Not found", { status: 404 });
  const kind = sniffImage(file);
  if (!kind) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": kind.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
