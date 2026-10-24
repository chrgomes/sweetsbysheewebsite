import type { MetadataRoute } from "next";
import { env, siteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (env().APP_ENV !== "production") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/cart", "/checkout", "/order", "/dev"] }],
    sitemap: siteUrl("/sitemap.xml"),
  };
}
