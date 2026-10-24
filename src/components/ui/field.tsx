import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const control =
  "block w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-[0.95rem] text-ink placeholder:text-ink-muted/80 transition-colors hover:border-ink-muted focus:border-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-tint/30";

export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required ? (
          <span className="text-berry" aria-hidden="true">
            {" "}
            *
          </span>
        ) : (
          <span className="font-normal text-ink-muted"> (optional)</span>
        )}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint?: boolean, error?: string) {
  return [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
}

type ControlExtras = { error?: string; hasHint?: boolean };

export function Input({ id, error, hasHint, className, ...props }: ComponentProps<"input"> & ControlExtras & { id: string }) {
  return <input id={id} name={props.name ?? id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hasHint, error)} className={cn(control, className)} {...props} />;
}

export function Textarea({ id, error, hasHint, className, ...props }: ComponentProps<"textarea"> & ControlExtras & { id: string }) {
  return (
    <textarea id={id} name={props.name ?? id} rows={4} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hasHint, error)} className={cn(control, "min-h-28", className)} {...props} />
  );
}

export function Select({ id, error, hasHint, className, children, ...props }: ComponentProps<"select"> & ControlExtras & { id: string }) {
  return (
    <select
      id={id}
      name={props.name ?? id}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, hasHint, error)}
      className={cn(control, "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22><path fill=%22none%22 stroke=%22%235f4c44%22 stroke-width=%221.5%22 d=%22M2 4.5l4 4 4-4%22/></svg>')] bg-[length:12px] bg-[right_1rem_center] bg-no-repeat pr-10", className)}
      {...props}
    >
      {children}
    </select>
  );
}

export function FormAlert({ tone = "error", children, id }: { tone?: "error" | "success" | "info"; children: ReactNode; id?: string }) {
  const styles = {
    error: "border-danger/30 bg-danger-tint text-danger",
    success: "border-sage/30 bg-sage-tint text-sage",
    info: "border-honey/30 bg-honey-tint text-[#6b4f27]",
  }[tone];
  return (
    <div id={id} role={tone === "error" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 text-sm", styles)}>
      {children}
    </div>
  );
}
