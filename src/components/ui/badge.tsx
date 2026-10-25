import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "neutral" | "berry" | "sage" | "honey" | "danger";

const tones: Record<Tone, string> = {
  neutral: "bg-white/80 text-ink-soft ring-line",
  berry: "bg-blush text-berry-deep ring-berry/15",
  sage: "bg-sage-tint text-sage ring-sage/20",
  honey: "bg-honey-tint text-ink-soft ring-honey/30",
  danger: "bg-danger-tint text-danger ring-danger/20",
};

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>
      {children}
    </span>
  );
}
