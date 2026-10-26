import { BRAND_ASSETS } from "@/lib/brand";
import { siteUrl } from "@/lib/env";

/**
 * Branded email layout. Every template describes its content as blocks;
 * this renders both an HTML and a plain-text version. All values are escaped
 * here, so customer-entered text can never inject markup into an email.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type Block =
  | { type: "p"; text: string }
  | { type: "rows"; rows: [string, string][] }
  | { type: "lines"; lines: { label: string; detail?: string; amount: string }[]; totals?: [string, string][] }
  | { type: "button"; label: string; url: string }
  | { type: "note"; text: string };

export type EmailContent = { subject: string; preheader?: string; heading: string; blocks: Block[]; businessName: string; footer?: string };
export type RenderedEmail = { subject: string; text: string; html: string };

const C = { bg: "#fcefe9", card: "#fffaf7", ink: "#4a2414", soft: "#6b4535", line: "#f0dcd3", accent: "#9a4d49" };

/** Paragraph text: escape, then keep the author's line breaks. */
const para = (t: string) => escapeHtml(t).replace(/\n/g, "<br>");

export function renderEmail(c: EmailContent): RenderedEmail {
  const text: string[] = [c.heading, ""];
  const html: string[] = [];
  for (const b of c.blocks) {
    switch (b.type) {
      case "p":
        text.push(b.text, "");
        html.push(`<p style="margin:0 0 16px;line-height:1.6;color:${C.soft}">${para(b.text)}</p>`);
        break;
      case "note":
        text.push(b.text, "");
        html.push(`<p style="margin:0 0 16px;padding:12px 14px;border-radius:10px;background:${C.bg};font-size:14px;line-height:1.55;color:${C.ink}">${para(b.text)}</p>`);
        break;
      case "rows":
        for (const [k, v] of b.rows) text.push(`${k}: ${v}`);
        text.push("");
        html.push(
          `<table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 16px;font-size:14px">${b.rows
            .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:${C.soft};vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px 0;color:${C.ink}">${para(v)}</td></tr>`)
            .join("")}</table>`,
        );
        break;
      case "lines":
        for (const l of b.lines) text.push(`  ${l.label}${l.detail ? ` (${l.detail})` : ""} — ${l.amount}`);
        for (const [k, v] of b.totals ?? []) text.push(`  ${k}: ${v}`);
        text.push("");
        html.push(
          `<table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 16px;font-size:14px">${b.lines
            .map(
              (l) =>
                `<tr><td style="padding:8px 0;border-bottom:1px solid ${C.line};color:${C.ink}">${escapeHtml(l.label)}${l.detail ? `<br><span style="color:${C.soft};font-size:13px">${escapeHtml(l.detail)}</span>` : ""}</td><td align="right" style="padding:8px 0;border-bottom:1px solid ${C.line};color:${C.ink};white-space:nowrap">${escapeHtml(l.amount)}</td></tr>`,
            )
            .join("")}${(b.totals ?? [])
            .map(([k, v], i, arr) => {
              const last = i === arr.length - 1;
              return `<tr><td style="padding:6px 0;color:${last ? C.ink : C.soft};${last ? "font-weight:600" : ""}">${escapeHtml(k)}</td><td align="right" style="padding:6px 0;color:${C.ink};${last ? "font-weight:600" : ""}">${escapeHtml(v)}</td></tr>`;
            })
            .join("")}</table>`,
        );
        break;
      case "button":
        text.push(`${b.label}: ${b.url}`, "");
        html.push(
          `<p style="margin:8px 0 24px"><a href="${escapeHtml(b.url)}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">${escapeHtml(b.label)}</a></p>`,
        );
        break;
    }
  }
  const footer = c.footer ?? c.businessName;
  text.push("—", footer);
  const logo = siteUrl(BRAND_ASSETS.emailLogo);
  const htmlDoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(c.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif">
${c.preheader ? `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(c.preheader)}</div>` : ""}
<table role="presentation" width="100%" style="background:${C.bg};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:${C.card};border-radius:18px;padding:32px 28px">
<tr><td align="center" style="padding-bottom:12px"><img src="${escapeHtml(logo)}" width="96" height="96" alt="${escapeHtml(c.businessName)}" style="display:block;border:0"></td></tr>
<tr><td><h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:26px;line-height:1.25;color:${C.ink}">${escapeHtml(c.heading)}</h1>
${html.join("\n")}
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${C.line};font-size:13px;color:${C.soft}">${para(footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: c.subject, text: text.join("\n"), html: htmlDoc };
}
