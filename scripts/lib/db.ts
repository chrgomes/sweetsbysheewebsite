/** Database handle for CLI scripts (outside the Next.js runtime). */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema";

export const databaseUrl = process.env.DATABASE_URL ?? "postgres://sweets@127.0.0.1:54329/sweets";
const client = postgres(databaseUrl, { max: 2, onnotice: () => {} });
export const db = drizzle(client, { schema });
export { schema };
export const closeDb = () => client.end({ timeout: 5 });
export const redactedUrl = () => databaseUrl.replace(/\/\/[^@]*@/, "//***@");
