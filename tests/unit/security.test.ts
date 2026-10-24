import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblems, verifyPassword } from "@/lib/auth/password";
import { checkSpam, issueFormToken } from "@/lib/spam";
import { makeReference } from "@/lib/tokens";
import { sniffImage, validateImageUploads } from "@/lib/uploads";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

describe("upload validation", () => {
  it("detects images by content", () => {
    expect(sniffImage(PNG)?.mime).toBe("image/png");
    expect(sniffImage(JPEG)?.mime).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
  });
  it("rejects disguised, oversized and too many files", async () => {
    const fake = new File([new TextEncoder().encode("<?php echo 'hi'; ?> padding")], "cake.jpg", { type: "image/jpeg" });
    expect(await validateImageUploads([fake], { maxFiles: 3, maxBytes: 1000 })).toMatchObject({ ok: false });
    const big = new File([JPEG, new Uint8Array(2000)], "big.jpg");
    expect(await validateImageUploads([big], { maxFiles: 3, maxBytes: 1000 })).toMatchObject({ ok: false });
    const many = Array.from({ length: 4 }, (_, i) => new File([PNG], `${i}.png`));
    expect(await validateImageUploads(many, { maxFiles: 3, maxBytes: 1000 })).toMatchObject({ ok: false });
    expect(await validateImageUploads([new File([PNG], "ok.png")], { maxFiles: 3, maxBytes: 1000 })).toMatchObject({ ok: true });
  });
  it("ignores empty file inputs", async () => {
    expect(await validateImageUploads([new File([], "")], { maxFiles: 1, maxBytes: 10 })).toEqual({ ok: true, files: [] });
  });
});

describe("spam protection", () => {
  it("accepts a genuine, unhurried submission", () => {
    const token = issueFormToken(Date.now() - 10_000);
    expect(checkSpam({ token })).toBeNull();
  });
  it("rejects honeypot, forged, too-fast and stale tokens", () => {
    expect(checkSpam({ honeypot: "http://spam", token: issueFormToken(Date.now() - 10_000) })).toBe("honeypot");
    expect(checkSpam({ token: `${Date.now() - 10_000}.deadbeef` })).toBe("bad_token");
    expect(checkSpam({ token: issueFormToken() })).toBe("too_fast");
    expect(checkSpam({ token: issueFormToken(Date.now() - 7 * 3600_000) })).toBe("expired");
  });
});

describe("passwords and references", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(passwordProblems("short")).toMatch(/at least/);
  });
  it("generates readable unique references", () => {
    const refs = new Set(Array.from({ length: 500 }, () => makeReference("SBS")));
    expect(refs.size).toBe(500);
    for (const r of refs) expect(r).toMatch(/^SBS-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  });
});
