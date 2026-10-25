import Image from "next/image";
import { cn } from "@/components/ui/cn";
import { BRAND_ASSETS } from "@/lib/brand";

/**
 * Product/gallery photo in a fixed aspect frame. When there's no photo yet
 * (e.g. assets still awaiting migration) it shows a quiet monogram tile
 * rather than a stock image or a broken icon.
 */
export function ProductImage({
  src,
  alt,
  name,
  sizes = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
  priority = false,
  aspect = "aspect-[4/5]",
  className,
}: {
  src?: string | null;
  alt: string;
  name: string;
  sizes?: string;
  priority?: boolean;
  aspect?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-[var(--radius-card)] bg-blush/50", aspect, className)}>
      {src ? (
        <Image src={src} alt={alt} fill sizes={sizes} priority={priority} quality={85} className="object-cover" />
      ) : (
        <div role="img" aria-label={`Photo of ${name} coming soon`} className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_30%_20%,var(--paper),transparent_60%)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny decorative static asset */}
          <img src={BRAND_ASSETS.mark} alt="" aria-hidden="true" className="w-[38%] max-w-40 opacity-40" />
          <span className="absolute bottom-4 text-xs tracking-wide text-ink-muted" aria-hidden="true">
            Photo coming soon
          </span>
        </div>
      )}
    </div>
  );
}
