"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export default function SiteError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;
  return (
    <Container size="narrow" className="py-24 text-center">
      <h1 className="text-4xl text-ink">Something went wrong</h1>
      <p className="mt-4 text-lg text-ink-soft">Sorry — this page didn&apos;t load. Please try again in a moment.</p>
      {digest && <p className="mt-2 text-xs text-ink-muted">Reference: {digest}</p>}
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <Button onClick={() => retry()}>Try again</Button>
        <ButtonLink href="/" variant="secondary">Go home</ButtonLink>
      </div>
    </Container>
  );
}
