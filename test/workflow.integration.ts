import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:net";
import { request as rawRequest } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  createHash,
  createHmac,
  randomUUID,
  generateKeyPairSync,
} from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { SignJWT } from "jose";
import { isReverificationHint } from "@clerk/shared/authorization-errors";
import {
  initializeIdentity,
  saveIdentity,
  unlockIdentity,
  startLogin,
  pollLogin,
  uploadValue,
  KeymanClient,
  KeymanError,
  type Identity,
  type Transport,
} from "@keyman-mvp/client";
import { z, projectSchema } from "@keyman-mvp/core";
import { createApi } from "../apps/web/src/server/api";
import { recordAudit, pruneAudit } from "../apps/web/src/server/audit";
import { clerkWebhook } from "../apps/web/src/server/clerk-webhook";
import { database, migrate } from "../apps/web/src/server/database";
const connection = process.env.MVP_TEST_DATABASE_URL;
if (!connection || new URL(connection).pathname !== "/keyman_mvp_test")
  throw new Error(
    "Set MVP_TEST_DATABASE_URL to a disposable database named keyman_mvp_test; never use the earlier application's database",
  );
await test("MVP: built Next.js, real JWT verification/PostgreSQL enrollment, encrypted local upload, SDK reads, isolation and revocation", async (t) => {
  const owner = database(connection);
  t.after(() => owner.end());
  await migrate(owner);
  await owner.query(
    "TRUNCATE keyman_mvp.audit_events,keyman_mvp.accounts,keyman_mvp.devices,keyman_mvp.limits CASCADE",
  );
  await owner.query(
    "DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='keyman_mvp_test_runtime') THEN CREATE ROLE keyman_mvp_test_runtime LOGIN PASSWORD 'synthetic-mvp-test-password'; END IF; END $$; GRANT USAGE ON SCHEMA keyman_mvp TO keyman_mvp_test_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON keyman_mvp.accounts,keyman_mvp.projects,keyman_mvp.secrets,keyman_mvp.credentials,keyman_mvp.devices,keyman_mvp.limits TO keyman_mvp_test_runtime; GRANT SELECT ON keyman_mvp.migrations TO keyman_mvp_test_runtime; GRANT SELECT,INSERT ON keyman_mvp.audit_events TO keyman_mvp_test_runtime; GRANT USAGE ON SEQUENCE keyman_mvp.audit_events_sequence_seq TO keyman_mvp_test_runtime;",
  );
  const runtimeUrl = new URL(connection);
  runtimeUrl.username = "keyman_mvp_test_runtime";
  runtimeUrl.password = "synthetic-mvp-test-password";
  const pool = database(runtimeUrl.toString());
  t.after(() => pool.end());
  await assert.rejects(
    pool.query("CREATE TABLE keyman_mvp.forbidden(id integer)"),
  );
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`,
    keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const root = fileURLToPath(new URL("../", import.meta.url));
  mkdirSync(path.join(root, "ignore-docs"), { recursive: true, mode: 0o700 });
  const log = openSync(
    path.join(root, "ignore-docs/next-integration.log"),
    "w",
    0o600,
  );
  const web = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/next/dist/bin/next"),
      "start",
      "--port",
      String(port),
      "--hostname",
      "127.0.0.1",
    ],
    {
      cwd: path.join(root, "apps/web"),
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        APP_ORIGIN: origin,
        DATABASE_URL: runtimeUrl.toString(),
        CLERK_JWT_KEY: keys.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
        CLERK_ISSUER: "https://clerk.test",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      },
      stdio: ["ignore", log, log],
    },
  );
  closeSync(log);
  t.after(async () => {
    if (web.exitCode === null && web.signalCode === null) {
      const exited = once(web, "exit");
      web.kill("SIGTERM");
      await exited;
    }
  });
  let ready = false;
  let readinessStatus: number | undefined;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(origin + "/api/health");
      readinessStatus = r.status;
      if (r.status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the isolated Next.js server. */
    }
    await delay(100);
  }
  assert.equal(
    ready,
    true,
    `Built Next.js API did not become ready (HTTP ${readinessStatus}); inspect restricted test log`,
  );
  assert.equal((await fetch(origin + "/")).status, 200);
  const spoofedHost = await new Promise<number | undefined>(
    (resolve, reject) => {
      const req = rawRequest(
        origin + "/api/health",
        { headers: { host: "untrusted.invalid" } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end();
    },
  );
  assert.equal(spoofedHost, 400);
  assert.equal(
    (
      await fetch(origin + "/api/health", {
        headers: {
          "x-forwarded-host": "untrusted.invalid",
          "x-forwarded-proto": "https",
        },
      })
    ).status,
    200,
  );
  const captured: string[] = [];
  const transport: Transport = async (url, init) => {
    captured.push(
      JSON.stringify({
        url: String(url),
        headers: init?.headers,
        body: init?.body,
      }),
    );
    return fetch(url, init);
  };
  async function human(
    route: string,
    payload?: unknown,
    user = "alice",
    recent = true,
  ) {
    return fetch(origin + route, {
      method: payload === undefined ? "GET" : "POST",
      headers: {
        authorization:
          "Bearer " +
          (await new SignJWT({
            sub: "user_" + user,
            sid: "session_" + user,
            azp: origin,
            fva: [recent ? 0 : 11, -1],
          })
            .setProtectedHeader({ alg: "RS256" })
            .setIssuer("https://clerk.test")
            .setIssuedAt()
            .setExpirationTime("2m")
            .sign(keys.privateKey)),
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  }
  const directories: string[] = [];
  t.after(async () => {
    for (const dir of directories)
      await rm(dir, { recursive: true, force: true });
  });
  async function identity() {
    const dir = await mkdtemp(path.join(tmpdir(), "keyman-mvp-e2e-"));
    directories.push(dir);
    return {
      dir,
      identity: await initializeIdentity(
        dir,
        "synthetic-local-passphrase",
        origin,
      ),
    };
  }
  async function enroll(profile: Identity, user = "alice") {
    const pending = await startLogin(profile, transport);
    assert.equal(
      await pollLogin(profile, pending.deviceCode, transport),
      undefined,
    );
    assert.equal(
      (
        await human(
          "/api/device/approve",
          {
            id: pending.id,
            keyId: pending.keyId,
            userCode: "0".repeat(12),
            acknowledgeLoss: true,
          },
          user,
        )
      ).status,
      403,
    );
    const stale = await human(
      "/api/device/approve",
      {
        id: pending.id,
        keyId: pending.keyId,
        userCode: pending.userCode,
        acknowledgeLoss: true,
      },
      user,
      false,
    );
    assert.equal(stale.status, 403);
    assert.equal(isReverificationHint(await stale.json()), true);
    const response = await human(
      "/api/device/approve",
      {
        id: pending.id,
        keyId: pending.keyId,
        userCode: pending.userCode,
        acknowledgeLoss: true,
      },
      user,
    );
    assert.equal(response.status, 200);
    const linked = await pollLogin(profile, pending.deviceCode, transport);
    assert.ok(linked?.vault);
    await assert.rejects(pollLogin(profile, pending.deviceCode, transport));
    return linked;
  }
  const first = await identity();
  const alice = await enroll(first.identity);
  await saveIdentity(first.dir, "synthetic-local-passphrase", alice);
  assert.deepEqual(
    await unlockIdentity(first.dir, "synthetic-local-passphrase", {
      administrative: true,
    }),
    alice,
  );
  assert.equal(
    (await unlockIdentity(first.dir, "synthetic-local-passphrase")).upload,
    undefined,
  );
  const pResponse = await human("/api/console/projects", {
    name: "production",
  });
  assert.equal(pResponse.status, 201);
  const p = projectSchema.parse(await pResponse.json());
  const readResponse = await human("/api/console/credentials", {
    label: "Runtime",
    projectId: p.id,
    days: 1,
  });
  assert.equal(readResponse.status, 201);
  const read = z
    .object({ id: z.string(), token: z.string() })
    .parse(await readResponse.json());
  const value = "synthetic-provider-value-not-for-logs";
  await uploadValue(
    alice,
    "production",
    "PROVIDER_KEY",
    value,
    false,
    transport,
  );
  await assert.rejects(
    uploadValue(
      alice,
      "production",
      "PROVIDER_KEY",
      "must-not-overwrite",
      false,
      transport,
    ),
  );
  const client = new KeymanClient({
    identity: alice,
    serviceKey: read.token,
    project: "production",
    transport,
  });
  assert.equal(await client.getSecret({ name: "PROVIDER_KEY" }), value);
  assert.equal(await client.hasSecret({ name: "PROVIDER_KEY" }), true);
  assert.equal(await client.hasSecret({ name: "MISSING" }), false);
  await assert.rejects(
    client.getSecret({ name: "MISSING" }),
    (e: unknown) => e instanceof KeymanError && e.code === "NOT_FOUND",
  );
  assert.deepEqual(
    (await client.search()).items.map((i) => i.name),
    ["PROVIDER_KEY"],
  );
  await uploadValue(
    alice,
    "production",
    "PROVIDER_KEY",
    "synthetic-updated-value",
    true,
    transport,
  );
  assert.equal(
    await client.getSecret({ name: "PROVIDER_KEY" }),
    "synthetic-updated-value",
  );
  const another = await identity(),
    bob = await enroll(another.identity, "bob");
  await human("/api/console/projects", { name: "production" }, "bob");
  const wrongDevice = await identity(),
    pending = await startLogin(wrongDevice.identity, transport);
  assert.equal(
    (
      await human("/api/device/approve", {
        id: pending.id,
        keyId: pending.keyId,
        userCode: pending.userCode,
        acknowledgeLoss: true,
      })
    ).status,
    409,
  );
  assert.equal(
    await pollLogin(wrongDevice.identity, pending.deviceCode, transport),
    undefined,
  );
  const readOnlyWrite = await fetch(origin + "/api/upload", {
    method: "POST",
    headers: {
      authorization: "Bearer " + read.token,
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(readOnlyWrite.status, 401);
  assert.equal(
    (
      await fetch(origin + "/api/console/projects", {
        method: "POST",
        headers: {
          authorization: "Bearer " + read.token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "forbidden" }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await human(
        "/api/console/credentials",
        { label: "foreign", projectId: p.id, days: 1 },
        "bob",
      )
    ).status,
    404,
  );
  const unrelatedProject = projectSchema.parse(
    await (await human("/api/console/projects", { name: "other" })).json(),
  );
  await assert.rejects(
    new KeymanClient({
      identity: alice,
      serviceKey: read.token,
      project: unrelatedProject.name,
      transport,
    }).search(),
  );
  await assert.rejects(
    new KeymanClient({
      identity: bob,
      serviceKey: read.token,
      project: "production",
      transport,
    }).getSecret({ name: "PROVIDER_KEY" }),
    (e: unknown) => e instanceof KeymanError && e.code === "KEY_MISMATCH",
  );
  await t.test(
    "actual CLI reuses its identity, completes browser approval, uploads and searches without printing values",
    async () => {
      const passwordFile = path.join(first.dir, "test-passphrase"),
        valueFile = path.join(first.dir, "test-value");
      await writeFile(passwordFile, "synthetic-local-passphrase", {
        mode: 0o600,
      });
      await writeFile(valueFile, "synthetic-cli-provider-value", {
        mode: 0o600,
      });
      const cli = path.join(root, "packages/client/dist/cli.js");
      const common = [
        "--directory",
        first.dir,
        "--passphrase-file",
        passwordFile,
      ];
      const login = spawn(
        process.execPath,
        [cli, "login", "--url", origin, "--no-browser", ...common],
        {
          env: { PATH: process.env.PATH ?? "" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      t.after(async () => {
        if (login.exitCode === null && login.signalCode === null) {
          const end = once(login, "exit");
          login.kill("SIGTERM");
          await end;
        }
      });
      let output = "";
      const pending = await new Promise<{ id: string; code: string }>(
        (resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("CLI login prompt timed out")),
            10000,
          );
          login.stdout.on("data", (chunk: Buffer) => {
            output += chunk.toString();
            const code = /Approval code: ([a-f0-9]{12})/.exec(output)?.[1],
              id = /\?device=([0-9a-f-]{36})/.exec(output)?.[1];
            if (code && id) {
              clearTimeout(timer);
              resolve({ code, id });
            }
          });
          login.on("error", () => {
            clearTimeout(timer);
            reject(new Error("CLI startup failed"));
          });
        },
      );
      const exited = once(login, "exit");
      assert.equal(
        (
          await human("/api/device/approve", {
            id: pending.id,
            keyId: alice.keyId,
            userCode: pending.code,
            acknowledgeLoss: true,
          })
        ).status,
        200,
      );
      const [exitCode] = await exited;
      assert.equal(exitCode, 0);
      const reopened = await unlockIdentity(
        first.dir,
        "synthetic-local-passphrase",
      );
      assert.equal(reopened.privateKey.d, alice.privateKey.d);
      async function run(args: string[]) {
        const child = spawn(process.execPath, [cli, ...args, ...common], {
          env: { PATH: process.env.PATH ?? "", KEYMAN_SERVICE_KEY: read.token },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let text = "";
        child.stdout.on("data", (v: Buffer) => {
          text += v.toString();
        });
        const [code] = await once(child, "exit");
        assert.equal(code, 0);
        assert.equal(text.includes("synthetic-cli-provider-value"), false);
        assert.equal(text.includes(read.token), false);
        return text;
      }
      assert.match(
        await run([
          "put",
          "--project",
          "production",
          "--name",
          "CLI_VALUE",
          "--value-file",
          valueFile,
        ]),
        /Stored encrypted value/,
      );
      assert.equal(
        await client.getSecret({ name: "CLI_VALUE" }),
        "synthetic-cli-provider-value",
      );
      assert.match(
        await run(["check", "--project", "production", "--name", "CLI_VALUE"]),
        /Found/,
      );
    },
  );
  await t.test(
    "expired requests and read credentials fail, and stale updates preserve the committed record",
    async () => {
      await owner.query(
        "UPDATE keyman_mvp.devices SET expires_at=1 WHERE id=$1",
        [pending.id],
      );
      await assert.rejects(
        pollLogin(wrongDevice.identity, pending.deviceCode, transport),
        (e: unknown) => e instanceof KeymanError && e.code === "EXPIRED",
      );
      const credential = z.object({ id: z.string(), token: z.string() }).parse(
        await (
          await human("/api/console/credentials", {
            label: "Expiry test",
            projectId: p.id,
            days: 1,
          })
        ).json(),
      );
      await owner.query(
        "UPDATE keyman_mvp.credentials SET expires_at=1 WHERE id=$1",
        [credential.id],
      );
      await assert.rejects(
        new KeymanClient({
          identity: alice,
          serviceKey: credential.token,
          project: "production",
          transport,
        }).search(),
      );
      const row = (
        await owner.query<{ envelope: unknown }>(
          "SELECT envelope FROM keyman_mvp.secrets WHERE project_id=$1 AND name='PROVIDER_KEY'",
          [p.id],
        )
      ).rows[0]!;
      const conflict = await fetch(origin + "/api/upload", {
        method: "POST",
        headers: {
          authorization: "Bearer " + alice.upload!.token,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId: p.id,
          name: "PROVIDER_KEY",
          expectedRevision: 0,
          envelope: row.envelope,
        }),
      });
      assert.equal(conflict.status, 409);
      assert.equal(
        await client.getSecret({ name: "PROVIDER_KEY" }),
        "synthetic-updated-value",
      );
    },
  );
  const revoke = await human("/api/console/revoke", { id: read.id });
  assert.equal(revoke.status, 200);
  await assert.rejects(client.getSecret({ name: "PROVIDER_KEY" }));
  const persisted = JSON.stringify(
    (await owner.query("SELECT * FROM keyman_mvp.secrets")).rows,
  );
  assert.equal(persisted.includes(value), false);
  assert.equal(persisted.includes("synthetic-updated-value"), false);
  assert.equal(persisted.includes("synthetic-cli-provider-value"), false);
  assert.equal(persisted.includes("PROVIDER_KEY"), true);
  const credentials = JSON.stringify(
    (await owner.query("SELECT * FROM keyman_mvp.credentials")).rows,
  );
  assert.equal(credentials.includes(read.token), false);
  assert.equal(credentials.includes(alice.upload!.token), false);
  assert.ok(
    credentials.includes(createHash("sha256").update(read.token).digest("hex")),
  );
  const requests = captured.join("\n");
  assert.equal(requests.includes(value), false);
  assert.equal(requests.includes(alice.privateKey.d), false);
  const serverLog = await readFile(
    path.join(root, "ignore-docs/next-integration.log"),
    "utf8",
  );
  for (const secret of [
    value,
    "synthetic-updated-value",
    "synthetic-cli-provider-value",
    alice.privateKey.d,
    read.token,
  ])
    assert.equal(serverLog.includes(secret), false);
  assert.equal(
    (await readFile(path.join(first.dir, "vault.json"), "utf8")).includes(
      alice.privateKey.d,
    ),
    false,
  );
  const before = (
    await owner.query(
      "SELECT id,vault_id,key_id FROM keyman_mvp.accounts ORDER BY id",
    )
  ).rows;
  await migrate(owner);
  assert.deepEqual(
    (
      await owner.query(
        "SELECT id,vault_id,key_id FROM keyman_mvp.accounts ORDER BY id",
      )
    ).rows,
    before,
  );
  const noAuth = await fetch(origin + "/api/v1/search?project=production");
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.headers.get("cache-control"), "private, no-store");
  await t.test(
    "audit: isolation, redaction, atomic rollback, denial durability, concurrent requests, retention and signed webhook retries",
    async () => {
      const activity = await human("/api/console/activity");
      assert.equal(activity.status, 200);
      assert.equal(
        (
          await fetch(origin + "/api/console/activity", {
            headers: { authorization: "Bearer " + read.token },
          })
        ).status,
        401,
      );
      assert.ok(activity.headers.get("x-request-id"));
      const page = await activity.json();
      assert.ok(
        page.items.some(
          (e: { action: string }) => e.action === "secret.retrieve",
        ),
      );
      assert.ok(
        page.items.some((e: { outcome: string }) => e.outcome === "denied"),
      );
      const bobPage = await (
        await human("/api/console/activity", undefined, "bob")
      ).json();
      const aliceIds = new Set(
        page.items.map((e: { event_id: string }) => e.event_id),
      );
      assert.ok(
        bobPage.items.every(
          (e: { event_id: string }) => !aliceIds.has(e.event_id),
        ),
      );
      const serialized = JSON.stringify(
        (await owner.query("SELECT * FROM keyman_mvp.audit_events")).rows,
      );
      for (const secret of [
        value,
        "synthetic-updated-value",
        alice.privateKey.d,
        read.token,
        alice.upload!.token,
      ])
        assert.equal(serialized.includes(secret), false);
      await assert.rejects(pool.query("DELETE FROM keyman_mvp.audit_events"));
      await assert.rejects(
        pool.query("UPDATE keyman_mvp.audit_events SET reason='OK'"),
      );
      const direct = createApi({
        pool,
        origin,
        authenticate: async (request) => ({
          id:
            request.headers.get("x-test-user") === "bob"
              ? "user_bob"
              : "user_alice",
          recent: true,
        }),
      });
      const invoke = (name: string, user = "alice") =>
        direct(
          new Request(origin + "/api/console/projects", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-test-user": user,
            },
            body: JSON.stringify({ name }),
          }),
        );
      const concurrent = await Promise.all([
        invoke("audit-a1"),
        invoke("audit-b1", "bob"),
        invoke("audit-a2"),
        invoke("audit-b2", "bob"),
      ]);
      assert.ok(concurrent.every((r) => r.status === 201));
      for (const response of concurrent) {
        const event = (
          await owner.query(
            "SELECT actor_id,resource_id FROM keyman_mvp.audit_events WHERE request_id=$1",
            [response.headers.get("x-request-id")],
          )
        ).rows;
        assert.equal(event.length, 1);
        const resource = await response.json();
        assert.equal(event[0].resource_id, resource.id);
        assert.equal(
          event[0].actor_id,
          resource.name.includes("-b") ? "user_bob" : "user_alice",
        );
      }
      // A failed transactional audit INSERT must roll back the project itself.
      await owner.query(
        "REVOKE INSERT ON keyman_mvp.audit_events FROM keyman_mvp_test_runtime",
      );
      try {
        assert.equal((await invoke("must-rollback")).status, 503);
        assert.equal(
          (await direct(new Request(origin + "/api/console/activity"))).status,
          503,
        );
      } finally {
        await owner.query(
          "GRANT INSERT ON keyman_mvp.audit_events TO keyman_mvp_test_runtime",
        );
      }
      assert.equal(
        (
          await owner.query(
            "SELECT 1 FROM keyman_mvp.projects WHERE name='must-rollback'",
          )
        ).rowCount,
        0,
      );
      const denied = await invoke("production");
      assert.equal(denied.status, 409);
      assert.equal(
        (
          await owner.query(
            "SELECT outcome FROM keyman_mvp.audit_events WHERE request_id=$1",
            [denied.headers.get("x-request-id")],
          )
        ).rows[0].outcome,
        "denied",
      );
      const accountId = alice.vault!.accountId;
      await Promise.all(
        Array.from({ length: 60 }, () =>
          recordAudit(
            owner,
            {
              requestId: randomUUID(),
              action: "secret.exists",
              actorId: "user_alice",
              accountId,
            },
            "success",
            "OK",
          ),
        ),
      );
      const firstPage = await (
        await human("/api/console/activity?action=secret.exists")
      ).json();
      assert.equal(firstPage.items.length, 50);
      assert.ok(firstPage.nextCursor);
      const secondPage = await (
        await human(
          "/api/console/activity?action=secret.exists&before=" +
            firstPage.nextCursor,
        )
      ).json();
      const seen = new Set(
        firstPage.items.map((e: { event_id: string }) => e.event_id),
      );
      assert.ok(
        secondPage.items.every(
          (e: { event_id: string }) => !seen.has(e.event_id),
        ),
      );
      assert.equal(
        (await human("/api/console/activity?before=-1")).status,
        400,
      );
      const deniedOnly = await (
        await human("/api/console/activity?outcome=denied")
      ).json();
      assert.ok(
        deniedOnly.items.every(
          (e: { outcome: string }) => e.outcome === "denied",
        ),
      );
      // Anonymous inputs never enter event text; repeated attacks are bounded per minute.
      const anonymousTime = Date.now();
      const clock = t.mock.method(Date, "now", () => anonymousTime);
      await Promise.all(
        Array.from({ length: 8 }, () =>
          direct(
            new Request(origin + "/api/v1/search", {
              headers: { authorization: "Bearer unsafe-synthetic-token" },
            }),
          ),
        ),
      );
      clock.mock.restore();
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS n FROM keyman_mvp.audit_events WHERE dedupe_key=$1",
            [
              `anonymous:${Math.floor(anonymousTime / 60000)}:secret.search:denied:UNAUTHORIZED`,
            ],
          )
        ).rows[0].n,
        1,
      );
      const webhookSecret =
        "whsec_" +
        Buffer.from("synthetic-webhook-signing-secret").toString("base64");
      const webhook = clerkWebhook(pool, webhookSecret);
      let deliveryId = "msg_synthetic_audit";
      const payload = JSON.stringify({
        type: "session.revoked",
        data: {
          user_id: "user_alice",
          id: "sess_synthetic",
          sensitive: "never-log-webhook-payload",
        },
      });
      const request = (
        timestamp = Math.floor(Date.now() / 1000),
        forged = false,
      ) =>
        new Request(origin + "/api/webhooks/clerk", {
          method: "POST",
          headers: {
            "svix-id": deliveryId,
            "svix-timestamp": String(timestamp),
            "svix-signature":
              "v1," +
              createHmac(
                "sha256",
                Buffer.from("synthetic-webhook-signing-secret"),
              )
                .update(
                  deliveryId +
                    "." +
                    timestamp +
                    "." +
                    (forged ? "wrong" : payload),
                )
                .digest("base64"),
          },
          body: payload,
        });
      assert.equal((await webhook(request(undefined, true))).status, 400);
      assert.equal((await webhook(request(1))).status, 400);
      assert.ok(
        (await Promise.all([webhook(request()), webhook(request())])).every(
          (r) => r.status === 204,
        ),
      );
      assert.equal(
        (
          await owner.query(
            "SELECT 1 FROM keyman_mvp.audit_events WHERE dedupe_key=$1",
            ["clerk:" + deliveryId],
          )
        ).rowCount,
        1,
      );
      assert.equal(
        JSON.stringify(
          (await owner.query("SELECT * FROM keyman_mvp.audit_events")).rows,
        ).includes("never-log-webhook-payload"),
        false,
      );
      assert.equal(
        (await clerkWebhook(pool, undefined)(request())).status,
        503,
      );
      deliveryId = "msg_retry_after_failure";
      await owner.query(
        "REVOKE INSERT ON keyman_mvp.audit_events FROM keyman_mvp_test_runtime",
      );
      try {
        assert.equal((await webhook(request())).status, 503);
      } finally {
        await owner.query(
          "GRANT INSERT ON keyman_mvp.audit_events TO keyman_mvp_test_runtime",
        );
      }
      assert.equal((await webhook(request())).status, 204);
      // Retention assertion below expires the original delivery only.
      deliveryId = "msg_synthetic_audit";
      assert.equal(
        (
          await webhook(
            new Request(origin + "/api/webhooks/clerk", {
              method: "POST",
              body: "x".repeat(120001),
            }),
          )
        ).status,
        413,
      );

      await owner.query(
        "UPDATE keyman_mvp.audit_events SET occurred_at=now()-interval '91 days' WHERE dedupe_key=$1",
        ["clerk:" + deliveryId],
      );
      assert.equal((await pruneAudit(owner)).rowCount, 1);
      await assert.rejects(pruneAudit(owner, 0));
      assert.ok(
        (await owner.query("SELECT 1 FROM keyman_mvp.audit_events LIMIT 1"))
          .rowCount,
      );
    },
  );
});
