"use client";

import { useActionState, type ReactNode } from "react";
import type { SimpleState } from "@/app/actions/customer";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";

/** A small public form with pending and result states, for one-button actions. */
export function SimpleActionForm({
  action,
  hidden,
  submitLabel,
  pendingLabel,
  variant = "primary",
  children,
  className,
}: {
  action: (prev: SimpleState, form: FormData) => Promise<SimpleState>;
  hidden: Record<string, string>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
  children?: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<SimpleState, FormData>(action, {});
  if (state.ok && state.message) return <FormAlert tone="success">{state.message}</FormAlert>;
  return (
    <form action={formAction} className={className ?? "space-y-4"}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {state.message && <FormAlert>{state.message}</FormAlert>}
      {children}
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? (pendingLabel ?? "Working…") : submitLabel}
      </Button>
    </form>
  );
}
