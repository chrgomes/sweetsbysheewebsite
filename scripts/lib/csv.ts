import { readFileSync, writeFileSync } from "node:fs";

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join(" | ") : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function writeCsv(file: string, headers: string[], rows: Record<string, unknown>[]) {
  writeFileSync(file, [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n") + "\n");
}

/** RFC 4180 CSV parser (quoted fields, embedded commas/newlines). */
export function readCsv(file: string): Record<string, string>[] {
  const text = readFileSync(file, "utf8");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...body] = rows.filter((r) => r.some((c) => c !== ""));
  return (body ?? []).map((r) => Object.fromEntries((headers ?? []).map((h, i) => [h, r[i] ?? ""])));
}
