import { database, grantRuntime } from "../apps/web/src/server/database.js";
const url = process.env.MIGRATION_DATABASE_URL;
const role = process.env.MVP_RUNTIME_ROLE;
if (!url || !role)
  throw new Error("Set MIGRATION_DATABASE_URL and MVP_RUNTIME_ROLE");
const pool = database(url);
try {
  await grantRuntime(pool, role);
  console.log("Runtime grants applied; existing data was preserved.");
} finally {
  await pool.end();
}
