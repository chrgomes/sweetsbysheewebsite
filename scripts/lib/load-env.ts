/**
 * Load .env.local (then .env) for CLI scripts, the way `next dev` does for the
 * app, so a DATABASE_URL set there works for db:migrate, admin:create and the
 * rest. Variables already set in the shell win; missing files are fine.
 * Import this first, before anything that reads process.env.
 */
import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
