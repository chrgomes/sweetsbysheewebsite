// Run background jobs once, for hosts that schedule commands rather than HTTP
// calls, e.g. a crontab entry running `pnpm jobs:run` every 5 minutes.
// Uses the same code as POST /api/cron.
import { closeDb } from "../../src/db";
import { runJobs } from "../../src/lib/jobs";

const results = await runJobs();
const failed = Object.entries(results).filter(([, r]) => typeof r === "object" && r !== null && "error" in r);
await closeDb();
process.exit(failed.length ? 1 : 0);
