import type { ReactNode } from "react";
import { cn } from "./cn";

export function Container({ children, className, size = "default" }: { children: ReactNode; className?: string; size?: "default" | "narrow" | "wide" }) {
  const max = size === "narrow" ? "max-w-3xl" : size === "wide" ? "max-w-[88rem]" : "max-w-7xl";
  return <div className={cn("mx-auto w-full px-4 sm:px-6 lg:px-10", max, className)}>{children}</div>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs font-semibold uppercase tracking-[0.2em] text-berry", className)}>{children}</p>;
}

export function SectionHeading({
  eyebrow,
  title,
  intro,
  align = "left",
  as: Tag = "h2",
  id,
}: {
  eyebrow?: string;
  title: string;
  intro?: ReactNode;
  align?: "left" | "center";
  as?: "h1" | "h2";
  id?: string;
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center")}>
      {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
      <Tag id={id} className={cn("text-ink", Tag === "h1" ? "text-4xl sm:text-5xl lg:text-6xl" : "text-3xl sm:text-4xl", "font-normal leading-[1.08]")}>
        {title}
      </Tag>
      {intro && <div className="mt-4 text-lg leading-relaxed text-ink-soft">{intro}</div>}
    </div>
  );
}
