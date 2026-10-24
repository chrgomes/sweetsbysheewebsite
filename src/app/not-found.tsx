import Link from "next/link";

export default function RootNotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-4xl">Page not found</h1>
      <p className="mt-4 text-ink-soft">
        <Link href="/" className="text-berry underline">Return to the home page</Link>
      </p>
    </main>
  );
}
