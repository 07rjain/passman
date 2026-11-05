import { Pool, type PoolClient } from "pg";
export const migration = `
CREATE SCHEMA IF NOT EXISTS keyman_mvp;
CREATE TABLE IF NOT EXISTS keyman_mvp.migrations(version integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS keyman_mvp.accounts(id uuid PRIMARY KEY,clerk_id text NOT NULL UNIQUE,vault_id uuid NOT NULL UNIQUE,public_key jsonb NOT NULL,key_id text NOT NULL);
CREATE TABLE IF NOT EXISTS keyman_mvp.projects(id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES keyman_mvp.accounts(id),name text NOT NULL,UNIQUE(account_id,name),UNIQUE(id,account_id));
CREATE TABLE IF NOT EXISTS keyman_mvp.secrets(account_id uuid NOT NULL,project_id uuid NOT NULL,name text NOT NULL,revision integer NOT NULL CHECK(revision>0),envelope jsonb NOT NULL,PRIMARY KEY(project_id,name),FOREIGN KEY(project_id,account_id) REFERENCES keyman_mvp.projects(id,account_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS keyman_mvp.credentials(id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES keyman_mvp.accounts(id),hash text NOT NULL UNIQUE,label text NOT NULL,kind text NOT NULL CHECK(kind IN('read','upload')),project_id uuid,expires_at bigint NOT NULL,revoked boolean NOT NULL DEFAULT false,FOREIGN KEY(project_id,account_id) REFERENCES keyman_mvp.projects(id,account_id));
CREATE TABLE IF NOT EXISTS keyman_mvp.devices(id uuid PRIMARY KEY,public_key jsonb NOT NULL,key_id text NOT NULL,device_hash text NOT NULL UNIQUE,code_hash text NOT NULL,expires_at bigint NOT NULL,account_id uuid REFERENCES keyman_mvp.accounts(id),approved boolean NOT NULL DEFAULT false,consumed boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS keyman_mvp.limits(subject text NOT NULL,bucket bigint NOT NULL,count integer NOT NULL,PRIMARY KEY(subject,bucket));
INSERT INTO keyman_mvp.migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
`;
export const auditMigration = `
CREATE TABLE IF NOT EXISTS keyman_mvp.audit_events(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_id uuid NOT NULL UNIQUE, request_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 account_id uuid, actor_id text, credential_id uuid, resource_id uuid,
 action text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('success','denied','error')),
 reason text NOT NULL, dedupe_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS audit_account_sequence ON keyman_mvp.audit_events(account_id,sequence DESC);
CREATE INDEX IF NOT EXISTS audit_actor_sequence ON keyman_mvp.audit_events(actor_id,sequence DESC);
CREATE INDEX IF NOT EXISTS audit_retention ON keyman_mvp.audit_events(occurred_at);
INSERT INTO keyman_mvp.migrations(version) VALUES(2) ON CONFLICT DO NOTHING;
`;
export function database(url: string) {
  return new Pool({
    connectionString: url,
    max: 3,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    idleTimeoutMillis: 10000,
  });
}
export async function transaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate(pool: Pool) {
  await transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(74125902)");
    await client.query(migration);
    await client.query(auditMigration);
  });
}

/** Apply with the migration owner; explicitly remove obsolete broad grants. */
export async function grantRuntime(pool: Pool, role: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role))
    throw new Error("Invalid runtime role name");
  const quoted = '"' + role + '"';
  await transaction(pool, async (client) => {
    await client.query(`
      REVOKE ALL ON ALL TABLES IN SCHEMA keyman_mvp FROM ${quoted};
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA keyman_mvp FROM ${quoted};
      GRANT USAGE ON SCHEMA keyman_mvp TO ${quoted};
      GRANT SELECT ON keyman_mvp.accounts,keyman_mvp.projects,keyman_mvp.secrets,keyman_mvp.credentials,keyman_mvp.devices,keyman_mvp.limits,keyman_mvp.audit_events,keyman_mvp.migrations TO ${quoted};
      GRANT INSERT ON keyman_mvp.accounts,keyman_mvp.projects,keyman_mvp.secrets,keyman_mvp.credentials,keyman_mvp.devices,keyman_mvp.limits,keyman_mvp.audit_events TO ${quoted};
      GRANT UPDATE(revision,envelope) ON keyman_mvp.secrets TO ${quoted};
      GRANT UPDATE(revoked) ON keyman_mvp.credentials TO ${quoted};
      GRANT UPDATE(approved,account_id,consumed) ON keyman_mvp.devices TO ${quoted};
      GRANT UPDATE(count) ON keyman_mvp.limits TO ${quoted};
      GRANT DELETE ON keyman_mvp.secrets,keyman_mvp.devices,keyman_mvp.limits TO ${quoted};
      GRANT USAGE ON SEQUENCE keyman_mvp.audit_events_sequence_seq TO ${quoted};
    `);
    const unsafe = await client.query<{ unsafe: boolean }>(
      `SELECT has_schema_privilege($1,'keyman_mvp','CREATE')
        OR has_any_column_privilege($1,'keyman_mvp.accounts','UPDATE')
        OR has_table_privilege($1,'keyman_mvp.accounts','DELETE,TRUNCATE')
        OR has_table_privilege($1,'keyman_mvp.migrations','INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_table_privilege($1,'keyman_mvp.audit_events','UPDATE,DELETE,TRUNCATE') AS unsafe`,
      [role],
    );
    if (unsafe.rows[0]?.unsafe !== false)
      throw new Error(
        "Runtime inherits unsafe privileges; remove owner/privileged role memberships first",
      );
  });
}
