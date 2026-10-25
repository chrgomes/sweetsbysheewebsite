import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { BRAND_ASSETS, BRAND_NAME } from "@/lib/brand";
import { getAdmin } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function LoginPage() {
  if (await getAdmin()) redirect("/admin");
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] bg-paper p-8 shadow-[var(--shadow-soft)]">
        <Image src={BRAND_ASSETS.logo} alt={`${BRAND_NAME} logo`} width={112} height={112} priority className="mx-auto size-28" />
        <h1 className="mt-4 text-center font-sans text-sm text-ink-muted">Admin sign in</h1>
        <div className="mt-8">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
