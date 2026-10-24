/**
 * Image upload validation by actual file content (magic bytes), not by the
 * filename or the browser-supplied MIME type.
 */
export type ImageKind = { mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/heic"; ext: string };

export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const b = bytes;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a)
    return { mime: "image/png", ext: "png" };
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return { mime: "image/gif", ext: "gif" };
  if (ascii(4, 8) === "ftyp" && ["heic", "heix", "mif1", "msf1", "heim", "heis"].includes(ascii(8, 12)))
    return { mime: "image/heic", ext: "heic" };
  return null;
}

export type UploadError = { file: string; message: string };

export type ValidatedUpload = { name: string; kind: ImageKind; bytes: Uint8Array };

export async function validateImageUploads(
  files: File[],
  limits: { maxFiles: number; maxBytes: number; allowHeic?: boolean },
): Promise<{ ok: true; files: ValidatedUpload[] } | { ok: false; errors: UploadError[] }> {
  const real = files.filter((f) => f && typeof f === "object" && f.size > 0);
  const errors: UploadError[] = [];
  if (real.length > limits.maxFiles) {
    return { ok: false, errors: [{ file: "", message: `You can attach up to ${limits.maxFiles} images.` }] };
  }
  const out: ValidatedUpload[] = [];
  for (const f of real) {
    const name = (f.name || "image").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    if (f.size > limits.maxBytes) {
      errors.push({ file: name, message: `${name} is larger than ${Math.round(limits.maxBytes / 1024 / 1024)} MB.` });
      continue;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind || (kind.mime === "image/heic" && !limits.allowHeic)) {
      errors.push({ file: name, message: `${name} isn't a supported image (JPEG, PNG, WebP, GIF${limits.allowHeic ? " or HEIC" : ""}).` });
      continue;
    }
    out.push({ name, kind, bytes });
  }
  return errors.length ? { ok: false, errors } : { ok: true, files: out };
}
