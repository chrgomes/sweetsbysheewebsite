"use client";

import { BRAND_NAME } from "@/lib/brand";

/** Replaces the root layout when it fails, so it carries its own document and minimal styles. */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fbf6f1", color: "#2b1d16" }}>
        <title>{`Something went wrong — ${BRAND_NAME}`}</title>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "96px 16px", textAlign: "center" }}>
          <h1 style={{ fontSize: 32, fontWeight: 400 }}>Something went wrong</h1>
          <p style={{ fontSize: 18, lineHeight: 1.5 }}>Sorry — {BRAND_NAME} couldn&apos;t load this page. Please try again in a moment.</p>
          <button onClick={() => retry()} style={{ marginTop: 24, minHeight: 48, padding: "0 24px", borderRadius: 999, border: 0, background: "#8a2d4a", color: "#fff", fontSize: 16, cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
