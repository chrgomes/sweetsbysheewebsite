import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { __sweetsDb?: Db; __sweetsSql?: postgres.Sql };

function create(): Db {
  const client = postgres(env().DATABASE_URL, { max: env().DATABASE_POOL_MAX, prepare: false });
  globalForDb.__sweetsSql = client;
  return drizzle(client, { schema });
}

/** Lazily-created shared database handle (reused across hot reloads in development). */
export function db(): Db {
  globalForDb.__sweetsDb ??= create();
  return globalForDb.__sweetsDb;
}

export async function closeDb() {
  await globalForDb.__sweetsSql?.end({ timeout: 5 });
  globalForDb.__sweetsDb = undefined;
  globalForDb.__sweetsSql = undefined;
}

export { schema };

/** A transaction handle, for services that must run inside the caller's transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the shared handle or a transaction. */
export type DbOrTx = Db | Tx;
