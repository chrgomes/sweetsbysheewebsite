import { execSync } from "node:child_process";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://sweets@127.0.0.1:54329/sweets_test";
  execSync("pnpm -s db:migrate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}
