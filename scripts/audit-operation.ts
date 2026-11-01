import { randomUUID } from "node:crypto";
import { database } from "../apps/web/src/server/database";
import { recordAudit } from "../apps/web/src/server/audit";
const allowed = [
  "operation.deploy",
  "operation.backup",
  "operation.restore",
  "operation.configuration",
  "operation.migrate",
] as const;
const action = allowed.find((a) => a === process.argv[2]);
const outcome = process.argv[3];
if (!action || (outcome !== "success" && outcome !== "error"))
  throw new Error(
    "Usage: npm run audit:operation -- operation.deploy|operation.backup|operation.restore|operation.configuration|operation.migrate success|error",
  );
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
const pool = database(url);
try {
  await recordAudit(
    pool,
    { requestId: randomUUID(), action, actorId: "operator" },
    outcome,
    outcome === "success" ? "OK" : "UNAVAILABLE",
  );
  console.log(
    "Operator event recorded; this command does not perform the operation.",
  );
} finally {
  await pool.end();
}
