import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { PoolClient } from "pg";
import {
  API_PATH,
  bytes32,
  digest,
  failure,
  randomSecret,
  z,
  type AdminMaterial,
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
} from "../packages/passman/src/admin.js";
import { login } from "../packages/passman/src/login.js";
import type { AdminCustody } from "../packages/passman/src/custody.js";

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
const origin = "http://127.0.0.1:39173";
const fixtureTables =
  "passman_v1.audit_events,passman_v1.vaults,passman_v1.limits,passman_v1.native_logins";
const approvePath = "/console/auth/approve";
const errorSchema = z.object({
  error: z.object({ code: z.string() }),
  requestId: z.uuid(),
});
const challengeSchema = z
  .object({ id: z.uuid(), claimHash: bytes32, fingerprintHash: bytes32 })
  .strict();
const pollSchema = z
  .object({ id: z.uuid(), claimSecret: bytes32, managementHash: bytes32 })
  .strict();

async function assertError(response: Response, code: string) {
  assert.equal(response.ok, false);
  assert.equal(errorSchema.parse(await response.json()).error.code, code);
}

await test(
  "native management login requires browser approval and bound claim over PostgreSQL",
  {
    skip:
      connection === undefined
        ? "PASSMAN_TEST_DATABASE_URL is unset; run against disposable passman_v1_test"
        : false,
    timeout: 25_000,
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
    const role = `passman_login_${randomUUID().replaceAll("-", "")}`;
    const roleSecret = randomSecret();
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
      `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${roleSecret}'`,
    );
    resources.roleCreated = true;
    await grantFreshRuntime(owner, role);
    url.username = role;
    url.password = roleSecret;
    const pool = database(url.toString());
    resources.pool = pool;
    assert.equal(
      (await pool.query<{ name: string }>("SELECT current_user AS name"))
        .rows[0]?.name,
      role,
    );

    const browserOwner = randomSecret();
    const browserForeign = randomSecret();
    const browserStale = randomSecret();
    const userId = "synthetic-login-owner";
    const api = createFreshApi({
      origin,
      pool,
      authenticate: async (request) => {
        const header = request.headers.get("authorization");
        if (header === `Bearer ${browserOwner}`)
          return { id: userId, recent: true };
        if (header === `Bearer ${browserForeign}`)
          return { id: "synthetic-other-owner", recent: true };
        if (header === `Bearer ${browserStale}`)
          return { id: userId, recent: false };
        return failure("UNAUTHORIZED");
      },
    });
    const fetch: typeof globalThis.fetch = (input, init) =>
      api(new Request(input, init));
    const request = (path: string, body?: unknown, authorization?: string) =>
      fetch(`${origin}${API_PATH}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(authorization ? { authorization } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const signedBrowser = `Bearer ${browserOwner}`;
    let started: z.infer<typeof challengeSchema> | undefined;
    let completedPoll: z.infer<typeof pollSchema> | undefined;
    let fingerprint: string | undefined;
    let opened = 0;
    const captured: typeof globalThis.fetch = async (input, init) => {
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : undefined;
      if (String(input).endsWith("/auth/start"))
        started = challengeSchema.parse(body);
      if (String(input).endsWith("/auth/poll"))
        completedPoll = pollSchema.parse(body);
      return fetch(input, init);
    };
    const connected = await login({
      origin,
      fetch: captured,
      onVisit: async (details) => {
        assert.ok(started);
        const link = new URL(details.url);
        assert.equal(link.origin, origin);
        assert.equal(link.pathname, "/passman/connect");
        assert.deepEqual(
          [...link.searchParams.entries()],
          [["session", started.id]],
        );
        assert.equal(
          await digest(details.fingerprint),
          started.fingerprintHash,
        );
        const approval = { id: started.id, fingerprint: details.fingerprint };
        fingerprint = details.fingerprint;
        await assertError(await request(approvePath, approval), "UNAUTHORIZED");
        await assertError(
          await request(approvePath, approval, `Bearer ${browserStale}`),
          "FORBIDDEN",
        );
        await assertError(
          await request(
            approvePath,
            { ...approval, fingerprint: randomSecret() },
            signedBrowser,
          ),
          "FORBIDDEN",
        );
        const responses = await Promise.all([
          request(approvePath, approval, signedBrowser),
          request(approvePath, approval, signedBrowser),
        ]);
        assert.deepEqual(
          responses.map((response) => response.status),
          [200, 200],
        );
        await assertError(
          await request(approvePath, approval, `Bearer ${browserForeign}`),
          "CONFLICT",
        );
      },
      openBrowser: async (link) => {
        opened++;
        assert.equal(new URL(link).pathname, "/passman/connect");
      },
    });
    assert.equal(opened, 1);
    assert.ok(started && completedPoll && fingerprint);
    assert.equal(
      connected.operatorId,
      await digest(JSON.stringify(["passman/management", userId])),
    );
    assert.match(connected.managementToken, /^pmm1\./);
    assert.ok(
      connected.expiresAt > Date.now() + 590_000 &&
        connected.expiresAt <= Date.now() + 600_000,
    );
    assert.equal(
      completedPoll.managementHash,
      await digest(connected.managementToken),
    );
    const forgedClaim = { ...completedPoll, claimSecret: randomSecret() };
    await assertError(await request("/auth/poll", forgedClaim), "FORBIDDEN");
    await assertError(
      await request("/auth/poll", {
        ...completedPoll,
        managementHash: randomSecret(),
      }),
      "CONFLICT",
    );
    const pollRetry = await request("/auth/poll", completedPoll);
    assert.equal(pollRetry.status, 200);
    assert.deepEqual(await pollRetry.json(), {
      state: "approved",
      expiresAt: connected.expiresAt,
      operatorId: connected.operatorId,
    });
    const stored = await owner.query<{ hash: string; human_id: string }>(
      "SELECT hash,human_id FROM passman_v1.native_management WHERE id=$1",
      [started.id],
    );
    assert.deepEqual(stored.rows, [
      { hash: await digest(connected.managementToken), human_id: userId },
    ]);
    const records = await owner.query("SELECT * FROM passman_v1.native_logins");
    const events = await owner.query("SELECT * FROM passman_v1.audit_events");
    const serialized = JSON.stringify([stored.rows, records.rows, events.rows]);
    for (const secret of [
      connected.managementToken,
      completedPoll.claimSecret,
      fingerprint,
      browserOwner,
    ]) {
      assert.equal(
        serialized.includes(secret),
        false,
        "native login exposed a secret in storage",
      );
    }
    const bearer = `Bearer ${connected.managementToken}`;
    await assertError(
      await request(
        "/account",
        undefined,
        `Unsafe ${connected.managementToken}`,
      ),
      "UNAUTHORIZED",
    );
    await assertError(
      await request(
        "/account",
        undefined,
        `Bearer pmm1.${started.id}.${randomSecret()}`,
      ),
      "UNAUTHORIZED",
    );

    const management = new ManagementClient({
      origin,
      fetch,
      managementToken: connected.managementToken,
    });
    assert.equal(await management.account(), null);
    const credentials = {
      label: "Synthetic native admin",
      expiresAt: Date.now() + 3_600_000,
    };
    const password = "Synthetic login integration vault password!";
    const prepared = await management.prepareInitialization(
      password,
      credentials,
    );
    await management.initialize(prepared);
    const accounts = await Promise.all(
      Array.from({ length: 9 }, () => management.account()),
    );
    assert.equal(pool.options.max, 3);
    assert.ok(
      accounts.every(
        (account) => account?.accountId === prepared.bundle.anchor.accountId,
      ),
    );
    const newStore = new Map<string, AdminMaterial>();
    const custody = {
      async loadAdmin(selection) {
        return newStore.get(selection.accountId);
      },
      async saveAdmin(material) {
        newStore.set(material.runtime.anchor.accountId, material);
      },
    } satisfies AdminCustody;
    const restored = await management.restoreAdministration(password, custody);
    assert.equal(
      JSON.stringify(restored.signingKey) ===
        JSON.stringify(prepared.admin.signingKey),
      true,
    );
    const recovered = await management.enroll(restored, credentials);
    const admin = new AdminClient({
      origin,
      fetch,
      custody,
      adminKey: recovered,
    });
    assert.equal(
      (await admin.status()).accountId,
      prepared.bundle.anchor.accountId,
    );

    const permanent = await admin.issueServiceKey({
      projects: null,
      expiresAt: null,
      bootstrap: false,
      label: "Synthetic non-expiring read",
    });
    const permanentStatus = await request(
      "/status",
      undefined,
      `Bearer ${permanent}`,
    );
    assert.equal(permanentStatus.status, 200);
    assert.equal(
      z
        .object({ credential: z.object({ expiresAt: z.null() }) })
        .safeParse(await permanentStatus.json()).success,
      true,
    );
    const project = await admin.createProject("synthetic");
    const parentExpiry = Date.now() + 300_000;
    const delegatedKey = await admin.issueAdminKey({
      projects: [project.id],
      expiresAt: parentExpiry,
      operations: ["credentials"],
      label: "Synthetic delegated admin",
    });
    const delegated = new AdminClient({
      origin,
      fetch,
      custody,
      adminKey: delegatedKey,
    });
    const scoped = {
      projects: [project.id],
      bootstrap: false,
      label: "Synthetic delegated read",
    };
    await assert.rejects(
      delegated.issueServiceKey({ ...scoped, expiresAt: null }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      delegated.issueServiceKey({ ...scoped, expiresAt: parentExpiry + 1 }),
      { code: "FORBIDDEN" },
    );
    const expiresAt = parentExpiry - 1;
    const limited = await delegated.issueServiceKey({ ...scoped, expiresAt });
    const limitedStatus = await request(
      "/status",
      undefined,
      `Bearer ${limited}`,
    );
    assert.equal(limitedStatus.status, 200);
    assert.deepEqual(
      z
        .object({
          credential: z.object({
            expiresAt: z.number(),
            projects: z.array(z.uuid()),
          }),
        })
        .parse(await limitedStatus.json()).credential,
      { expiresAt, projects: [project.id] },
    );

    const readResponse = await request(
      "/console/service-keys",
      {
        projects: null,
        expiresAt: null,
        bootstrap: false,
        label: "Synthetic read",
      },
      signedBrowser,
    );
    assert.equal(readResponse.status, 200);
    const { serviceKey } = z
      .object({ serviceKey: z.string() })
      .parse(await readResponse.json());
    await assertError(
      await request("/account", undefined, `Bearer ${serviceKey}`),
      "UNAUTHORIZED",
    );
    const nextId = randomUUID();
    const nextClaim = randomSecret();
    const nextFingerprint = randomSecret();
    const nextStart = await request("/auth/start", {
      id: nextId,
      claimHash: await digest(nextClaim),
      fingerprintHash: await digest(nextFingerprint),
    });
    assert.equal(nextStart.status, 200);
    const next = { id: nextId, fingerprint: nextFingerprint };
    const pending = await request("/auth/poll", {
      id: nextId,
      claimSecret: nextClaim,
      managementHash: randomSecret(),
    });
    assert.equal(pending.status, 200);
    assert.deepEqual(await pending.json(), { state: "pending" });
    await assertError(
      await request(approvePath, next, `Bearer ${serviceKey}`),
      "UNAUTHORIZED",
    );
    await assertError(await request(approvePath, next, bearer), "FORBIDDEN");
    await owner.query(
      "UPDATE passman_v1.native_logins SET expires_at=$2 WHERE id=$1",
      [nextId, Date.now() - 1],
    );
    await assertError(
      await request(approvePath, next, signedBrowser),
      "NOT_FOUND",
    );
    await owner.query(
      "UPDATE passman_v1.native_management SET expires_at=$2 WHERE id=$1",
      [started.id, Date.now() - 1],
    );
    await assertError(
      await request("/account", undefined, bearer),
      "UNAUTHORIZED",
    );
  },
);
