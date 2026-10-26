"use client";

import { useEffect, useState } from "react";
import { quoteAction, type QuoteResponse } from "@/app/actions/cart";
import type { StoredLine } from "./cart-store";

/** Fetch the server's authoritative pricing for the current cart. */
export function useQuote(lines: StoredLine[], discountCode?: string | null) {
  const key = JSON.stringify([lines, discountCode ?? null]);
  const [result, setResult] = useState<{ key: string; quote: QuoteResponse | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const [l, code] = JSON.parse(key) as [StoredLine[], string | null];
    quoteAction(l, code)
      .then((quote) => !cancelled && setResult({ key, quote }))
      .catch(() => !cancelled && setResult({ key, quote: null }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Keep showing the previous quote while a new one loads, to avoid flicker.
  return { quote: result?.quote ?? null, loading: result?.key !== key };
}
