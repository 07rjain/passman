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
  runtimePackageContext,
  sealBox,
  sealValue,
  verifyRecord,
  z,
  type AdminMaterial,
  type RuntimeMaterial,
} from "@passman/protocol";
import { createFreshApi } from "../apps/web/src/server/fresh/api.js";
import {
  grantFreshRuntime,
  migrateFresh,
} from "../apps/web/src/server/fresh/database.js";
import { database } from "../apps/web/src/server/database.js";
import {
  AdminClient,
  ManagementClient,
  administrativeProof,
} from "../packages/passman/src/admin.js";
import { RuntimeClient } from "../packages/passman/src/runtime.js";
import {
  checkRuntimeReplacement,
  type AdminCustody,
  type RuntimeCustody,
} from "../packages/passman/src/custody.js";
import { replaceWriterVault } from "../packages/passman/src/vault.js";
import {
  WriterReplacementClient,
  installReplacementRuntime,
  prepareWriterReplacement,
} from "../packages/passman/src/writer-replacement.js";

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
const origin = "http://127.0.0.1:39172";
const replacementPassword = "Synthetic replacement writer password!";
const initialPassword = "Synthetic initial writer password!";
const fixtureTables =
  "passman_v1.audit_events,passman_v1.vaults,passman_v1.limits,passman_v1.native_logins";
const replacementPath = "/writer-replacement";
const project = "synthetic";
const address = { project, name: "SECRET_A" };

async function assertError(response: Response, code: string) {
  assert.equal(response.ok, false);
  assert.equal(
    z
      .object({ error: z.object({ code: z.string() }) })
      .parse(await response.json()).error.code,
    code,
  );
}

await test(
  "writer replacement atomically publishes every slot, new authority and credentials",
  {
    skip:
      connection === undefined
        ? "PASSMAN_TEST_DATABASE_URL is unset; run against disposable passman_v1_test"
        : false,
  },
  async (t) => {
    assert.ok(connection);
    const owner = database(connection);
    const url = new URL(connection);
    const resources: {
      pool?: ReturnType<typeof database>;
      lock?: PoolClient;
      roleCreated: boolean;
    } = { roleCreated: false };
    const role = `passman_writer_${randomUUID().replaceAll("-", "")}`;
    const secret = randomSecret();
    t.after(async () => {
      try {
        await resources.pool?.end();
        if (resources.roleCreated) {
          await owner.query(`TRUNCATE ${fixtureTables} CASCADE`);
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
    assert.equal(
      (await owner.query<{ name: string }>("SELECT current_database() AS name"))
        .rows[0]?.name,
      databaseName,
    );
    resources.lock = await owner.connect();
    await resources.lock.query("SELECT pg_advisory_lock(74125904)");
    await migrateFresh(owner);
    await owner.query(`TRUNCATE ${fixtureTables} CASCADE`);
    await owner.query(
      `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${secret}'`,
    );
    resources.roleCreated = true;
    await grantFreshRuntime(owner, role);
    url.username = role;
    url.password = secret;
    const pool = database(url.toString());
    resources.pool = pool;

    const managementToken = randomSecret();
    const foreignToken = randomSecret();
    const api = createFreshApi({
      origin,
      pool,
      authenticate: async (request) => {
        const auth = request.headers.get("authorization");
        if (auth === `Bearer ${managementToken}`)
          return { id: "writer-fixture", recent: true };
        if (auth === `Bearer ${foreignToken}`)
          return { id: "foreign-fixture", recent: true };
        return failure("UNAUTHORIZED");
      },
    });
    const fetch: typeof globalThis.fetch = (input, init) =>
      api(new Request(input, init));
    const management = new ManagementClient({ origin, fetch, managementToken });
    const details = {
      label: "Synthetic writer",
      expiresAt: Date.now() + 3_600_000,
    };
    const initialized = await management.prepareInitialization(
      initialPassword,
      details,
    );
    await management.initialize(initialized);
    let adminLocal: AdminMaterial = initialized.admin;
    let runtimeLocal: RuntimeMaterial = initialized.admin.runtime;
    const custodyAdmin = {
      async loadAdmin() {
        return adminLocal;
      },
      async saveAdmin(material) {
        adminLocal = material;
      },
      async replaceAdmin(previous, replacement) {
        if (
          adminLocal.runtime.anchor.writer.x ===
          replacement.runtime.anchor.writer.x
        )
          return;
        assert.deepEqual(previous, adminLocal);
        adminLocal = replacement;
      },
    } satisfies AdminCustody;
    const custodyRuntime = {
      async loadRuntime() {
        return runtimeLocal;
      },
      async saveRuntime(material) {
        runtimeLocal = material;
      },
      async replaceRuntime(previous, replacement) {
        assert.deepEqual(previous, runtimeLocal);
        runtimeLocal = replacement;
      },
    } satisfies RuntimeCustody;
    const old = new AdminClient({
      origin,
      fetch,
      adminKey: initialized.adminKey,
      custody: custodyAdmin,
    });
    const scope = {
      label: "Synthetic read",
      projects: null,
      expiresAt: null,
      bootstrap: true,
    };
    const serviceKey = async () => {
      const response = await fetch(
        `${origin}${API_PATH}/console/service-keys`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${managementToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(scope),
        },
      );
      assert.equal(response.status, 200);
      return z.object({ serviceKey: z.string() }).parse(await response.json())
        .serviceKey;
    };
    const oldRead = await serviceKey();
    const oldRuntime = new RuntimeClient({
      origin,
      fetch,
      serviceKey: oldRead,
      custody: custodyRuntime,
    });
    const p = await old.createProject(project);
    for (const name of [
      address.name,
      "SECRET_B",
      "SECRET_C",
      "SECRET_D",
      "SECRET_E",
      "DELETED",
    ]) {
      await old.createSecret({ project, name }, `synthetic ${name}`);
    }
    await old.deleteSecret({ project, name: "DELETED" });
    const previous = await oldRuntime.getEncryptedSecret(address);
    const pendingAddress = { project, name: "PENDING" };
    const pending = await sealValue(
      "Synthetic pending",
      initialized.bundle.activeKey.publicKey,
      {
        ...previous.context,
        ...pendingAddress,
        projectId: p.id,
        state: "pending",
        revision: 1,
        secretId: randomUUID(),
      },
    );
    const pendingResponse = await fetch(
      `${origin}${API_PATH}/console/pending`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${managementToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ record: pending, receiptId: randomUUID() }),
      },
    );
    assert.equal(pendingResponse.status, 200);

    const stage = await prepareWriterReplacement(
      await management.download(),
      initialized.admin,
      replacementPassword,
      details,
    );
    const options = {
      origin,
      fetch,
      adminKey: initialized.adminKey,
      managementToken,
      source: initialized.admin,
      custody: custodyAdmin,
    };
    const writer = new WriterReplacementClient(options);
    const currentId = parseCredential(initialized.adminKey, "admin").id;
    const post = async (
      path: string,
      data: unknown,
      token = managementToken,
      credential = initialized.adminKey,
    ) => {
      const body = JSON.stringify(data);
      const proof = await administrativeProof(
        initialized.admin,
        currentId,
        path,
        body,
      );
      return fetch(`${origin}${API_PATH}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential}`,
          "content-type": "application/json",
          "x-passman-proof": proof,
          "x-passman-management": token,
        },
        body,
      });
    };
    const begin = {
      id: stage.id,
      expectedGeneration: stage.expectedGeneration,
      bundle: stage.bundle,
    };
    const relayId = randomUUID();
    const expiresAt = Date.now() + 120_000;
    const relay = {
      id: relayId,
      expiresAt,
      epoch: 1,
      expectedGeneration: 1,
      claimHash: await digest(randomSecret()),
      payload: await sealBox({ synthetic: true }, randomSecret(), [
        origin,
        relayId,
      ]),
    };
    assert.equal((await post("/transfers", relay)).status, 200);
    const nativeId = randomUUID();
    const nativeClaim = randomSecret();
    const nativeToken = `pmm1.${nativeId}.${randomSecret()}`;
    const nativeHash = await digest(nativeToken);
    await owner.query(
      `INSERT INTO passman_v1.native_logins(id,claim_hash,fingerprint_hash,expires_at,human_id,approved_at,management_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        nativeId,
        await digest(nativeClaim),
        await digest(randomSecret()),
        expiresAt,
        "writer-fixture",
        Date.now(),
        nativeHash,
      ],
    );
    await owner.query(
      "INSERT INTO passman_v1.native_management(id,human_id,hash,expires_at) VALUES($1,$2,$3,$4)",
      [nativeId, "writer-fixture", nativeHash, expiresAt],
    );
    const nativeAccount = () =>
      fetch(`${origin}${API_PATH}/account`, {
        headers: { authorization: `Bearer ${nativeToken}` },
      });
    assert.equal((await nativeAccount()).status, 200);
    await assertError(
      await post(replacementPath, begin, foreignToken),
      "FORBIDDEN",
    );
    await assertError(
      await post(replacementPath, begin, managementToken, oldRead),
      "FORBIDDEN",
    );
    await assertError(
      await post("/vault", {
        bundle: stage.bundle,
        expectedGeneration: stage.expectedGeneration,
      }),
      "CONTEXT_MISMATCH",
    );
    const cancelled = { ...stage, id: randomUUID() };
    assert.equal(
      (await post(replacementPath, { ...begin, id: cancelled.id })).status,
      200,
    );
    await writer.cancel(cancelled);
    await writer.cancel(cancelled);
    const removed = await owner.query<{ state: string; bundle: unknown }>(
      "SELECT state,bundle FROM passman_v1.writer_transitions WHERE id=$1",
      [cancelled.id],
    );
    assert.deepEqual(removed.rows, [{ state: "cancelled", bundle: null }]);
    assert.equal((await post(replacementPath, begin)).status, 200);
    await assert.rejects(writer.stage(stage), {
      code: "PENDING_VERIFICATION_REQUIRED",
    });
    await assert.rejects(writer.commit(stage), {
      code: "PENDING_VERIFICATION_REQUIRED",
    });
    const status = await old.status();
    assert.equal(status.epoch, 1);
    await old.rejectPending(pendingAddress);
    await assert.rejects(writer.commit(stage), { code: "CONFLICT" });

    await writer.stage(stage);
    const counted = await owner.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM passman_v1.writer_transition_records WHERE transition_id=$1",
      [stage.id],
    );
    assert.equal(counted.rows[0]?.count, 7);
    await old.updateSecret(address, "synthetic updated during staging");
    await assert.rejects(writer.commit(stage), { code: "CONFLICT" });
    assert.equal(
      await oldRuntime.getSecret(address),
      "synthetic updated during staging",
    );
    await writer.stage(stage);

    await owner.query(
      "ALTER TABLE passman_v1.audit_events ADD CONSTRAINT force_writer_audit_failure CHECK (outcome <> 'success') NOT VALID",
    );
    try {
      await assert.rejects(writer.commit(stage), { code: "UNAVAILABLE" });
      const state = await owner.query<{ state: string }>(
        "SELECT state FROM passman_v1.writer_transitions WHERE id=$1",
        [stage.id],
      );
      assert.deepEqual(state.rows, [{ state: "staging" }]);
    } finally {
      await owner.query(
        "ALTER TABLE passman_v1.audit_events DROP CONSTRAINT force_writer_audit_failure",
      );
    }
    assert.equal(
      await oldRuntime.getSecret(address),
      "synthetic updated during staging",
    );
    let dropped = false;
    const interrupted = new WriterReplacementClient({
      ...options,
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (String(input).endsWith("/commit")) {
          assert.equal(response.status, 200);
          dropped = true;
          throw new Error("Synthetic loss of commit response");
        }
        return response;
      },
    });
    assert.deepEqual(await interrupted.commit(stage), {
      id: stage.credential.id,
      generation: 2,
    });
    assert.equal(dropped, true);
    assert.deepEqual(await writer.commit(stage), {
      id: stage.credential.id,
      generation: 2,
    });
    const completed = await owner.query<{ state: string; bundle: unknown }>(
      "SELECT state,bundle FROM passman_v1.writer_transitions WHERE id=$1",
      [stage.id],
    );
    assert.deepEqual(completed.rows, [{ state: "committed", bundle: null }]);
    const retired = await owner.query<{ state: string; payload: unknown }>(
      "SELECT state,payload FROM passman_v1.transfers WHERE id=$1",
      [relayId],
    );
    assert.deepEqual(retired.rows, [{ state: "cancelled", payload: null }]);
    await assertError(await nativeAccount(), "UNAUTHORIZED");
    await assertError(
      await fetch(`${origin}${API_PATH}/auth/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: nativeId,
          claimSecret: nativeClaim,
          managementHash: nativeHash,
        }),
      }),
      "NOT_FOUND",
    );
    await assert.rejects(old.status(), { code: "CREDENTIAL_REVOKED" });
    await assert.rejects(oldRuntime.getSecret(address), {
      code: "CREDENTIAL_REVOKED",
    });

    const next = new AdminClient({
      origin,
      fetch,
      adminKey: stage.adminKey,
      custody: custodyAdmin,
    });
    assert.equal((await next.status()).epoch, 2);
    const replacementRead = await serviceKey();
    const retained = new RuntimeClient({
      origin,
      fetch,
      serviceKey: replacementRead,
      custody: custodyRuntime,
    });
    await assert.rejects(retained.unlock(replacementPassword), {
      code: "CONTEXT_MISMATCH",
    });
    const boot = await fetch(`${origin}${API_PATH}/bootstrap`, {
      headers: { authorization: `Bearer ${replacementRead}` },
    });
    assert.equal(boot.status, 200);
    const bootstrap: unknown = await boot.json();
    const priorMaterial = runtimeLocal;
    const wrong = {
      ...stage.bundle.anchor,
      writer: initialized.bundle.anchor.writer,
    };
    await assert.rejects(
      installReplacementRuntime(
        bootstrap,
        replacementPassword,
        priorMaterial,
        wrong,
        custodyRuntime,
      ),
      { code: "CONTEXT_MISMATCH" },
    );
    assert.deepEqual(runtimeLocal.anchor, initialized.bundle.anchor);
    await installReplacementRuntime(
      bootstrap,
      replacementPassword,
      priorMaterial,
      stage.bundle.anchor,
      custodyRuntime,
    );
    const reader = new RuntimeClient({
      origin,
      fetch,
      serviceKey: replacementRead,
      custody: custodyRuntime,
    });
    assert.equal(
      await reader.getSecret(address),
      "synthetic updated during staging",
    );
    assert.equal(
      await reader.getSecret({ project, name: "SECRET_E" }),
      "synthetic SECRET_E",
    );
    assert.equal(await reader.hasSecret({ project, name: "DELETED" }), false);
    assert.equal(await reader.hasSecret(pendingAddress), false);
    const current = await reader.getEncryptedSecret(address);
    assert.equal(current.context.secretId, previous.context.secretId);
    assert.equal(current.context.keyId, stage.bundle.activeKey.id);
    await assert.rejects(
      verifyRecord(current, initialized.bundle.anchor, address),
      { code: "SIGNATURE_INVALID" },
    );
    const ring = await inspectRuntimePackage(
      stage.bundle.keyring,
      stage.bundle.anchor,
    );
    await assert.rejects(
      openBox(ring.box, priorMaterial.syncKey, runtimePackageContext(ring)),
      { code: "INTEGRITY_FAILED" },
    );
    const tombstone = await reader.getEncryptedSecret({
      project,
      name: "DELETED",
    });
    await verifyRecord(tombstone, stage.bundle.anchor, {
      project,
      name: "DELETED",
    });
    assert.equal(tombstone.context.revision, 3);
    assert.equal(tombstone.context.state, "deleted");

    await t.test(
      "an explicitly trusted runtime can resume after missing an intermediate writer epoch",
      async () => {
        const nextPassword = "Synthetic password after a second epoch change!";
        const latest = await replaceWriterVault(
          stage.bundle,
          stage.admin,
          nextPassword,
        );
        let offline = priorMaterial;
        const offlineCustody = {
          async loadRuntime() {
            return offline;
          },
          async replaceRuntime(previous, replacement) {
            if (checkRuntimeReplacement(offline, previous, replacement))
              offline = replacement;
          },
        } satisfies RuntimeCustody;
        await installReplacementRuntime(
          latest.bundle,
          nextPassword,
          priorMaterial,
          latest.bundle.anchor,
          offlineCustody,
        );
        assert.equal(offline.epoch, priorMaterial.epoch + 2);
        assert.equal(offline.installationId, priorMaterial.installationId);
        assert.equal(offline.anchor.writer.x, latest.bundle.anchor.writer.x);
      },
    );
  },
);
