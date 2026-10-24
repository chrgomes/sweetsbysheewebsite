"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { cart } from "./cart-store";

/** Empty the cart once an order has been placed. */
export function ClearCart() {
  useEffect(() => cart.clear(), []);
  return null;
}

/** While payment confirmation is pending, re-check the order a few times. */
export function RefreshWhilePending({ attempts = 10, intervalMs = 3000 }: { attempts?: number; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      if (++n > attempts) clearInterval(id);
      else router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, attempts, intervalMs]);
  return null;
}
