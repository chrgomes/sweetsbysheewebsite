import Link from "next/link";
import { cn } from "@/components/ui/cn";

export function CategoryNav({ categories, active }: { categories: { slug: string; name: string }[]; active?: string }) {
  if (categories.length < 2) return null;
  const items = [{ slug: "", name: "All" }, ...categories];
  return (
    <nav aria-label="Categories" className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
        {items.map((c) => {
          const isActive = (active ?? "") === c.slug;
          return (
            <li key={c.slug || "all"}>
              <Link
                href={c.slug ? `/shop/${c.slug}` : "/shop"}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center rounded-full border px-4 text-sm whitespace-nowrap transition-colors",
                  isActive ? "border-ink bg-ink text-cream" : "border-line-strong bg-paper text-ink hover:border-ink",
                )}
              >
                {c.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
