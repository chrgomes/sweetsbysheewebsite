import { cn } from "./cn";

/**
 * Renders owner-entered plain text as paragraphs. Text is never interpreted as
 * HTML, so content from the CMS or migration can't inject markup or scripts.
 */
export function Prose({ text, className }: { text: string; className?: string }) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className={cn("prose-bakery", className)}>
      {paragraphs.map((p, i) => (
        <p key={i}>
          {p.split("\n").map((line, j, arr) => (
            <span key={j}>
              {line}
              {j < arr.length - 1 && <br />}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
