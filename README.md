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
pnpm admin:reset-password you@example.com   # forgot your admin password
pnpm dev                            # http://localhost:3000 — admin at /admin
```

The CLI scripts (`db:migrate`, `admin:create`, `jobs:run`, …) read `.env.local` like the app does; a value set
in the terminal takes precedence.

### PostgreSQL installed on Windows (no Docker)

`pnpm db:start` is a Linux/macOS helper; on Windows, install PostgreSQL itself instead.

1. Install PostgreSQL 16 or 17 with the Windows installer from postgresql.org. Keep port 5432 and note the
   password you choose for the `postgres` superuser.
2. Open **SQL Shell (psql)** from the Start menu, sign in as `postgres`, and create the app's user and
   databases (use letters and numbers in the password so it needs no escaping in a URL):
   ```sql
   CREATE ROLE sweets LOGIN PASSWORD 'choose-a-password';
   CREATE DATABASE sweets OWNER sweets;
   CREATE DATABASE sweets_test OWNER sweets;
   CREATE DATABASE sweets_e2e OWNER sweets;
   ```
3. In `.env.local`, set `DATABASE_URL=postgres://sweets:choose-a-password@127.0.0.1:5432/sweets`.
4. Skip `pnpm db:start`. Moving data from Docker? Do the restore below on the empty `sweets` database first.
   Otherwise run `pnpm db:migrate` and create an admin.
5. For the test suites, point them at the other two databases in PowerShell first:
   `$env:TEST_DATABASE_URL="postgres://sweets:choose-a-password@127.0.0.1:5432/sweets_test"` and
   `$env:E2E_DATABASE_URL="postgres://sweets:choose-a-password@127.0.0.1:5432/sweets_e2e"`.

To bring existing data across from a Docker database, back it up from the container and restore it with the
Windows install's `pg_restore` (in `C:\Program Files\PostgreSQL\<version>\bin`):

```powershell
docker exec <container> pg_dump -Fc -U sweets -d sweets -f /tmp/backup.dump
docker cp <container>:/tmp/backup.dump .\backup.dump
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" --no-owner --role=sweets -h 127.0.0.1 -p 5432 -U sweets -d sweets .\backup.dump
pnpm db:migrate
```

Copy the `storage/` folder too if it isn't already in the project folder (uploaded photos aren't in the database).

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
