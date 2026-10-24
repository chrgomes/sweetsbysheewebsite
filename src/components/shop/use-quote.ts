"use client";

import { useEffect, useState } from "react";
import { quoteAction, type QuoteResponse } from "@/app/actions/cart";
import type { StoredLine } from "./cart-store";

/** Fetch the server's authoritative pricing for the current cart. */
export function useQuote(lines: StoredLine[]) {
  const key = JSON.stringify(lines);
  const [result, setResult] = useState<{ key: string; quote: QuoteResponse | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    quoteAction(JSON.parse(key))
      .then((quote) => !cancelled && setResult({ key, quote }))
      .catch(() => !cancelled && setResult({ key, quote: null }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Keep showing the previous quote while a new one loads, to avoid flicker.
  return { quote: result?.quote ?? null, loading: result?.key !== key };
}
