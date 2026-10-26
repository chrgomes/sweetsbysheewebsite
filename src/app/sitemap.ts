import type { MetadataRoute } from "next";
import { listActiveCollections, listPublicCategories, listPublicProducts } from "@/lib/catalog";
import { dateInZone } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { listPolicyPages } from "@/lib/content";
import { siteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const settings = await getSettings();
  const [products, categories, policies, collections] = await Promise.all([listPublicProducts(), listPublicCategories(), listPolicyPages(), listActiveCollections(dateInZone(new Date(), settings.timezone))]);
  const staticPaths = ["/", "/shop", "/custom-orders", "/gallery", "/about", "/faq", "/contact"];
  return [
    ...staticPaths.map((p) => ({ url: siteUrl(p), changeFrequency: "weekly" as const, priority: p === "/" ? 1 : 0.7 })),
    ...categories.map((c) => ({ url: siteUrl(`/shop/${c.slug}`), changeFrequency: "weekly" as const, priority: 0.6 })),
    ...collections.map((c) => ({ url: siteUrl(`/collections/${c.slug}`), lastModified: c.updatedAt, changeFrequency: "weekly" as const, priority: 0.6 })),
    ...products.map((p) => ({ url: siteUrl(`/products/${p.slug}`), lastModified: p.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 })),
    ...policies.map((p) => ({ url: siteUrl(`/policies/${p.slug}`), changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
