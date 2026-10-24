"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/admin/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormAlert, Input } from "@/components/ui/field";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-5">
      {state.message && <FormAlert>{state.message}</FormAlert>}
      <Field id="email" label="Email" required>
        <Input id="email" type="email" autoComplete="username" defaultValue={state.email} required />
      </Field>
      <Field id="password" label="Password" required>
        <Input id="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
