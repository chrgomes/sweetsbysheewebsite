import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRedirects } from "@/lib/seo/redirects";

describe("redirects", () => {
  it("loads valid rules and skips bad ones", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "redir-")), "r.json");
    writeFileSync(
      file,
      JSON.stringify([
        { source: "/shop-1", destination: "/shop" },
        { source: "/same", destination: "/same" },
        { source: "no-slash", destination: "/x" },
        { source: "/temp", destination: "/y", permanent: false },
      ]),
    );
    expect(loadRedirects(file)).toEqual([
      { source: "/shop-1", destination: "/shop", permanent: true },
      { source: "/temp", destination: "/y", permanent: false },
    ]);
    expect(loadRedirects(path.join(tmpdir(), "missing.json"))).toEqual([]);
  });
});
