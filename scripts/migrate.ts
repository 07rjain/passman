import { database, migrate } from "../apps/web/src/server/database.js";
const url = process.env.MIGRATION_DATABASE_URL;
if (!url)
  throw new Error(
    "Set MIGRATION_DATABASE_URL to the separate MVP database owner connection",
  );
const pool = database(url);
try {
  await migrate(pool);
  console.log(
    "Keyman MVP schema is ready. Existing application tables were not changed.",
  );
} finally {
  await pool.end();
}
