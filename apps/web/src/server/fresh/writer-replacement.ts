import {
  bundleSchema,
  bytes32,
  failure,
  id,
  inspectRuntimePackage,
  label,
  recordSchema,
  sameAnchor,
  secretName,
  verifyRecord,
  z,
  type VaultBundle,
} from "@passman/protocol";
import type { PoolClient } from "pg";

const batchSize = 4;
const position = z.object({ projectId: id, name: secretName }).strict();
const create = z
  .object({
    id,
    expectedGeneration: z.number().int().positive(),
    bundle: bundleSchema,
  })
  .strict();
const scan = z.object({ after: position.optional() }).strict();
const stage = z
  .object({
    records: z
      .array(
        z
          .object({
            record: recordSchema,
            expectedRevision: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(batchSize),
  })
  .strict();
const enrollment = z
  .object({ id, hash: bytes32, label, expiresAt: z.number().int().positive() })
  .strict();
const commit = z.object({ credential: enrollment }).strict();

type Transition = {
  expected_generation: number;
  bundle: VaultBundle;
  state: "staging" | "committed" | "cancelled";
};
type Vault = {
  account_id: string;
  vault_id: string;
  epoch: number;
  generation: number;
  bundle: VaultBundle;
};

async function validateReplacement(
  vault: Vault,
  expected: number,
  bundle: VaultBundle,
) {
  const prior = vault.bundle;
  if (expected !== vault.generation) return failure("CONFLICT");
  if (
    bundle.anchor.origin !== prior.anchor.origin ||
    bundle.anchor.accountId !== vault.account_id ||
    bundle.anchor.vaultId !== vault.vault_id ||
    bundle.anchor.writer.x === prior.anchor.writer.x ||
    bundle.epoch !== vault.epoch + 1 ||
    bundle.generation !== expected + 1 ||
    bundle.syncId === prior.syncId ||
    bundle.activeKey.id === prior.activeKey.id ||
    bundle.activeKey.version !== prior.activeKey.version + 1
  ) {
    return failure("CONTEXT_MISMATCH");
  }
  const keyring = await inspectRuntimePackage(bundle.keyring, bundle.anchor);
  if (
    keyring.epoch !== bundle.epoch ||
    keyring.generation !== bundle.generation ||
    keyring.syncId !== bundle.syncId ||
    keyring.activeKey.id !== bundle.activeKey.id ||
    keyring.activeKey.version !== bundle.activeKey.version ||
    keyring.activeKey.publicKey.x !== bundle.activeKey.publicKey.x
  )
    return failure("CONTEXT_MISMATCH");
  for (const purpose of ["bootstrap", "administration"] as const) {
    const wrapper = bundle[purpose];
    if (
      wrapper.purpose !== purpose ||
      !sameAnchor(wrapper.anchor, bundle.anchor) ||
      wrapper.epoch !== bundle.epoch ||
      wrapper.syncId !== bundle.syncId ||
      wrapper.revision !== prior[purpose].revision + 1
    ) {
      return failure("CONTEXT_MISMATCH");
    }
  }
}

/** Caller has locked the vault and verified a full old-root proof plus same-owner management authorization. */
export async function writerReplacementRoute(
  client: PoolClient,
  path: string,
  input: unknown,
  options: {
    vault: Vault;
    issueAdmin: (credential: z.infer<typeof enrollment>) => Promise<unknown>;
    auditRevocation: (credentialId: string) => Promise<void>;
  },
) {
  const { vault, issueAdmin, auditRevocation } = options;
  const account = vault.account_id;
  if (path === "/writer-replacement") {
    const replacement = create.parse(input);
    await validateReplacement(
      vault,
      replacement.expectedGeneration,
      replacement.bundle,
    );
    const inserted = await client.query(
      `INSERT INTO passman_v1.writer_transitions (id, account_id, expected_generation, bundle, state)
      VALUES ($1, $2, $3, $4, 'staging') ON CONFLICT DO NOTHING`,
      [
        replacement.id,
        account,
        replacement.expectedGeneration,
        replacement.bundle,
      ],
    );
    if (!inserted.rowCount) {
      const retry = await client.query(
        `SELECT 1 FROM passman_v1.writer_transitions WHERE id=$1 AND account_id=$2
        AND expected_generation=$3 AND bundle=$4::jsonb AND state='staging'`,
        [
          replacement.id,
          account,
          replacement.expectedGeneration,
          replacement.bundle,
        ],
      );
      if (!retry.rowCount) return failure("CONFLICT");
    }
    return { id: replacement.id };
  }

  const route =
    /^\/writer-replacement\/([0-9a-f-]{36})\/(scan|stage|commit|cancel)$/.exec(
      path,
    );
  if (!route) return failure("NOT_FOUND");
  const transitionId = id.parse(route[1]);
  const transition = (
    await client.query<Transition>(
      `SELECT expected_generation,bundle,state FROM passman_v1.writer_transitions
    WHERE id=$1 AND account_id=$2 FOR UPDATE`,
      [transitionId, account],
    )
  ).rows[0];
  if (!transition) return failure("NOT_FOUND");
  if (route[2] === "cancel") {
    z.object({}).strict().parse(input);
    if (transition.state === "committed") return failure("CONFLICT");
    await client.query(
      "DELETE FROM passman_v1.writer_transition_records WHERE transition_id=$1",
      [transitionId],
    );
    await client.query(
      "UPDATE passman_v1.writer_transitions SET state='cancelled',bundle='null'::jsonb WHERE id=$1",
      [transitionId],
    );
    return { cancelled: true as const };
  }
  if (
    transition.state !== "staging" ||
    transition.expected_generation !== vault.generation
  )
    return failure("CONFLICT");
  const bundle = bundleSchema.parse(transition.bundle);

  if (route[2] === "scan") {
    const { after } = scan.parse(input);
    const rows = (
      await client.query<{ project_id: string; name: string; record: unknown }>(
        `SELECT project_id,name,record FROM passman_v1.slots
      WHERE account_id=$1 AND ($2::uuid IS NULL OR (project_id,name COLLATE "C") > ($2::uuid,$3::text COLLATE "C"))
      ORDER BY project_id,name COLLATE "C" LIMIT $4`,
        [account, after?.projectId ?? null, after?.name ?? null, batchSize + 1],
      )
    ).rows;
    const records = rows
      .slice(0, batchSize)
      .map(({ record }) => recordSchema.parse(record));
    const last = rows[batchSize - 1];
    return {
      records,
      next:
        rows.length > batchSize && last
          ? { projectId: last.project_id, name: last.name }
          : null,
    };
  }

  if (route[2] === "stage") {
    const { records } = stage.parse(input);
    const slots = new Set<string>();
    for (const { record, expectedRevision } of records) {
      const ctx = record.context;
      const slot = `${ctx.projectId}/${ctx.name}`;
      if (slots.has(slot)) return failure("INVALID_REQUEST");
      slots.add(slot);
      const prior = (
        await client.query<{
          revision: number;
          secret_id: string;
          state: string;
          project: string;
        }>(
          `SELECT s.revision,s.secret_id,s.state,p.name AS project
        FROM passman_v1.slots s JOIN passman_v1.projects p ON p.id=s.project_id AND p.account_id=s.account_id
        WHERE s.account_id=$1 AND s.project_id=$2 AND s.name=$3`,
          [account, ctx.projectId, ctx.name],
        )
      ).rows[0];
      if (!prior || prior.revision !== expectedRevision)
        return failure("CONFLICT");
      if (prior.state === "pending")
        return failure("PENDING_VERIFICATION_REQUIRED");
      if (
        ctx.secretId !== prior.secret_id ||
        ctx.state !== prior.state ||
        ctx.epoch !== bundle.epoch ||
        ctx.revision !== expectedRevision + 1 ||
        ctx.keyId !== bundle.activeKey.id
      ) {
        return failure("CONTEXT_MISMATCH");
      }
      await verifyRecord(record, bundle.anchor, {
        project: prior.project,
        name: ctx.name,
      });
      await client.query(
        `INSERT INTO passman_v1.writer_transition_records (transition_id,project_id,name,expected_revision,record) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (transition_id,project_id,name) DO UPDATE SET expected_revision=EXCLUDED.expected_revision,record=EXCLUDED.record`,
        [transitionId, ctx.projectId, ctx.name, expectedRevision, record],
      );
    }
    return { staged: records.length };
  }

  const { credential } = commit.parse(input);
  const coverage = (
    await client.query<{ pending: boolean; mismatch: boolean }>(
      `SELECT
    EXISTS (SELECT 1 FROM passman_v1.slots WHERE account_id=$2 AND state='pending') AS pending,
    EXISTS (SELECT 1 FROM passman_v1.slots s LEFT JOIN passman_v1.writer_transition_records t
      ON t.transition_id=$1 AND t.project_id=s.project_id AND t.name=s.name WHERE s.account_id=$2
      AND (t.expected_revision IS DISTINCT FROM s.revision OR t.record->'context'->>'secretId' IS DISTINCT FROM s.secret_id::text
        OR t.record->'context'->>'state' IS DISTINCT FROM s.state)) AS mismatch`,
      [transitionId, account],
    )
  ).rows[0];
  if (coverage?.pending) return failure("PENDING_VERIFICATION_REQUIRED");
  if (!coverage || coverage.mismatch) return failure("CONFLICT");
  const staged = await client.query(
    `UPDATE passman_v1.slots s SET revision=s.revision+1,record=t.record
    FROM passman_v1.writer_transition_records t WHERE t.transition_id=$1 AND t.project_id=s.project_id AND t.name=s.name
    AND s.account_id=$2 AND s.revision=t.expected_revision`,
    [transitionId, account],
  );
  const total = (
    await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM passman_v1.writer_transition_records WHERE transition_id=$1",
      [transitionId],
    )
  ).rows[0];
  if (staged.rowCount !== total?.count) return failure("CONFLICT");
  const switched = await client.query(
    `UPDATE passman_v1.vaults SET bundle=$3,epoch=$4,generation=$5
    WHERE account_id=$1 AND generation=$2`,
    [
      account,
      transition.expected_generation,
      bundle,
      bundle.epoch,
      bundle.generation,
    ],
  );
  if (switched.rowCount !== 1) return failure("CONFLICT");
  await client.query(
    "UPDATE passman_v1.transfers SET state='cancelled',payload=NULL WHERE account_id=$1 AND state IN('open','claimed')",
    [account],
  );
  const revoked = await client.query<{ id: string }>(
    "UPDATE passman_v1.credentials SET revoked=true WHERE account_id=$1 AND NOT revoked RETURNING id",
    [account],
  );
  for (const old of revoked.rows) await auditRevocation(old.id);
  await issueAdmin(credential);
  await client.query(
    "DELETE FROM passman_v1.writer_transition_records WHERE transition_id=$1",
    [transitionId],
  );
  await client.query(
    "UPDATE passman_v1.writer_transitions SET state='committed',bundle='null'::jsonb WHERE id=$1",
    [transitionId],
  );
  return { id: credential.id, generation: bundle.generation };
}
