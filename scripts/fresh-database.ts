import { Pool } from "pg";
import {
  grantFreshRuntime,
  maintainFresh,
  migrateFresh,
} from "../apps/web/src/server/fresh/database";
import { pruneAudit } from "../apps/web/src/server/audit";

const connection = process.env.PASSMAN_MIGRATION_DATABASE_URL;
if (!connection)
  throw new Error(
    "Set PASSMAN_MIGRATION_DATABASE_URL for the explicit fresh schema operation",
  );
const pool = new Pool({ connectionString: connection, max: 1 });
try {
  switch (process.argv[2]) {
    case "migrate":
      await migrateFresh(pool);
      break;
    case "grants": {
      const role = process.env.PASSMAN_RUNTIME_ROLE;
      if (!role) throw new Error("Set PASSMAN_RUNTIME_ROLE");
      await grantFreshRuntime(pool, role);
      break;
    }
    case "maintain":
      await maintainFresh(pool);
      await pruneAudit(pool, 90, "passman_v1");
      break;
    default:
      throw new Error("Choose migrate, grants or maintain");
  }
  process.stdout.write("Fresh database operation completed.\n");
} finally {
  await pool.end();
}
