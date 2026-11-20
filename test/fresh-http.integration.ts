import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { SignJWT } from "jose";
import { Pool } from "pg";
import {
  ManagementClient,
  AdminClient,
} from "../packages/passman/src/admin.js";
import {
  UnixAdminCustody,
  UnixRuntimeCustody,
} from "../packages/passman/src/custody.js";
import { RuntimeClient } from "../packages/passman/src/runtime.js";
import {
  grantFreshRuntime,
  migrateFresh,
} from "../apps/web/src/server/fresh/database.js";

const connection = process.env.PASSMAN_TEST_DATABASE_URL;
if (connection && new URL(connection).pathname !== "/passman_v1_test")
  throw new Error("Disposable passman_v1_test database required");
async function port() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const value = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  return value;
}
await test(
  "built Next API verifies Clerk JWTs and restarted CLI retrieves plaintext without prompts",
  {
    skip: !connection
      ? "Run npm run test:fresh:isolated after npm run build"
      : false,
    timeout: 90_000,
  },
  async (t) => {
    const owner = new Pool({ connectionString: connection, max: 2 });
    t.after(() => owner.end());
    await owner.query("DROP SCHEMA IF EXISTS passman_v1 CASCADE");
    await migrateFresh(owner);
    await owner.query("DROP ROLE IF EXISTS passman_fresh_http");
    await owner.query(
      "CREATE ROLE passman_fresh_http LOGIN PASSWORD 'synthetic_http_role'",
    );
    await grantFreshRuntime(owner, "passman_fresh_http");
    const runtimeUrl = new URL(connection!);
    runtimeUrl.username = "passman_fresh_http";
    runtimeUrl.password = "synthetic_http_role";
    const listener = await port(),
      origin = `http://127.0.0.1:${listener}`;
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwt = await new SignJWT({
      sub: "synthetic-http-owner",
      sid: "session-fixture",
      azp: origin,
      fva: [0, -1],
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://clerk.fixture.test")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);
    const root = resolve(import.meta.dirname, "..");
    const child = spawn(
      process.execPath,
      [
        join(root, "node_modules/next/dist/bin/next"),
        "start",
        "--port",
        String(listener),
        "--hostname",
        "127.0.0.1",
      ],
      {
        cwd: join(root, "apps/web"),
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          NEXT_TELEMETRY_DISABLED: "1",
          APP_ORIGIN: origin,
          PASSMAN_DATABASE_URL: runtimeUrl.toString(),
          CLERK_JWT_KEY: keys.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
          CLERK_ISSUER: "https://clerk.fixture.test",
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
        },
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    t.after(async () => {
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(origin + "/api/passman/v1/account", {
          headers: { authorization: `Bearer ${jwt}` },
        });
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {
        /* listener startup */
      }
      if (child.exitCode !== null) break;
      await delay(100);
    }
    assert(ready, "Built Next fresh API started with synthetic Clerk verifier");
    const health = await fetch(origin + "/api/passman/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: "ready",
      version: "1.0.0-alpha.1",
    });
    assert.equal(health.headers.get("cache-control"), "no-store");
    const management = new ManagementClient({ origin, managementToken: jwt });
    const prepared = await management.prepareInitialization(
      "Synthetic HTTP password 123!",
      { label: "HTTP fixture", expiresAt: Date.now() + 86400_000 },
    );
    await management.initialize(prepared);
    const directory = await mkdtemp(
      join(await realpath(tmpdir()), "passman-http-custody-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const adminCustody = new UnixAdminCustody(directory),
      custody = new UnixRuntimeCustody(directory);
    await adminCustody.saveAdmin(prepared.admin);
    await custody.saveRuntime(prepared.admin.runtime);
    const admin = new AdminClient({
      origin,
      adminKey: prepared.adminKey,
      custody: adminCustody,
    });
    const project = await admin.createProject("http-fixture");
    const key = await admin.issueServiceKey({
      label: "http-runtime",
      projects: [project.id],
      expiresAt: null,
      bootstrap: false,
    });
    const value = "Synthetic HTTP value 🔒\nsecond line";
    await admin.createSecret({ project: project.name, name: "TOKEN" }, value);
    assert.equal(
      await new RuntimeClient({ origin, serviceKey: key, custody }).getSecret({
        project: project.name,
        name: "TOKEN",
      }),
      value,
    );
    async function cli(serviceKey: string) {
      const p = spawn(
        process.execPath,
        [
          join(root, "packages/passman/dist/cli.js"),
          "get",
          "--origin",
          origin,
          "--project",
          project.name,
          "--name",
          "TOKEN",
          "--file-mode",
          "--store-dir",
          directory,
        ],
        {
          env: { PATH: process.env.PATH, PASSMAN_SERVICE_KEY: serviceKey },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const stdout: Buffer[] = [],
        stderr: Buffer[] = [];
      p.stdout.on("data", (b: Buffer) => stdout.push(b));
      p.stderr.on("data", (b: Buffer) => stderr.push(b));
      const [code] = await once(p, "exit");
      return {
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
    }
    for (let restart = 0; restart < 2; restart++)
      assert.deepEqual(await cli(key), { code: 0, stdout: value, stderr: "" });
    const tampered = key.slice(0, -2) + (key.endsWith("AA") ? "BA" : "AA"),
      failure = await cli(tampered);
    assert.equal(failure.code, 1);
    assert.equal(failure.stdout, "");
    assert.match(failure.stderr, /UNAUTHORIZED/);
    assert(!failure.stderr.includes(key));
    assert(!failure.stderr.includes(value));
    const bad = await fetch(origin + "/api/passman/v1/administration", {
      headers: { authorization: "Bearer forged-session" },
    });
    assert.equal(bad.status, 401);
    const page = await fetch(origin + "/passman");
    assert.equal(page.status, 200);
    assert(!(await page.text()).includes(value));
    const revoked = await fetch(
      `${origin}/api/passman/v1/console/credentials/${prepared.credential.id}/revoke`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(revoked.status, 200);
    await assert.rejects(admin.status(), { code: "CREDENTIAL_REVOKED" });
  },
);
