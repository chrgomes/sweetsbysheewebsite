# Sweets by Shyee

Website for the Sweets by Shyee bakery (domain: sweetsbyshyee.com): a premium storefront with online ordering, a custom-order
request workflow, and an admin area for the owner.

> **Status:** application complete and tested; **real content not yet migrated** because the source
> site (sweetsbyshyee.com) could not be reached from the build environment. The site currently runs
> on clearly labelled demo data. See [docs/website-audit.md](docs/website-audit.md) and
> [docs/content-migration.md](docs/content-migration.md) for the one-command migration once access is available.

## Quick start (local)

Requirements: Node 22+, pnpm 10, PostgreSQL 16 (or Docker).

```bash
pnpm install
cp .env.example .env.local          # PAYMENTS_PROVIDER=fake gives a test checkout page
pnpm db:start                       # or point DATABASE_URL at your own Postgres
pnpm db:migrate
pnpm db:seed:demo                   # optional sample catalogue
ADMIN_EMAIL=you@example.com ADMIN_NAME="You" pnpm admin:create
pnpm dev                            # http://localhost:3000 — admin at /admin
```

## Checks

```bash
pnpm lint && pnpm typecheck
pnpm test        # unit + integration (uses the sweets_test database)
pnpm test:e2e    # Playwright, desktop + mobile (uses sweets_e2e; builds the app)
pnpm build
```

## Documentation

| Doc | What's in it |
| --- | --- |
| [docs/website-audit.md](docs/website-audit.md) | Audit of the source site, coverage, and what remains to verify |
| [docs/redesign-plan.md](docs/redesign-plan.md) | Design direction, sitemap, page structure, UX decisions |
| [docs/architecture.md](docs/architecture.md) | Stack, data model, order and inquiry flows, security |
| [docs/content-migration.md](docs/content-migration.md) | Crawl → assets → normalise → import → redirects |
| [docs/deployment.md](docs/deployment.md) | Environments, hosting, Stripe, email, launch checklist |
| [CLAUDE.md](CLAUDE.md) | Working conventions for contributors and coding agents |

Screenshots of the current build (demo data) are in [`screenshots/`](screenshots/).
