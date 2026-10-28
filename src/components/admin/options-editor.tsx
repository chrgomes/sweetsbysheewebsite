"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { centsToInput, parseMoneyInput } from "@/lib/money";

type Value = { id?: string; label: string; price: string; available: boolean; scale: string };
type Option = { id?: string; name: string; kind: "choice" | "text"; required: boolean; maxLength: string; surcharge: string; helpText: string; values: Value[] };

export type EditorOption = {
  id: string;
  name: string;
  kind: "choice" | "text";
  required: boolean;
  maxLength: number | null;
  priceDeltaCents: number;
  helpText: string | null;
  values: { id: string; label: string; priceDeltaCents: number; available: boolean; recipeScale: number }[];
};

/** Edits product options and serialises them into a hidden "options" field for the Server Action. */
export function OptionsEditor({ initial }: { initial: EditorOption[] }) {
  const [options, setOptions] = useState<Option[]>(() =>
    initial.map((o) => ({ id: o.id, name: o.name, kind: o.kind, required: o.required, maxLength: o.maxLength?.toString() ?? "", surcharge: o.priceDeltaCents ? centsToInput(o.priceDeltaCents) : "", helpText: o.helpText ?? "", values: o.values.map((v) => ({ id: v.id, label: v.label, price: centsToInput(v.priceDeltaCents), available: v.available, scale: String(v.recipeScale) })) })),
  );
  const update = (i: number, patch: Partial<Option>) => setOptions((os) => os.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  const updateValue = (i: number, j: number, patch: Partial<Value>) => update(i, { values: options[i].values.map((v, k) => (k === j ? { ...v, ...patch } : v)) });
  const serialised = JSON.stringify(
    options.map((o) => ({
      ...(o.id ? { id: o.id } : {}),
      name: o.name,
      kind: o.kind,
      required: o.required,
      maxLength: o.kind === "text" ? Number(o.maxLength) || null : null,
      priceDeltaCents: o.kind === "text" ? (parseMoneyInput(o.surcharge || "0") ?? 0) : 0,
      helpText: o.helpText.trim() || null,
      values: (o.kind === "text" ? [] : o.values).map((v) => {
        const neg = v.price.trim().startsWith("-");
        const cents = parseMoneyInput(v.price.replace("-", "") || "0") ?? 0;
        const scale = Number(v.scale.trim() || "1");
        return { ...(v.id ? { id: v.id } : {}), label: v.label, priceDeltaCents: neg ? -cents : cents, available: v.available, recipeScale: scale };
      }),
    })),
  );
  const field = "rounded-lg border border-line-strong bg-white px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <input type="hidden" name="options" value={serialised} />
      {options.length === 0 && <p className="text-sm text-ink-muted">No options. Add sizes, flavours or add-ons below.</p>}
      {options.map((o, i) => (
        <fieldset key={o.id ?? `new-${i}`} className="rounded-xl border border-line p-4">
          <legend className="sr-only">Option {i + 1}</legend>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">
              <span className="sr-only">Option name</span>
              <input className={field} placeholder="e.g. Size" value={o.name} onChange={(e) => update(i, { name: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="sr-only">Option type</span>
              <select className={field} value={o.kind} onChange={(e) => update(i, { kind: e.target.value as Option["kind"] })}>
                <option value="choice">Choices</option>
                <option value="text">Personalised text</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={o.required} onChange={(e) => update(i, { required: e.target.checked })} className="size-4" /> {o.kind === "text" ? "Required" : "Customer must choose"}
            </label>
            <button type="button" className="ml-auto text-sm text-danger hover:underline" onClick={() => setOptions((os) => os.filter((_, k) => k !== i))}>Remove option</button>
          </div>
          <label className="mt-3 block text-sm">
            <span className="text-xs text-ink-muted">Help text shown to customers</span>
            <input className={`${field} mt-1 w-full`} maxLength={200} value={o.helpText} placeholder={o.kind === "text" ? "e.g. Shown in piped lettering on top" : ""} onChange={(e) => update(i, { helpText: e.target.value })} />
          </label>
          {o.kind === "text" ? (
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <label>
                <span className="block text-xs text-ink-muted">Character limit</span>
                <input className={`${field} w-28`} inputMode="numeric" value={o.maxLength} placeholder="e.g. 30" onChange={(e) => update(i, { maxLength: e.target.value })} />
              </label>
              <label>
                <span className="block text-xs text-ink-muted">Extra charge ($)</span>
                <input className={`${field} w-28`} inputMode="decimal" value={o.surcharge} placeholder="0.00" onChange={(e) => update(i, { surcharge: e.target.value })} />
              </label>
            </div>
          ) : (
          <>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-ink-muted"><tr><th className="py-1 font-medium">Choice</th><th className="py-1 font-medium">Price change ($)</th><th className="py-1 font-medium">Recipe ×</th><th className="py-1 font-medium">Available</th><th /></tr></thead>
            <tbody>
              {o.values.map((v, j) => (
                <tr key={v.id ?? `nv-${j}`}>
                  <td className="py-1 pr-2"><input aria-label="Choice label" className={`${field} w-full`} value={v.label} onChange={(e) => updateValue(i, j, { label: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input aria-label="Price change" className={`${field} w-28`} inputMode="decimal" placeholder="0.00" value={v.price} onChange={(e) => updateValue(i, j, { price: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input aria-label="Recipe multiplier" className={`${field} w-20`} inputMode="decimal" placeholder="1" value={v.scale} onChange={(e) => updateValue(i, j, { scale: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input aria-label="Available" type="checkbox" className="size-4" checked={v.available} onChange={(e) => updateValue(i, j, { available: e.target.checked })} /></td>
                  <td className="py-1 text-right"><button type="button" className="text-danger hover:underline" onClick={() => update(i, { values: o.values.filter((_, k) => k !== j) })} aria-label={`Remove ${v.label || "choice"}`}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="mt-2 text-sm text-berry hover:underline" onClick={() => update(i, { values: [...o.values, { label: "", price: "", available: true, scale: "1" }] })}>+ Add choice</button>
          </>
          )}
        </fieldset>
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={() => setOptions((os) => [...os, { name: "", kind: "choice", required: true, maxLength: "", surcharge: "", helpText: "", values: [{ label: "", price: "", available: true, scale: "1" }] }])}>
        + Add option
      </Button>
      <p className="text-xs text-ink-muted">Price changes are added to the base price. Use a minus sign for a discount. Recipe × scales the product’s recipe for that choice (e.g. 2 if a 10&quot; cake uses twice the base recipe). Personalised text is checked against its character limit on the server.</p>
    </div>
  );
}
