import { afterAll } from "vitest";

afterAll(async () => {
  const { closeDb } = await import("@/db");
  await closeDb();
});
