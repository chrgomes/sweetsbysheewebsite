"use client";

import { useSyncExternalStore } from "react";

/**
 * The cart lives in localStorage and holds only identifiers and quantities.
 * Names and prices shown to the customer always come from the server quote.
 */
export type StoredLine = { productId: string; optionValueIds: string[]; quantity: number };

const KEY = "sbs-cart-v1";
const EMPTY: StoredLine[] = [];
const listeners = new Set<() => void>();
let snapshot: StoredLine[] | null = null;

function read(): StoredLine[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l): l is StoredLine => !!l && typeof l.productId === "string" && Array.isArray(l.optionValueIds) && Number.isInteger(l.quantity) && l.quantity > 0)
      .slice(0, 30);
  } catch {
    return [];
  }
}

function write(lines: StoredLine[]) {
  snapshot = lines;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // Storage unavailable (private mode, quota): keep the in-memory cart for this visit.
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      snapshot = read();
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot() {
  snapshot ??= read();
  return snapshot;
}

const sameOptions = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export const cart = {
  lines: () => getSnapshot(),
  add(line: StoredLine) {
    const lines = [...getSnapshot()];
    const i = lines.findIndex((l) => l.productId === line.productId && sameOptions(l.optionValueIds, line.optionValueIds));
    if (i >= 0) lines[i] = { ...lines[i], quantity: Math.min(lines[i].quantity + line.quantity, 50) };
    else lines.push({ ...line, optionValueIds: [...line.optionValueIds].sort() });
    write(lines);
  },
  setQuantity(index: number, quantity: number) {
    const lines = [...getSnapshot()];
    if (!lines[index]) return;
    if (quantity <= 0) lines.splice(index, 1);
    else lines[index] = { ...lines[index], quantity: Math.min(quantity, 50) };
    write(lines);
  },
  remove(index: number) {
    const lines = [...getSnapshot()];
    lines.splice(index, 1);
    write(lines);
  },
  clear() {
    write([]);
  },
};

export function useCart(): StoredLine[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

export function useCartCount(): number {
  return useCart().reduce((n, l) => n + l.quantity, 0);
}
