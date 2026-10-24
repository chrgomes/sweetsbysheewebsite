import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export default function NotFound() {
  return (
    <Container size="narrow" className="py-24 text-center">
      <p className="font-display text-7xl text-berry/40 italic">404</p>
      <h1 className="mt-4 text-4xl text-ink">We couldn&apos;t find that page</h1>
      <p className="mt-4 text-lg text-ink-soft">It may have moved, or the link might be out of date.</p>
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <ButtonLink href="/shop">Browse the menu</ButtonLink>
        <ButtonLink href="/" variant="secondary">Go home</ButtonLink>
      </div>
    </Container>
  );
}
