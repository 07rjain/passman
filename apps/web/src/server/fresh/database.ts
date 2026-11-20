import type { Pool } from "pg";
import { transaction } from "../database";

/** Separate, additive schema. Apply as migration owner, never from an API request. */
export const freshMigration = `
CREATE SCHEMA IF NOT EXISTS passman_v1;
CREATE TABLE IF NOT EXISTS passman_v1.migrations(version integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS passman_v1.native_logins(
 id uuid PRIMARY KEY,claim_hash text NOT NULL,fingerprint_hash text NOT NULL,expires_at bigint NOT NULL,
 human_id text,approved_at bigint,management_hash text);
CREATE TABLE IF NOT EXISTS passman_v1.native_management(
 id uuid PRIMARY KEY REFERENCES passman_v1.native_logins(id),hash text NOT NULL,human_id text NOT NULL,expires_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS passman_v1.vaults(
 account_id uuid PRIMARY KEY,human_id text NOT NULL UNIQUE,vault_id uuid NOT NULL UNIQUE,
 bundle jsonb NOT NULL,epoch integer NOT NULL CHECK(epoch>0),generation integer NOT NULL CHECK(generation>0));
CREATE TABLE IF NOT EXISTS passman_v1.projects(
 id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES passman_v1.vaults(account_id),
 name text COLLATE "C" NOT NULL CHECK(name ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account_id,name),UNIQUE(id,account_id));
CREATE TABLE IF NOT EXISTS passman_v1.credentials(
 id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES passman_v1.vaults(account_id),
 hash text NOT NULL UNIQUE,kind text NOT NULL CHECK(kind IN('read','admin')),scope jsonb NOT NULL,
 expires_at bigint,revoked boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS passman_v1.slots(
 account_id uuid NOT NULL,project_id uuid NOT NULL,name text COLLATE "C" NOT NULL CHECK(name ~ '^[A-Za-z_][A-Za-z0-9_.-]{0,127}$'),
 secret_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 state text NOT NULL CHECK(state IN('pending','active','deleted')),record jsonb NOT NULL,
 PRIMARY KEY(project_id,name),FOREIGN KEY(project_id,account_id) REFERENCES passman_v1.projects(id,account_id));
CREATE INDEX IF NOT EXISTS fresh_slots_account_name ON passman_v1.slots(account_id,project_id,name);
CREATE TABLE IF NOT EXISTS passman_v1.nonces(
 credential_id uuid NOT NULL REFERENCES passman_v1.credentials(id),nonce text NOT NULL,expires_at bigint NOT NULL,
 PRIMARY KEY(credential_id,nonce));
CREATE TABLE IF NOT EXISTS passman_v1.management_nonces(
 account_id uuid NOT NULL REFERENCES passman_v1.vaults(account_id),nonce text NOT NULL,expires_at bigint NOT NULL,PRIMARY KEY(account_id,nonce));
CREATE TABLE IF NOT EXISTS passman_v1.receipts(
 account_id uuid NOT NULL REFERENCES passman_v1.vaults(account_id),actor text NOT NULL,operation text NOT NULL,
 receipt_id uuid NOT NULL,body_hash text NOT NULL,response jsonb NOT NULL,
 PRIMARY KEY(account_id,actor,operation,receipt_id));
CREATE TABLE IF NOT EXISTS passman_v1.transfers(
 id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES passman_v1.vaults(account_id),epoch integer NOT NULL,
 claim_hash text NOT NULL,expires_at bigint NOT NULL,payload jsonb,
 state text NOT NULL CHECK(state IN('open','claimed','acknowledged','cancelled')),
 recipient_id uuid REFERENCES passman_v1.credentials(id),session_hash text);
CREATE TABLE IF NOT EXISTS passman_v1.writer_transitions(
 id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES passman_v1.vaults(account_id),
 expected_generation integer NOT NULL,bundle jsonb NOT NULL,state text NOT NULL CHECK(state IN('staging','committed','cancelled')));
CREATE UNIQUE INDEX IF NOT EXISTS fresh_writer_staging ON passman_v1.writer_transitions(account_id) WHERE state='staging';
CREATE TABLE IF NOT EXISTS passman_v1.writer_transition_records(
 transition_id uuid NOT NULL REFERENCES passman_v1.writer_transitions(id),project_id uuid NOT NULL,name text COLLATE "C" NOT NULL,
 expected_revision integer NOT NULL,record jsonb NOT NULL,PRIMARY KEY(transition_id,project_id,name));
CREATE TABLE IF NOT EXISTS passman_v1.installations(
 id uuid NOT NULL,account_id uuid NOT NULL REFERENCES passman_v1.vaults(account_id),
 label text NOT NULL,kind text NOT NULL CHECK(kind IN('desktop','server','container','function')),credential_id uuid REFERENCES passman_v1.credentials(id),
 first_seen timestamptz NOT NULL DEFAULT now(),last_seen timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,id));
ALTER TABLE passman_v1.installations ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES passman_v1.credentials(id);
CREATE TABLE IF NOT EXISTS passman_v1.limits(subject text NOT NULL,bucket bigint NOT NULL,count integer NOT NULL,PRIMARY KEY(subject,bucket));
CREATE TABLE IF NOT EXISTS passman_v1.audit_events(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,event_id uuid NOT NULL UNIQUE,request_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),account_id uuid,actor_id text,credential_id uuid,resource_id uuid,
 action text NOT NULL,outcome text NOT NULL CHECK(outcome IN('success','denied','error')),reason text NOT NULL,dedupe_key text UNIQUE);
CREATE INDEX IF NOT EXISTS fresh_audit_account ON passman_v1.audit_events(account_id,sequence DESC);
CREATE INDEX IF NOT EXISTS fresh_audit_retention ON passman_v1.audit_events(occurred_at);
CREATE OR REPLACE FUNCTION passman_v1.reject_unrevoke() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.revoked AND NOT NEW.revoked THEN RAISE EXCEPTION 'Revocation is permanent'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE TRIGGER immutable_revocation BEFORE UPDATE OF revoked ON passman_v1.credentials FOR EACH ROW EXECUTE FUNCTION passman_v1.reject_unrevoke();
INSERT INTO passman_v1.migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
`;
export async function migrateFresh(pool: Pool) {
  await transaction(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(74125903)");
    await c.query(freshMigration);
  });
}
export async function grantFreshRuntime(pool: Pool, role: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role))
    throw new Error("Invalid runtime role");
  const q = '"' + role + '"';
  await transaction(pool, async (c) => {
    await c.query(`
      REVOKE ALL ON ALL TABLES IN SCHEMA passman_v1 FROM ${q};
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA passman_v1 FROM ${q};
      GRANT USAGE ON SCHEMA passman_v1 TO ${q};
      GRANT SELECT ON ALL TABLES IN SCHEMA passman_v1 TO ${q};
      GRANT INSERT ON passman_v1.vaults,passman_v1.projects,passman_v1.credentials,passman_v1.slots,passman_v1.nonces,passman_v1.management_nonces,passman_v1.receipts,passman_v1.transfers,passman_v1.writer_transitions,passman_v1.writer_transition_records,passman_v1.installations,passman_v1.limits,passman_v1.audit_events TO ${q};
      GRANT UPDATE(bundle,epoch,generation) ON passman_v1.vaults TO ${q};
      GRANT UPDATE(revoked) ON passman_v1.credentials TO ${q};
      GRANT UPDATE(revision,state,record) ON passman_v1.slots TO ${q};
      GRANT UPDATE(state,recipient_id,session_hash,payload) ON passman_v1.transfers TO ${q};
      GRANT UPDATE(bundle,state) ON passman_v1.writer_transitions TO ${q};
      GRANT INSERT ON passman_v1.native_logins,passman_v1.native_management TO ${q};
      GRANT DELETE ON passman_v1.native_management TO ${q};
      GRANT UPDATE(human_id,approved_at,management_hash,expires_at) ON passman_v1.native_logins TO ${q};
      GRANT UPDATE(expected_revision,record) ON passman_v1.writer_transition_records TO ${q};
      GRANT DELETE ON passman_v1.writer_transition_records TO ${q};
      GRANT UPDATE(last_seen) ON passman_v1.installations TO ${q};
      GRANT UPDATE(count) ON passman_v1.limits TO ${q};
      GRANT DELETE ON passman_v1.nonces,passman_v1.management_nonces,passman_v1.limits TO ${q};
      GRANT USAGE ON SEQUENCE passman_v1.audit_events_sequence_seq TO ${q};
    `);
    const unsafe = await c.query<{ unsafe: boolean }>(
      `SELECT has_schema_privilege($1,'passman_v1','CREATE')
      OR has_column_privilege($1,'passman_v1.vaults','human_id','UPDATE')
      OR has_table_privilege($1,'passman_v1.vaults','DELETE,TRUNCATE')
      OR has_table_privilege($1,'passman_v1.migrations','INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_table_privilege($1,'passman_v1.audit_events','UPDATE,DELETE,TRUNCATE') AS unsafe`,
      [role],
    );
    if (unsafe.rows[0]?.unsafe !== false)
      throw new Error("Runtime inherits unsafe owner privileges");
  });
}

/** Maintenance owner only. Live relay expiry is not deletion of captured offline copies. */
export async function maintainFresh(pool: Pool) {
  return transaction(pool, async (c) => {
    const transfers = await c.query(
      "UPDATE passman_v1.transfers SET payload=NULL,state='cancelled' WHERE expires_at < $1 AND state IN('open','claimed')",
      [Date.now()],
    );
    await c.query("DELETE FROM passman_v1.nonces WHERE expires_at < $1", [
      Math.floor(Date.now() / 1000) - 60,
    ]);
    await c.query(
      "DELETE FROM passman_v1.management_nonces WHERE expires_at < $1",
      [Math.floor(Date.now() / 1000) - 60],
    );
    await c.query("DELETE FROM passman_v1.limits WHERE bucket < $1", [
      Math.floor(Date.now() / 60000) - 60,
    ]);
    await c.query(
      "DELETE FROM passman_v1.native_management WHERE expires_at<$1",
      [Date.now()],
    );
    await c.query(
      "DELETE FROM passman_v1.native_logins WHERE expires_at<$1 AND id NOT IN(SELECT id FROM passman_v1.native_management)",
      [Date.now()],
    );
    return { expiredTransfers: transfers.rowCount ?? 0 };
  });
}
