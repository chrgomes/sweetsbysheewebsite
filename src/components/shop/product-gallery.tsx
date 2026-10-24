"use client";

import { useState } from "react";
import { cn } from "@/components/ui/cn";
import { ProductImage } from "./product-image";

export function ProductGallery({ name, images }: { name: string; images: { id: string; src: string; alt: string }[] }) {
  const [active, setActive] = useState(0);
  const current = images[active];
  return (
    <div>
      <ProductImage src={current?.src} alt={current?.alt ?? ""} name={name} priority sizes="(min-width: 1024px) 55vw, 100vw" />
      {images.length > 1 && (
        <ul className="mt-4 grid grid-cols-5 gap-3" aria-label="Product photos">
          {images.map((img, i) => (
            <li key={img.id}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Show photo ${i + 1} of ${images.length}${img.alt ? `: ${img.alt}` : ""}`}
                aria-pressed={i === active}
                className={cn("block w-full rounded-xl ring-offset-2 ring-offset-cream transition", i === active ? "ring-2 ring-ink" : "opacity-75 hover:opacity-100")}
              >
                <ProductImage src={img.src} alt="" name={name} aspect="aspect-square" sizes="120px" className="rounded-xl" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
