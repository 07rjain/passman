import { database } from "../apps/web/src/server/database";
import { pruneAudit } from "../apps/web/src/server/audit";
const url = process.env.MIGRATION_DATABASE_URL;
if (!url)
  throw new Error(
    "MIGRATION_DATABASE_URL is required; never grant DELETE to the runtime audit role",
  );
const pool = database(url);
try {
  const result = await pruneAudit(
    pool,
    Number(process.env.AUDIT_RETENTION_DAYS ?? 90),
  );
  console.log(
    JSON.stringify({
      event: "audit.retention_completed",
      deleted: result.rowCount,
    }),
  );
} finally {
  await pool.end();
}
