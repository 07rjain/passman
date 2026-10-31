import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:net";
import { request as rawRequest } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, generateKeyPairSync } from "node:crypto";
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
    "TRUNCATE keyman_mvp.accounts,keyman_mvp.devices,keyman_mvp.limits CASCADE",
  );
  await owner.query(
    "DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='keyman_mvp_test_runtime') THEN CREATE ROLE keyman_mvp_test_runtime LOGIN PASSWORD 'synthetic-mvp-test-password'; END IF; END $$; GRANT USAGE ON SCHEMA keyman_mvp TO keyman_mvp_test_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON keyman_mvp.accounts,keyman_mvp.projects,keyman_mvp.secrets,keyman_mvp.credentials,keyman_mvp.devices,keyman_mvp.limits TO keyman_mvp_test_runtime; GRANT SELECT ON keyman_mvp.migrations TO keyman_mvp_test_runtime;",
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
});
