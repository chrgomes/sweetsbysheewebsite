import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { fromPrice, type ProductCardData } from "@/lib/catalog";
import { Price } from "./price";
import { ProductImage } from "./product-image";

export function orderRouteLabel(p: { directPurchase: boolean; customOrder: boolean; status: string; basePriceCents: number | null }) {
  if (p.status === "unavailable") return { label: "Currently unavailable", tone: "neutral" as const };
  const online = p.directPurchase && p.basePriceCents !== null;
  if (online && p.customOrder) return { label: "Order online or customise", tone: "berry" as const };
  if (online) return { label: "Order online", tone: "berry" as const };
  if (p.customOrder) return { label: "Custom order", tone: "honey" as const };
  return null;
}

/** Products published on or after `newSince` (ms) get a "New" badge — derived from data, never hand-set. */
export function ProductCard({ product, priority = false, newSince }: { product: ProductCardData; priority?: boolean; newSince?: number }) {
  const img = product.images[0];
  const isNew = newSince !== undefined && !!product.publishedAt && product.publishedAt.getTime() >= newSince;
  const route = orderRouteLabel(product);
  const price = fromPrice(product);
  return (
    <article className="group relative flex flex-col">
      <ProductImage src={img?.src} alt={img?.alt ?? ""} name={product.name} priority={priority} className="transition-shadow duration-300 group-hover:shadow-[var(--shadow-lift)]" />
      <div className="mt-4 flex flex-1 flex-col gap-1.5">
        {product.category && <p className="text-xs uppercase tracking-[0.16em] text-ink-muted">{product.category.name}</p>}
        <h3 className="text-xl leading-snug text-ink">
          <Link href={`/products/${product.slug}`} className="after:absolute after:inset-0 hover:text-berry">
            {product.name}
          </Link>
        </h3>
        {product.summary && <p className="line-clamp-2 text-sm text-ink-soft">{product.summary}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-2">
          <Price cents={price?.cents ?? null} from={price?.isFrom} currency={product.currency} className="font-medium text-ink" />
          {isNew && <Badge tone="sage">New</Badge>}
          {route && <Badge tone={route.tone}>{route.label}</Badge>}
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products, newSince }: { products: ProductCardData[]; newSince?: number }) {
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard product={p} priority={i < 3} newSince={newSince} />
        </li>
      ))}
    </ul>
  );
}
