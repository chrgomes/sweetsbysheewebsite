import { formatMoney } from "@/lib/money";

export function Price({ cents, currency = "usd", from = false, className }: { cents: number | null; currency?: string; from?: boolean; className?: string }) {
  if (cents === null) return <span className={className}>Price on request</span>;
  return (
    <span className={className}>
      {from && <span className="text-ink-muted">From </span>}
      {formatMoney(cents, currency)}
    </span>
  );
}
