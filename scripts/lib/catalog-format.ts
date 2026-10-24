/** The reviewed import format in data/content/catalog.json. */
export type CatalogProduct = {
  slug: string;
  name: string;
  category: string | null;
  summary: string | null;
  description: string | null;
  basePriceCents: number | null;
  currency: string;
  status: "draft" | "active" | "unavailable" | "archived";
  directPurchase: boolean;
  customOrder: boolean;
  servings?: string | null;
  ingredients?: string | null;
  allergens?: string | null;
  leadTimeHours?: number | null;
  options: { name: string; required: boolean; values: { label: string; priceDeltaCents: number; available: boolean }[] }[];
  images: { src: string; alt: string; width: number | null; height: number | null; sourceUrl: string | null }[];
  sourceUrl: string | null;
  migrationStatus: "verified" | "needs_review" | "owner_created";
  migrationNotes: string | null;
};

export type Catalog = {
  generatedAt: string;
  source: string | null;
  categories: { slug: string; name: string; description: string | null; sourceUrl: string | null }[];
  products: CatalogProduct[];
  faqs: { question: string; answer: string; published: boolean; sourceUrl: string | null }[];
  pages: { slug: string; title: string; body: string; kind: "about" | "policy"; published: boolean; sourceUrl: string | null; seoTitle: string | null; seoDescription: string | null }[];
  gallery: { src: string; alt: string; caption: string | null; width: number | null; height: number | null; published: boolean; sourceUrl: string | null }[];
  settings: Partial<{ contactEmail: string; contactPhone: string; socialLinks: { label: string; url: string }[]; tagline: string; storyBody: string }>;
};

export function slugifyName(input: string): string {
  return (
    input
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item"
  );
}
