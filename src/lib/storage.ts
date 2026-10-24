import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { randomToken } from "@/lib/tokens";

/**
 * File storage with two areas:
 *  - "private": customer uploads (inspiration photos). Only served through an
 *    authenticated admin route.
 *  - "media": owner-uploaded site images, served publicly via /media/<key>.
 *
 * This is local-disk storage. For serverless hosting, swap these four
 * functions for an object store (S3, R2, GCS); callers only use keys.
 */
export type Area = "private" | "media";

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,200}$/i;

function root(area: Area) {
  return path.resolve(env().STORAGE_DIR, area);
}

function resolveKey(area: Area, key: string) {
  if (!KEY_PATTERN.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  return path.join(root(area), key);
}

export async function putFile(area: Area, ext: string, data: Uint8Array): Promise<string> {
  const key = `${Date.now().toString(36)}-${randomToken(12)}.${ext}`;
  await mkdir(root(area), { recursive: true });
  await writeFile(resolveKey(area, key), data, { flag: "wx" });
  return key;
}

export async function getFile(area: Area, key: string): Promise<Buffer | null> {
  try {
    return await readFile(resolveKey(area, key));
  } catch {
    return null;
  }
}

export async function deleteFile(area: Area, key: string): Promise<void> {
  await rm(resolveKey(area, key), { force: true });
}
