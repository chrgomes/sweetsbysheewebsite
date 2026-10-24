import { cn } from "@/components/ui/cn";
import { Prose } from "@/components/ui/prose";

/** Native <details> disclosure: keyboard and screen-reader friendly with no JavaScript. */
export function FaqList({ faqs, className }: { faqs: { id: string; question: string; answer: string }[]; className?: string }) {
  return (
    <div className={cn("divide-y divide-line border-y border-line", className)}>
      {faqs.map((f) => (
        <details key={f.id} className="group py-1">
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-4 text-left text-lg text-ink marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="font-display">{f.question}</span>
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong text-ink-soft transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <Prose text={f.answer} className="pb-6 pr-12" />
        </details>
      ))}
    </div>
  );
}
