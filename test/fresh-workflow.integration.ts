import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { PoolClient } from "pg";
import {
  API_PATH,
  digest,
  failure,
  inspectRuntimePackage,
  openBox,
  parseCredential,
  randomSecret,
  recordSchema,
  runtimePackageContext,
  sealBox,
  sealValue,
  signRecord,
  z,
  type AdminMaterial,
  type RecordContext,
  type RuntimeMaterial,
} from "@passman/protocol";
import {
  AdminClient,
  ManagementClient,
  administrativeProof,
  changeVaultPassword,
} from "../packages/passman/src/admin.js";
import { RuntimeClient } from "../packages/passman/src/runtime.js";
import {
  createTransfer,
  receiveTransfer,
  type TransferSessions,
} from "../packages/passman/src/transfers.js";
import type {
  AdminCustody,
  RuntimeCustody,
} from "../packages/passman/src/custody.js";
import { createFreshApi } from "../apps/web/src/server/fresh/api.js";
import {
  grantFreshRuntime,
  migrateFresh,
} from "../apps/web/src/server/fresh/database.js";
import { database } from "../apps/web/src/server/database.js";

const connection = process.env.PASSMAN_TEST_DATABASE_URL;
const databaseName = "passman_v1_test";
if (
  connection !== undefined &&
  (!URL.canParse(connection) ||
    new URL(connection).pathname !== `/${databaseName}`)
) {
  throw new Error(
    `Set PASSMAN_TEST_DATABASE_URL to a disposable ${databaseName} database`,
  );
}
const origin = "http://127.0.0.1:39171";
const password = "Synthetic fixture vault password 1!";
const nextPassword = "Synthetic fixture vault password 2!";
const initialValue = "Synthetic provider secret 🔒";
const address = { project: "billing", name: "PROVIDER_TOKEN" };
const errorSchema = z
  .object({
    error: z.object({ code: z.string() }).strict(),
    requestId: z.uuid(),
  })
  .strict();
type HttpOptions = {
  token: string;
  body?: string;
  proof?: string;
  management?: string;
  method?: "GET" | "POST";
};

function memoryCustody() {
  const runtimes = new Map<string, RuntimeMaterial>();
  const writers = new Map<string, AdminMaterial>();
  const runtime = {
    async loadRuntime(selection) {
      return runtimes.get(selection.accountId);
    },
    async saveRuntime(material) {
      runtimes.set(material.anchor.accountId, material);
    },
  } satisfies RuntimeCustody;
  const admin = {
    async loadAdmin(selection) {
      return writers.get(selection.accountId);
    },
    async saveAdmin(material) {
      writers.set(material.runtime.anchor.accountId, material);
    },
  } satisfies AdminCustody;
  return { runtime, admin, runtimes };
}

async function responseJson<T>(
  response: Response,
  schema: z.ZodType<T>,
  status = 200,
): Promise<T> {
  const json: unknown = await response.json();
  const error = errorSchema.safeParse(json);
  assert.equal(
    response.status,
    status,
    error.success ? error.data.error.code : "unexpected HTTP status",
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  return schema.parse(json);
}

async function errorCode(
  response: Response,
  expected: string,
  status?: number,
) {
  const result = await responseJson(
    response,
    errorSchema,
    status ?? response.status,
  );
  assert.equal(response.ok, false);
  assert.equal(result.error.code, expected);
  return result.requestId;
}

await test(
  "fresh Passman API and SDK use PostgreSQL with restricted runtime grants",
  {
    skip:
      connection === undefined
        ? "PASSMAN_TEST_DATABASE_URL is unset; run against disposable passman_v1_test"
        : false,
  },
  async (t) => {
    assert.ok(connection);
    const owner = database(connection);
    const config = new URL(connection);
    const resources: {
      pool?: ReturnType<typeof database>;
      lock?: PoolClient;
      roleCreated: boolean;
    } = { roleCreated: false };
    const role = `passman_test_${randomUUID().replaceAll("-", "")}`;
    const rolePassword = randomSecret();
    const tables =
      "passman_v1.audit_events,passman_v1.vaults,passman_v1.limits";
    t.after(async () => {
      try {
        await resources.pool?.end();
        if (resources.roleCreated) {
          await owner.query(`TRUNCATE ${tables} CASCADE`);
          await owner.query(`DROP OWNED BY ${role}`);
          await owner.query(`DROP ROLE ${role}`);
        }
      } finally {
        if (resources.lock) {
          try {
            await resources.lock.query("SELECT pg_advisory_unlock(74125904)");
          } finally {
            resources.lock.release();
          }
        }
        await owner.end();
      }
    });
    const actual = await owner.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    assert.equal(actual.rows[0]?.name, databaseName);
    resources.lock = await owner.connect();
    await resources.lock.query("SELECT pg_advisory_lock(74125904)");
    await migrateFresh(owner);
    await owner.query(`TRUNCATE ${tables} CASCADE`);
    await owner.query(
      `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${rolePassword}'`,
    );
    resources.roleCreated = true;
    await grantFreshRuntime(owner, role);
    config.username = role;
    config.password = rolePassword;
    const pool = database(config.toString());
    resources.pool = pool;
    const runtimeRole = await pool.query<{ name: string; superuser: boolean }>(
      "SELECT current_user AS name, rolsuper AS superuser FROM pg_roles WHERE rolname=current_user",
    );
    assert.deepEqual(runtimeRole.rows, [{ name: role, superuser: false }]);

    const tokenA = randomSecret();
    const tokenB = randomSecret();
    const authenticate = async (request: Request) => {
      const authorization = request.headers.get("authorization");
      if (authorization === `Bearer ${tokenA}`)
        return { id: "human-a", recent: true };
      if (authorization === `Bearer ${tokenB}`)
        return { id: "human-b", recent: true };
      return failure("UNAUTHORIZED");
    };
    const api = createFreshApi({ pool, origin, authenticate });
    const fetch: typeof globalThis.fetch = (input, init) =>
      api(new Request(input, init));
    const request = (path: string, input: HttpOptions) =>
      fetch(`${origin}${API_PATH}${path}`, {
        method: input.method ?? (input.body === undefined ? "GET" : "POST"),
        body: input.body,
        headers: {
          authorization: `Bearer ${input.token}`,
          ...(input.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...(input.proof ? { "x-passman-proof": input.proof } : {}),
          ...(input.management
            ? { "x-passman-management": input.management }
            : {}),
        },
      });
    const managementA = new ManagementClient({
      origin,
      fetch,
      managementToken: tokenA,
    });
    const managementB = new ManagementClient({
      origin,
      fetch,
      managementToken: tokenB,
    });
    const custody = memoryCustody();
    const details = {
      label: "Synthetic fixture",
      expiresAt: Date.now() + 3_600_000,
    };
    assert.equal(await managementA.account(), null);
    const prepared = await managementA.prepareInitialization(password, details);
    const adminId = parseCredential(prepared.adminKey, "admin").id;
    await managementA.initialize(prepared);
    await custody.admin.saveAdmin(prepared.admin);
    const adminA = new AdminClient({
      origin,
      fetch,
      adminKey: prepared.adminKey,
      custody: custody.admin,
    });
    const accountA = prepared.bundle.anchor.accountId;

    await t.test(
      "database runtime role cannot alter schema, credentials or audit history",
      async () => {
        for (const sql of [
          "CREATE TABLE passman_v1.forbidden(id integer)",
          "UPDATE passman_v1.credentials SET hash=hash WHERE false",
          "DELETE FROM passman_v1.slots WHERE false",
          "UPDATE passman_v1.audit_events SET outcome=outcome WHERE false",
          "DELETE FROM passman_v1.audit_events WHERE false",
          "TRUNCATE passman_v1.audit_events",
        ])
          await assert.rejects(pool.query(sql), { code: "42501" });
      },
    );

    await t.test(
      "bound initialization is idempotent and a human session cannot issue native authority alone",
      async () => {
        await managementA.initialize(prepared);
        assert.equal((await managementA.account())?.accountId, accountA);
        await assert.rejects(
          managementA.prepareInitialization(password, details),
          { code: "VAULT_ALREADY_EXISTS" },
        );
        await errorCode(
          await request("/admin/enroll", {
            token: tokenA,
            body: JSON.stringify({
              ...details,
              id: randomUUID(),
              hash: randomSecret(),
            }),
          }),
          "FORBIDDEN",
          403,
        );
      },
    );

    const billing = await adminA.createProject("billing");
    const privateProject = await adminA.createProject("internal");
    const issueRead = async (
      token: string,
      projects: string[] | null,
      bootstrap: boolean,
      expiresAt: number | null = null,
    ) => {
      const result = await responseJson(
        await request("/console/service-keys", {
          token,
          body: JSON.stringify({
            label: "Synthetic read",
            projects,
            expiresAt,
            bootstrap,
          }),
        }),
        z.object({ serviceKey: z.string(), id: z.uuid() }).strict(),
      );
      assert.equal(parseCredential(result.serviceKey, "read").id, result.id);
      return result.serviceKey;
    };
    const ordinary = await issueRead(tokenA, [billing.id], false);
    const bootstrap = await issueRead(tokenA, [billing.id], true);
    const bare = RuntimeClient.connect({
      origin,
      fetch,
      serviceKey: ordinary,
      custody: null,
    });
    const runtime = RuntimeClient.connect({
      origin,
      fetch,
      serviceKey: ordinary,
      custody: custody.runtime,
    });
    const initial = prepared.bundle;
    async function pending(
      name: string,
      value: string,
      receiptId = randomUUID(),
    ) {
      const current = await managementA.download();
      const ctx: RecordContext = {
        version: 1,
        origin,
        accountId: accountA,
        vaultId: initial.anchor.vaultId,
        project: billing.name,
        projectId: billing.id,
        name,
        secretId: randomUUID(),
        keyId: current.activeKey.id,
        epoch: current.epoch,
        revision: 1,
        state: "pending",
      };
      const record = await sealValue(value, current.activeKey.publicKey, ctx);
      return { record, receiptId };
    }
    const submission = await pending(address.name, initialValue);
    const submissionBody = JSON.stringify(submission);
    const accepted = z
      .object({ id: z.uuid(), state: z.literal("pending") })
      .strict();
    const pendingPath = "/console/pending";

    await t.test(
      "project scopes, pending races and exact local activation",
      async () => {
        assert.deepEqual(
          (await bare.listProjects()).map((project) => project.name),
          ["billing"],
        );
        for (const project of [privateProject.name, "unknown-project"]) {
          await assert.rejects(bare.listSecrets({ project }), {
            code: "FORBIDDEN",
          });
        }
        await assert.rejects(bare.getEncryptedSecret(address), {
          code: "NOT_FOUND",
        });
        const competitor = await pending(
          address.name,
          "Synthetic competing submission",
        );
        const responses = await Promise.all([
          request(pendingPath, { token: tokenA, body: submissionBody }),
          request(pendingPath, {
            token: tokenA,
            body: JSON.stringify(competitor),
          }),
        ]);
        assert.deepEqual(
          responses.map((result) => result.status).sort(),
          [200, 409],
        );
        const chosen = responses[0]?.ok ? submission : competitor;
        const chosenValue = responses[0]?.ok
          ? initialValue
          : "Synthetic competing submission";
        const chosenBody = JSON.stringify(chosen);
        const retry = await responseJson(
          await request(pendingPath, { token: tokenA, body: chosenBody }),
          accepted,
        );
        assert.equal(retry.id, chosen.record.context.secretId);
        await errorCode(
          await request(pendingPath, {
            token: tokenA,
            body: JSON.stringify({
              ...chosen,
              record: {
                ...chosen.record,
                context: { ...chosen.record.context, secretId: randomUUID() },
              },
            }),
          }),
          "CONFLICT",
          409,
        );
        assert.equal(
          (await bare.getEncryptedSecret(address)).context.state,
          "pending",
        );
        assert.deepEqual(
          (await bare.listSecrets({ project: "billing" })).map(
            (secret) => secret.state,
          ),
          ["pending"],
        );
        await custody.runtime.saveRuntime(prepared.admin.runtime);
        await assert.rejects(runtime.getSecret(address), {
          code: "PENDING_VERIFICATION_REQUIRED",
        });
        await assert.rejects(
          adminA.activatePending(address, "Wrong synthetic value"),
          { code: "PENDING_VERIFICATION_REQUIRED" },
        );
        const forgedPath = `/projects/${billing.name}/secrets`;
        const forgedBody = JSON.stringify({
          record: chosen.record,
          expectedRevision: 1,
        });
        await errorCode(
          await request(forgedPath, { token: tokenA, body: forgedBody }),
          "UNAUTHORIZED",
          401,
        );
        await errorCode(
          await request(forgedPath, { token: ordinary, body: forgedBody }),
          "FORBIDDEN",
          403,
        );
        assert.deepEqual(await adminA.activatePending(address, chosenValue), {
          revision: 2,
          state: "active",
        });
        assert.equal(
          (await bare.getEncryptedSecret(address)).context.state,
          "active",
        );
        await assert.rejects(bare.getSecret(address), {
          code: "VAULT_NOT_PROVISIONED",
        });
        assert.equal(await runtime.getSecret(address), chosenValue);
        const forged = await sealValue(
          "Synthetic substitution",
          initial.activeKey.publicKey,
          {
            ...chosen.record.context,
            state: "active",
            revision: 2,
          },
        );
        const hostile = RuntimeClient.connect({
          origin,
          serviceKey: ordinary,
          custody: custody.runtime,
          fetch: (input, init) =>
            String(input).endsWith(`/secrets/${address.name}`)
              ? Promise.resolve(Response.json(forged))
              : fetch(input, init),
        });
        await assert.rejects(hostile.getSecret(address), {
          code: "SIGNATURE_INVALID",
        });
      },
    );

    await t.test(
      "bootstrap and admin restoration are role-separated, with no custody write on wrong password",
      async () => {
        const fresh = memoryCustody();
        const boot = RuntimeClient.connect({
          origin,
          fetch,
          serviceKey: bootstrap,
          custody: fresh.runtime,
        });
        await errorCode(
          await request("/bootstrap", { token: ordinary }),
          "FORBIDDEN",
          403,
        );
        await errorCode(
          await request("/administration", { token: bootstrap }),
          "UNAUTHORIZED",
          401,
        );
        const wrapper = await responseJson(
          await request("/bootstrap", { token: bootstrap }),
          z.record(z.string(), z.unknown()),
        );
        assert.equal(Object.hasOwn(wrapper, "administration"), false);
        await assert.rejects(boot.unlock("Synthetic wrong password!"), {
          code: "PASSWORD_INVALID",
        });
        assert.equal(fresh.runtimes.size, 0);
        assert.deepEqual(await boot.unlock(password), {
          epoch: 1,
          generation: 1,
        });
        assert.deepEqual(
          fresh.runtimes.get(accountA)?.keys,
          prepared.admin.runtime.keys,
        );
        assert.notEqual(
          fresh.runtimes.get(accountA)?.installationId,
          prepared.admin.runtime.installationId,
        );
        const restored = await managementA.restoreAdministration(
          password,
          fresh.admin,
        );
        assert.deepEqual(restored.signingKey, prepared.admin.signingKey);
        const replacement = await managementA.enroll(restored, details);
        const recoveredAdmin = new AdminClient({
          origin,
          fetch,
          adminKey: replacement,
          custody: fresh.admin,
        });
        assert.equal((await recoveredAdmin.status()).accountId, accountA);
      },
    );

    await t.test(
      "signed revisions support update, tombstone and recreation without permitting website name reuse",
      async () => {
        assert.deepEqual(await adminA.updateSecret(address, ""), {
          revision: 3,
          state: "active",
        });
        assert.equal(await runtime.getSecret(address), "");
        const before = await runtime.getEncryptedSecret(address);
        assert.deepEqual(await adminA.deleteSecret(address), {
          revision: 4,
          state: "deleted",
        });
        assert.equal(await runtime.hasSecret(address), false);
        await assert.rejects(runtime.getSecret(address), { code: "NOT_FOUND" });
        await errorCode(
          await request(pendingPath, {
            token: tokenA,
            body: JSON.stringify(await pending(address.name, initialValue)),
          }),
          "CONFLICT",
          409,
        );
        assert.deepEqual(await adminA.recreateSecret(address, initialValue), {
          revision: 5,
          state: "active",
        });
        assert.equal(await runtime.getSecret(address), initialValue);
        assert.equal(
          (await runtime.getEncryptedSecret(address)).context.secretId,
          before.context.secretId,
        );
        let replay = false;
        const observed = RuntimeClient.connect({
          origin,
          serviceKey: ordinary,
          custody: custody.runtime,
          fetch: (input, init) =>
            replay && String(input).endsWith(`/secrets/${address.name}`)
              ? Promise.resolve(Response.json(before))
              : fetch(input, init),
        });
        assert.equal(await observed.getSecret(address), initialValue);
        replay = true;
        await assert.rejects(observed.getSecret(address), {
          code: "CONTEXT_MISMATCH",
        });
      },
    );

    await t.test(
      "the selected service credential routes by account; wrong-account records and custody fail closed",
      async () => {
        const second = await managementB.prepareInitialization(
          password,
          details,
        );
        await managementB.initialize(second);
        await custody.admin.saveAdmin(second.admin);
        const adminB = new AdminClient({
          origin,
          fetch,
          adminKey: second.adminKey,
          custody: custody.admin,
        });
        await adminB.createProject(address.project);
        await adminB.createSecret(address, "Synthetic account B value");
        const readB = await issueRead(tokenB, null, false);
        const runtimeB = RuntimeClient.connect({
          origin,
          fetch,
          serviceKey: readB,
          custody: custody.runtime,
        });
        assert.equal(
          (await runtimeB.getEncryptedSecret(address)).context.accountId,
          second.bundle.anchor.accountId,
        );
        await assert.rejects(runtimeB.getSecret(address), {
          code: "VAULT_NOT_PROVISIONED",
        });
        const substituted = await runtimeB.getEncryptedSecret(address);
        const wrongRecord = RuntimeClient.connect({
          origin,
          serviceKey: ordinary,
          custody: custody.runtime,
          fetch: async () => Response.json(substituted),
        });
        await assert.rejects(wrongRecord.getSecret(address), {
          code: "CONTEXT_MISMATCH",
        });
        await custody.runtime.saveRuntime(second.admin.runtime);
        assert.deepEqual(
          await Promise.all([
            runtime.getSecret(address),
            runtimeB.getSecret(address),
          ]),
          [initialValue, "Synthetic account B value"],
        );
        const wrongCredential = ordinary.replace(
          accountA,
          second.bundle.anchor.accountId,
        );
        await errorCode(
          await request("/status", { token: wrongCredential }),
          "UNAUTHORIZED",
          401,
        );
      },
    );

    await t.test(
      "native proof binds route and body and a successful nonce cannot commit twice",
      async () => {
        const path = "/projects";
        const body = JSON.stringify({ name: "nonce-race" });
        const proof = await administrativeProof(
          prepared.admin,
          adminId,
          path,
          body,
        );
        const options = { token: prepared.adminKey, body, proof };
        await errorCode(
          await request("/credentials", options),
          "FORBIDDEN",
          403,
        );
        await errorCode(
          await request(path, {
            ...options,
            body: JSON.stringify({ name: "wrong-body" }),
          }),
          "FORBIDDEN",
          403,
        );
        const responses = await Promise.all([
          request(path, options),
          request(path, options),
        ]);
        assert.deepEqual(
          responses.map((result) => result.status).sort(),
          [200, 409],
        );
        const conflict = responses.find((result) => !result.ok);
        assert.ok(conflict);
        await errorCode(conflict, "CONFLICT", 409);
        const inserted = await owner.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM passman_v1.projects WHERE account_id=$1 AND name=$2",
          [accountA, "nonce-race"],
        );
        assert.equal(inserted.rows[0]?.count, 1);

        const { operatorId } = await responseJson(
          await request("/account", { token: tokenA }),
          z.object({ operatorId: z.string() }),
        );
        const enrollPath = "/admin/enroll";
        const newId = randomUUID();
        const enrollBody = JSON.stringify({
          ...details,
          id: newId,
          hash: randomSecret(),
        });
        const enrollProof = await administrativeProof(
          prepared.admin,
          `management:${operatorId}`,
          enrollPath,
          enrollBody,
        );
        const enroll = { token: tokenA, body: enrollBody, proof: enrollProof };
        const enrolled = await Promise.all([
          request(enrollPath, enroll),
          request(enrollPath, enroll),
        ]);
        assert.deepEqual(
          enrolled.map((result) => result.status).sort(),
          [200, 409],
        );
        const managed = await owner.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM passman_v1.credentials WHERE account_id=$1 AND id=$2",
          [accountA, newId],
        );
        assert.equal(managed.rows[0]?.count, 1);
      },
    );

    await t.test(
      "audit write failure rolls back a mutation and its nonce; denial attribution is durable and redacted",
      async () => {
        const path = "/projects";
        const body = JSON.stringify({ name: "audit-rollback" });
        const proof = await administrativeProof(
          prepared.admin,
          adminId,
          path,
          body,
        );
        const options = { token: prepared.adminKey, body, proof };
        await owner.query(
          "ALTER TABLE passman_v1.audit_events ADD CONSTRAINT force_test_audit_failure CHECK (outcome <> 'success') NOT VALID",
        );
        let requestId: string;
        try {
          requestId = await errorCode(
            await request(path, options),
            "UNAVAILABLE",
            503,
          );
          const projects = await owner.query(
            "SELECT 1 FROM passman_v1.projects WHERE account_id=$1 AND name='audit-rollback'",
            [accountA],
          );
          assert.equal(projects.rowCount, 0);
        } finally {
          await owner.query(
            "ALTER TABLE passman_v1.audit_events DROP CONSTRAINT force_test_audit_failure",
          );
        }
        assert.equal((await request(path, options)).status, 200);
        const failure = await owner.query(
          "SELECT account_id,outcome,reason FROM passman_v1.audit_events WHERE request_id=$1",
          [requestId],
        );
        assert.deepEqual(failure.rows, [
          { account_id: accountA, outcome: "error", reason: "UNAVAILABLE" },
        ]);
        const denied = await errorCode(
          await request("/bootstrap", { token: ordinary }),
          "FORBIDDEN",
          403,
        );
        const attribution = await owner.query(
          "SELECT account_id,credential_id,outcome,reason FROM passman_v1.audit_events WHERE request_id=$1",
          [denied],
        );
        assert.deepEqual(attribution.rows, [
          {
            account_id: accountA,
            credential_id: parseCredential(ordinary).id,
            outcome: "denied",
            reason: "FORBIDDEN",
          },
        ]);
        const events = await owner.query(
          "SELECT * FROM passman_v1.audit_events",
        );
        const serialized = JSON.stringify(events.rows);
        for (const forbidden of [
          initialValue,
          password,
          ordinary,
          prepared.adminKey,
          tokenA,
          submission.record.envelope.ciphertext,
        ]) {
          assert.equal(
            serialized.includes(forbidden),
            false,
            "audit rows contain a forbidden field",
          );
        }
      },
    );

    await t.test(
      "key rotation refreshes provisioned readers and stale pending submissions cannot be activated",
      async () => {
        const stale = await pending("STALE_PENDING", initialValue);
        await responseJson(
          await request(pendingPath, {
            token: tokenA,
            body: JSON.stringify(stale),
          }),
          accepted,
        );
        const current = await managementA.download();
        const stage = await adminA.prepareRotation(current);
        let dropResponse = true;
        const interrupted = new AdminClient({
          origin,
          adminKey: prepared.adminKey,
          custody: custody.admin,
          fetch: async (input, init) => {
            const response = await fetch(input, init);
            if (
              String(input).endsWith(`${API_PATH}/vault`) &&
              init?.method === "POST" &&
              dropResponse
            ) {
              dropResponse = false;
              throw new Error(
                "Synthetic connection closed before rotation response",
              );
            }
            return response;
          },
        });
        await assert.rejects(interrupted.commitRotation(stage), {
          code: "UNAVAILABLE",
        });
        assert.equal((await managementA.download()).generation, 2);
        assert.deepEqual(await adminA.commitRotation(stage), {
          epoch: 1,
          generation: 2,
        });
        const activeContext: RecordContext = {
          ...stale.record.context,
          keyId: stage.bundle.activeKey.id,
          revision: 2,
          state: "active",
        };
        const validActivation = await signRecord(
          await sealValue(
            initialValue,
            stage.bundle.activeKey.publicKey,
            activeContext,
          ),
          prepared.admin.signingKey,
        );
        const path = `/projects/${billing.name}/secrets`;
        const body = JSON.stringify({
          record: validActivation,
          expectedRevision: 1,
          expectedDigest: await digest(
            JSON.stringify(recordSchema.parse(stale.record)),
          ),
        });
        await errorCode(
          await request(path, {
            token: prepared.adminKey,
            body,
            proof: await administrativeProof(
              prepared.admin,
              adminId,
              path,
              body,
            ),
          }),
          "CONFLICT",
          409,
        );
        const staleAddress = { ...address, name: stale.record.context.name };
        assert.deepEqual(await adminA.rejectPending(staleAddress), {
          revision: 2,
          state: "deleted",
        });
        await assert.rejects(runtime.getSecret(staleAddress), {
          code: "NOT_FOUND",
        });
        assert.equal(await runtime.getSecret(address), initialValue);
        assert.equal(custody.runtimes.get(accountA)?.generation, 2);
        const secondAddress = { ...address, name: "AFTER_ROTATION" };
        await adminA.createSecret(secondAddress, initialValue);
        const after = await responseJson(
          await request(
            `/projects/${billing.name}/secrets/${secondAddress.name}`,
            { token: ordinary },
          ),
          recordSchema,
        );
        assert.notEqual(after.context.keyId, initial.activeKey.id);
        assert.equal(await runtime.getSecret(secondAddress), initialValue);
      },
    );

    await t.test(
      "SDK transfer resumes lost acknowledgements after expiry only for verified durable custody",
      async (transferTest) => {
        const material = await custody.admin.loadAdmin({
          origin,
          accountId: accountA,
        });
        assert.ok(material);
        const bundle = await managementA.download();
        const source = {
          origin,
          fetch,
          adminKey: prepared.adminKey,
          managementToken: tokenA,
          material,
          bundle,
        };
        await assert.rejects(
          createTransfer({
            ...source,
            password: "Synthetic wrong transfer password!",
          }),
          { code: "PASSWORD_INVALID" },
        );
        const transfer = await createTransfer({
          ...source,
          password,
          lifetimeMs: 120_000,
        });
        const foreign = await managementB.account();
        assert.ok(foreign);
        const foreignMaterial = await custody.runtime.loadRuntime({
          origin,
          accountId: foreign.accountId,
        });
        assert.ok(foreignMaterial);
        const target = memoryCustody();
        await target.runtime.saveRuntime(foreignMaterial);
        const staged = new Map<
          string,
          Parameters<TransferSessions["save"]>[1]
        >();
        const sessions = {
          async load(id) {
            return staged.get(id);
          },
          async save(id, proof) {
            staged.set(id, proof);
          },
          async complete(id) {
            staged.delete(id);
          },
        } satisfies TransferSessions;
        const receiver = {
          origin,
          serviceKey: ordinary,
          code: transfer.code,
          custody: target.runtime,
          sessions,
        };
        const unexpectedFetch: typeof globalThis.fetch = async () =>
          assert.fail(
            "A substituted origin must be rejected before contacting the relay",
          );
        await assert.rejects(
          receiveTransfer({
            ...receiver,
            origin: "http://127.0.0.1:39172",
            fetch: unexpectedFetch,
          }),
          { code: "CONTEXT_MISMATCH" },
        );
        let dropClaim = true;
        let dropAck = true;
        const disrupted: typeof globalThis.fetch = async (input, init) => {
          const response = await fetch(input, init);
          if (String(input).endsWith("/claim") && dropClaim) {
            dropClaim = false;
            assert.equal(response.ok, true);
            assert.equal(staged.has(transfer.transferId), true);
            throw new Error("Synthetic loss of claim response");
          }
          if (String(input).endsWith("/ack")) {
            assert.equal(target.runtimes.has(accountA), true);
            if (dropAck) {
              dropAck = false;
              assert.equal(response.ok, true);
              throw new Error("Synthetic loss of acknowledgement response");
            }
          }
          return response;
        };
        await assert.rejects(
          receiveTransfer({ ...receiver, fetch: disrupted }),
          { code: "UNAVAILABLE" },
        );
        assert.equal(target.runtimes.has(accountA), false);
        await assert.rejects(
          receiveTransfer({
            ...receiver,
            fetch: disrupted,
            custody: {
              ...target.runtime,
              async saveRuntime() {
                throw new Error(
                  "synthetic store diagnostic with private details",
                );
              },
            },
          }),
          { code: "STORAGE_UNAVAILABLE" },
        );
        assert.equal(dropAck, true);
        await assert.rejects(
          receiveTransfer({ ...receiver, fetch: disrupted }),
          { code: "UNAVAILABLE" },
        );
        assert.equal(dropAck, false);
        assert.equal(target.runtimes.has(accountA), true);
        assert.equal(staged.has(transfer.transferId), true);
        let loads = 0;
        let acknowledgements = 0;
        const countAck: typeof globalThis.fetch = (input, init) => {
          if (String(input).endsWith("/ack")) acknowledgements++;
          return disrupted(input, init);
        };
        await assert.rejects(
          receiveTransfer({
            ...receiver,
            fetch: countAck,
            custody: {
              ...target.runtime,
              async loadRuntime(selection) {
                return ++loads === 1
                  ? target.runtime.loadRuntime(selection)
                  : undefined;
              },
            },
          }),
          { code: "STORAGE_UNAVAILABLE" },
        );
        assert.equal(acknowledgements, 0);

        const clock = transferTest.mock.method(
          Date,
          "now",
          () => transfer.expiresAt + 1,
        );
        let installed: RuntimeMaterial;
        try {
          await assert.rejects(
            receiveTransfer({
              ...receiver,
              custody: memoryCustody().runtime,
              fetch: unexpectedFetch,
            }),
            { code: "TRANSFER_EXPIRED" },
          );
          installed = await receiveTransfer({ ...receiver, fetch: countAck });
          assert.equal(acknowledgements, 1);
          await assert.rejects(
            receiveTransfer({ ...receiver, fetch: unexpectedFetch }),
            { code: "TRANSFER_EXPIRED" },
          );
        } finally {
          clock.mock.restore();
        }
        assert.deepEqual(installed.keys, material.runtime.keys);
        assert.equal(installed.syncKey === material.runtime.syncKey, true);
        assert.equal(Object.hasOwn(installed, "signingKey"), false);
        assert.notEqual(
          installed.installationId,
          material.runtime.installationId,
        );
        assert.equal(staged.size, 0);
        assert.deepEqual(
          target.runtimes.get(foreign.accountId),
          foreignMaterial,
        );
        const device = RuntimeClient.connect({
          origin,
          fetch,
          serviceKey: ordinary,
          custody: target.runtime,
        });
        assert.equal(await device.getSecret(address), initialValue);
        const relay = await owner.query<{ state: string; payload: unknown }>(
          "SELECT state,payload FROM passman_v1.transfers WHERE id=$1",
          [transfer.transferId],
        );
        assert.deepEqual(relay.rows, [
          { state: "acknowledged", payload: null },
        ]);
      },
    );

    await t.test(
      "a password change and rotation from the same generation cannot both commit",
      async () => {
        const current = await managementA.download();
        const [rotation, changed] = await Promise.all([
          adminA.prepareRotation(current),
          changeVaultPassword(current, password, nextPassword),
        ]);
        const path = "/vault";
        const makeRequest = async (bundle: typeof current) => {
          const body = JSON.stringify({
            bundle,
            expectedGeneration: current.generation,
          });
          return request(path, {
            token: prepared.adminKey,
            management: tokenA,
            body,
            proof: await administrativeProof(
              prepared.admin,
              adminId,
              path,
              body,
            ),
          });
        };
        const responses = await Promise.all([
          makeRequest(changed),
          makeRequest(rotation.bundle),
        ]);
        assert.deepEqual(
          responses.map((result) => result.status).sort(),
          [200, 409],
        );
        const passwordChanged = responses[0]?.ok;
        const conflict = responses.find((result) => !result.ok);
        assert.ok(conflict);
        await errorCode(conflict, "CONFLICT", 409);
        const visible = await managementA.download();
        assert.equal(visible.generation, current.generation + 1);
        assert.equal(await runtime.getSecret(address), initialValue);
        const fresh = memoryCustody();
        const boot = RuntimeClient.connect({
          origin,
          fetch,
          serviceKey: bootstrap,
          custody: fresh.runtime,
        });
        await assert.rejects(
          boot.unlock(passwordChanged ? password : nextPassword),
          {
            code: "PASSWORD_INVALID",
          },
        );
        assert.equal(fresh.runtimes.size, 0);
        assert.equal(
          (await boot.unlock(passwordChanged ? nextPassword : password))
            .generation,
          visible.generation,
        );
        assert.equal(await boot.getSecret(address), initialValue);
      },
    );

    await t.test(
      "transfer relay authorizes one same-account receiver with a private resumption proof",
      async () => {
        const path = "/transfers";
        const transferId = randomUUID();
        const claimSecret = randomSecret();
        const receiver = randomSecret();
        const expiresAt = Date.now() + 120_000;
        const payload = await sealBox(
          { sample: "synthetic transfer payload" },
          randomSecret(),
          [origin, accountA, transferId],
        );
        const current = await managementA.download();
        const transfer = {
          id: transferId,
          claimHash: await digest(claimSecret),
          epoch: current.epoch,
          expectedGeneration: current.generation,
          expiresAt,
          payload,
        };
        const body = JSON.stringify(transfer);
        const proof = await administrativeProof(
          prepared.admin,
          adminId,
          path,
          body,
        );
        const stale = JSON.stringify({
          ...transfer,
          expectedGeneration: current.generation - 1,
        });
        await errorCode(
          await request(path, {
            token: prepared.adminKey,
            body: stale,
            management: tokenA,
            proof: await administrativeProof(
              prepared.admin,
              adminId,
              path,
              stale,
            ),
          }),
          "CONFLICT",
          409,
        );
        await errorCode(
          await request(path, {
            token: ordinary,
            body,
            proof,
            management: tokenA,
          }),
          "FORBIDDEN",
          403,
        );
        await responseJson(
          await request(path, {
            token: prepared.adminKey,
            body,
            proof,
            management: tokenA,
          }),
          z.object({ id: z.uuid(), expiresAt: z.number() }).strict(),
        );
        const claimPath = `${path}/${transferId}/claim`;
        const requestClaim = (
          token: string,
          sessionSecret: string,
          claim = claimSecret,
        ) =>
          request(claimPath, {
            token,
            body: JSON.stringify({ claimSecret: claim, sessionSecret }),
          });
        await errorCode(
          await requestClaim(ordinary, receiver, randomSecret()),
          "FORBIDDEN",
          403,
        );
        const foreign = await issueRead(tokenB, null, false);
        await errorCode(
          await requestClaim(foreign, receiver),
          "NOT_FOUND",
          404,
        );
        const alternateReceiver = randomSecret();
        const race = await Promise.all([
          requestClaim(ordinary, receiver),
          requestClaim(bootstrap, alternateReceiver),
        ]);
        assert.deepEqual(
          race.map((result) => result.status).sort(),
          [200, 409],
        );
        const resumed = race[0]?.ok
          ? { token: ordinary, session: receiver }
          : { token: bootstrap, session: alternateReceiver };
        const interrupted = await responseJson(
          await requestClaim(resumed.token, resumed.session),
          z
            .object({
              id: z.uuid(),
              epoch: z.number(),
              expiresAt: z.number(),
              payload: z.unknown(),
            })
            .strict(),
        );
        assert.deepEqual(interrupted.payload, payload);
        const ackPath = `${path}/${transferId}/ack`;
        await errorCode(
          await request(ackPath, {
            token: resumed.token,
            body: JSON.stringify({ sessionSecret: randomSecret() }),
          }),
          "FORBIDDEN",
          403,
        );
        assert.equal(
          (
            await request(ackPath, {
              token: resumed.token,
              body: JSON.stringify({ sessionSecret: resumed.session }),
            })
          ).status,
          200,
        );
        await errorCode(
          await requestClaim(resumed.token, resumed.session),
          "TRANSFER_CLAIMED",
          409,
        );
      },
    );

    await t.test(
      "credential expiry and revocation preserve account routing and stable inventory",
      async () => {
        const read = await issueRead(
          tokenA,
          [billing.id],
          false,
          Date.now() + 60_000,
        );
        const nextRead = await issueRead(tokenA, [billing.id], false);
        const readId = parseCredential(read).id;
        const stored = await owner.query<{ hash: string }>(
          "SELECT hash FROM passman_v1.credentials WHERE id=$1",
          [readId],
        );
        assert.equal(
          stored.rows[0]?.hash === (await digest(read)),
          true,
          "database stores the digest of the credential",
        );
        const stable = prepared.admin.runtime.installationId;
        const path = "/installations";
        const body = JSON.stringify({
          id: stable,
          label: "Synthetic runtime",
          kind: "container",
        });
        assert.equal((await request(path, { token: read, body })).status, 200);
        assert.equal(
          (await request(path, { token: nextRead, body })).status,
          200,
        );
        const inventory = z.object({
          installations: z.array(
            z.object({
              id: z.uuid(),
              label: z.string(),
              kind: z.string(),
              status: z.string(),
            }),
          ),
        });
        const list = await responseJson(
          await request("/console/installations", { token: tokenA }),
          inventory,
        );
        assert.deepEqual(list.installations, [
          {
            id: stable,
            label: "Synthetic runtime",
            kind: "container",
            status: "active",
          },
        ]);
        assert.deepEqual(
          (
            await responseJson(
              await request("/console/installations", { token: tokenB }),
              inventory,
            )
          ).installations,
          [],
        );
        await errorCode(
          await request("/console/installations", { token: nextRead }),
          "UNAUTHORIZED",
          401,
        );
        const edited = JSON.stringify({
          id: stable,
          label: "Synthetic changed label",
          kind: "function",
        });
        await errorCode(
          await request("/console/installations", {
            token: tokenA,
            body: edited,
          }),
          "NOT_FOUND",
          404,
        );
        assert.deepEqual(
          (
            await responseJson(
              await request("/console/installations", { token: tokenA }),
              inventory,
            )
          ).installations,
          list.installations,
        );

        await owner.query(
          "UPDATE passman_v1.credentials SET expires_at=$2 WHERE id=$1",
          [readId, Date.now() - 1],
        );
        await errorCode(
          await request("/status", { token: read }),
          "CREDENTIAL_EXPIRED",
          401,
        );
        await adminA.revokeCredential(parseCredential(nextRead).id);
        await errorCode(
          await request("/status", { token: nextRead }),
          "CREDENTIAL_REVOKED",
          401,
        );
        await assert.rejects(
          pool.query(
            "UPDATE passman_v1.credentials SET revoked=false WHERE id=$1",
            [parseCredential(nextRead).id],
          ),
          { code: "P0001" },
        );
        assert.equal(await runtime.getSecret(address), initialValue);
      },
    );

    await t.test(
      "new sync epoch rejects copied runtime authority while retaining historical values",
      async () => {
        const former = custody.runtimes.get(accountA);
        assert.ok(former);
        const current = await managementA.download();
        const changedPassword = "Synthetic replacement epoch vault password 3!";
        const stage = await adminA.prepareRotation(current, changedPassword);
        const [committed, ...during] = await Promise.all([
          adminA.commitRotation(stage, tokenA),
          ...Array.from({ length: 8 }, () =>
            request("/status", { token: ordinary }),
          ),
        ]);
        assert.deepEqual(committed, {
          epoch: 2,
          generation: current.generation + 1,
        });
        for (const response of during) {
          if (response.ok) {
            assert.equal(
              (await responseJson(response, z.object({ epoch: z.number() })))
                .epoch,
              1,
            );
          } else {
            await errorCode(response, "CREDENTIAL_REVOKED", 401);
          }
        }
        await assert.rejects(runtime.getSecret(address), {
          code: "CREDENTIAL_REVOKED",
        });
        const nextRead = await issueRead(tokenA, [billing.id], true);
        const copied = RuntimeClient.connect({
          origin,
          fetch,
          serviceKey: nextRead,
          custody: custody.runtime,
        });
        await assert.rejects(copied.getSecret(address), {
          code: "CONTEXT_MISMATCH",
        });
        const packageMetadata = await inspectRuntimePackage(
          stage.bundle.keyring,
          former.anchor,
        );
        await assert.rejects(
          openBox(
            packageMetadata.box,
            former.syncKey,
            runtimePackageContext(packageMetadata),
          ),
          { code: "INTEGRITY_FAILED" },
        );
        const fresh = memoryCustody();
        const reinstated = RuntimeClient.connect({
          origin,
          fetch,
          serviceKey: nextRead,
          custody: fresh.runtime,
        });
        assert.equal((await reinstated.unlock(changedPassword)).epoch, 2);
        assert.equal(await reinstated.getSecret(address), initialValue);
        const nextAddress = { ...address, name: "REPLACED_EPOCH" };
        await adminA.createSecret(nextAddress, initialValue);
        const record = await reinstated.getEncryptedSecret(nextAddress);
        assert.equal(record.context.epoch, 2);
        assert.equal(
          former.keys.some((key) => key.id === record.context.keyId),
          false,
        );
        assert.equal(await reinstated.getSecret(nextAddress), initialValue);
      },
    );
  },
);
