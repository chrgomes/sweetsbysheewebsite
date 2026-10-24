"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";

export type AdminFormState = { ok?: boolean; message?: string; errors?: Record<string, string> };
type Action = (prev: AdminFormState, form: FormData) => Promise<AdminFormState>;

/**
 * Wraps an admin Server Action form with pending, success and error states.
 * Submits through a transition rather than the form `action` prop so React
 * doesn't reset the fields: edits stay visible after saving or on errors.
 * Pass `resetOnSuccess` for "add new" forms.
 */
export function AdminForm({
  action,
  children,
  submitLabel = "Save",
  className,
  encType,
  variant = "primary",
  resetOnSuccess = false,
}: {
  action: Action;
  children: ReactNode | ((state: AdminFormState) => ReactNode);
  submitLabel?: string;
  className?: string;
  encType?: "multipart/form-data";
  variant?: "primary" | "secondary" | "danger";
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form ref={ref} onSubmit={onSubmit} className={className ?? "space-y-5"} encType={encType}>
      {state.message && <FormAlert tone={state.ok ? "success" : "error"}>{state.message}</FormAlert>}
      {typeof children === "function" ? children(state) : children}
      <Button type="submit" variant={variant} disabled={pending} size="sm">
        {pending ? "Working…" : submitLabel}
      </Button>
    </form>
  );
}
