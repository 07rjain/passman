import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  initializeIdentity,
  saveIdentity,
  unlockIdentity,
  KeymanError,
  type Transport,
} from "../packages/client/src/index";
import { runCli, cliErrorMessage } from "../packages/client/src/cli-runner";
import { decryptValue, generateIdentity } from "@keyman-mvp/core";
import { windowsPrivatePath } from "../packages/client/src/windows";

async function fixture(t: { after: (cleanup: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(tmpdir(), "passman-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  if (process.platform === "win32") await windowsPrivatePath(directory, true);
  const password = "synthetic-cli-passphrase";
  const identity = await initializeIdentity(
    directory,
    password,
    "https://cli.test",
  );
  identity.vault = {
    id: randomUUID(),
    accountId: randomUUID(),
    publicKey: identity.publicKey,
    keyId: identity.keyId,
  };
  identity.upload = {
    token: "kmu_" + "a".repeat(43),
    expiresAt: Math.floor(Date.now() / 1000) - 60,
  };
  await saveIdentity(directory, password, identity);
  const passwordFile = path.join(directory, "passphrase");
  await writeFile(passwordFile, password, { mode: 0o600 });
  if (process.platform === "win32")
    await windowsPrivatePath(passwordFile, true);
  const args = [
    "put",
    "--directory",
    directory,
    "--passphrase-file",
    passwordFile,
    "--project",
    "Explorer",
    "--name",
    "npm",
  ];
  return { directory, password, identity, passwordFile, args };
}

test("expired noninteractive put explains login before reading a value and preserves the vault", async (t) => {
  const f = await fixture(t);
  const before = await readFile(path.join(f.directory, "vault.json"));
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "packages/client/src/cli.ts",
      ...f.args,
      "--value-file",
      path.join(f.directory, "missing-value"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /upload authorization.*expired/i);
  assert.match(result.stderr, /passman login/);
  assert.ok(!result.stdout.includes("Secret value"));
  assert.ok(!result.stderr.includes(f.password));
  assert.deepEqual(
    await readFile(path.join(f.directory, "vault.json")),
    before,
  );
});

test("wrong local passphrase has a vault-specific error and preserves the identity", async (t) => {
  const f = await fixture(t);
  const before = await readFile(path.join(f.directory, "vault.json"));
  await writeFile(f.passwordFile, "synthetic-wrong-passphrase");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "packages/client/src/cli.ts", ...f.args],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /local vault/i);
  assert.match(result.stderr, /passphrase/i);
  assert.ok(!result.stderr.includes("synthetic-wrong-passphrase"));
  assert.ok(!result.stdout.includes("Secret value"));
  assert.deepEqual(
    await readFile(path.join(f.directory, "vault.json")),
    before,
  );
});

function harness(f: Awaited<ReturnType<typeof fixture>>) {
  const events: string[] = [],
    output: string[] = [];
  const projectId = randomUUID(),
    deviceId = randomUUID();
  const secret = "synthetic-cli-secret-value";
  const renewedToken = "kmu_" + "b".repeat(43);
  let expiresAt = Math.floor(Date.now() / 1000) + 1200;
  const approvedVault = { ...f.identity.vault! };
  const transport: Transport = async (url, init) => {
    const pathname = new URL(String(url)).pathname;
    events.push(pathname);
    const body = String(init?.body ?? "");
    assert.ok(!body.includes(secret));
    assert.ok(!body.includes(f.password));
    assert.ok(!body.includes(f.identity.privateKey.d));
    if (pathname === "/api/device/start") {
      assert.deepEqual(JSON.parse(body), { publicKey: f.identity.publicKey });
      return Response.json({
        id: deviceId,
        deviceCode: "a".repeat(43),
        userCode: "a".repeat(12),
        keyId: f.identity.keyId,
        verificationUrl: f.identity.origin + "/?device=" + deviceId,
        expiresIn: 600,
        interval: 1,
      });
    }
    if (pathname === "/api/device/poll")
      return Response.json({
        status: "approved",
        vault: approvedVault,
        uploadToken: renewedToken,
        expiresAt,
      });
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer " +
        (events.includes("/api/device/poll")
          ? renewedToken
          : f.identity.upload!.token),
    );
    if (pathname === "/api/upload/context")
      return Response.json({
        vault: f.identity.vault,
        project: { id: projectId, name: "Explorer" },
        revision: 0,
      });
    if (pathname === "/api/upload/import-context") {
      const input = JSON.parse(body);
      return Response.json({
        vault: f.identity.vault,
        project: { id: projectId, name: "Explorer" },
        entries: input.names.map((name: string) => ({ name, revision: 0 })),
      });
    }
    if (pathname === "/api/upload/import") {
      const input = JSON.parse(body);
      for (const entry of input.entries)
        assert.equal(
          await decryptValue(entry.envelope, f.identity.privateKey, {
            version: 1,
            accountId: f.identity.vault!.accountId,
            vaultId: f.identity.vault!.id,
            projectId,
            project: "Explorer",
            name: entry.name,
            revision: 1,
          }),
          secret,
        );
      return Response.json({
        imported: input.entries.map((entry: { name: string }) => ({
          name: entry.name,
          revision: 1,
        })),
      });
    }
    assert.equal(pathname, "/api/upload");
    const uploaded = JSON.parse(body);
    assert.equal(
      await decryptValue(uploaded.envelope, f.identity.privateKey, {
        version: 1,
        accountId: f.identity.vault!.accountId,
        vaultId: f.identity.vault!.id,
        projectId,
        project: "Explorer",
        name: "npm",
        revision: 1,
      }),
      secret,
    );
    return Response.json({ name: "npm", revision: 1 });
  };
  return {
    events,
    output,
    secret,
    renewedToken,
    approvedVault,
    transport,
    expireApproval() {
      expiresAt = Math.floor(Date.now() / 1000) - 60;
    },
    runtime: {
      interactive: true,
      transport,
      print(message: string) {
        output.push(message);
      },
      openBrowser(url: string) {
        assert.equal(url, f.identity.origin + "/?device=" + deviceId);
        events.push("browser");
      },
      async prompt(label: string) {
        assert.match(label, /Secret value/);
        events.push("secret");
        return secret;
      },
    },
  };
}

for (const missing of [false, true]) {
  test(`interactive put renews ${missing ? "missing" : "expired"} authorization before secret input with the same identity`, async (t) => {
    const f = await fixture(t);
    if (missing) {
      delete f.identity.upload;
      await saveIdentity(f.directory, f.password, f.identity);
    }
    const h = harness(f);
    const originalPrompt = h.runtime.prompt;
    h.runtime.prompt = async (label) => {
      const saved = await unlockIdentity(f.directory, f.password, {
        administrative: true,
      });
      assert.deepEqual(saved.privateKey, f.identity.privateKey);
      assert.deepEqual(saved.publicKey, f.identity.publicKey);
      assert.deepEqual(saved.vault, f.identity.vault);
      assert.equal(saved.origin, f.identity.origin);
      assert.equal(saved.upload?.token, h.renewedToken);
      return originalPrompt(label);
    };
    await runCli(f.args, h.runtime);
    assert.deepEqual(h.events, [
      "/api/device/start",
      "browser",
      "/api/device/poll",
      "secret",
      "/api/upload/context",
      "/api/upload",
    ]);
    assert.match(h.output.join("\n"), /Stored encrypted value/);
    const disk = await readFile(path.join(f.directory, "vault.json"), "utf8");
    for (const sensitive of [
      f.password,
      f.identity.privateKey.d,
      h.renewedToken,
      h.secret,
    ]) {
      assert.ok(!disk.includes(sensitive));
      assert.ok(!h.output.join("\n").includes(sensitive));
    }
  });
}

test("valid authorization skips browser approval and does not rewrite the vault", async (t) => {
  const f = await fixture(t);
  f.identity.upload!.expiresAt = Math.floor(Date.now() / 1000) + 1200;
  await saveIdentity(f.directory, f.password, f.identity);
  const before = await readFile(path.join(f.directory, "vault.json"));
  const h = harness(f);
  await runCli(f.args, h.runtime);
  assert.deepEqual(h.events, ["secret", "/api/upload/context", "/api/upload"]);
  assert.deepEqual(
    await readFile(path.join(f.directory, "vault.json")),
    before,
  );
});

test("put --no-browser prints approval details and renews without launching a browser", async (t) => {
  const f = await fixture(t),
    h = harness(f);
  await runCli([...f.args, "--no-browser"], h.runtime);
  assert.ok(!h.events.includes("browser"));
  assert.match(
    h.output.join("\n"),
    /Vault fingerprint:.*\nApproval code:.*\nOpen: https:\/\/cli.test\/\?device=/,
  );
  assert.ok(h.events.indexOf("/api/device/poll") < h.events.indexOf("secret"));
});

for (const failure of [
  "denied",
  "expired",
  "network",
  "wrong-account",
  "wrong-vault",
  "wrong-key",
  "clock",
] as const) {
  test(`renewal failure (${failure}) reads no secret and preserves the vault`, async (t) => {
    const f = await fixture(t),
      h = harness(f);
    const before = await readFile(path.join(f.directory, "vault.json"));
    if (failure === "clock") h.expireApproval();
    if (failure === "wrong-account") h.approvedVault.accountId = randomUUID();
    if (failure === "wrong-vault") h.approvedVault.id = randomUUID();
    if (failure === "wrong-key") {
      const other = await generateIdentity();
      h.approvedVault.publicKey = other.publicKey;
      h.approvedVault.keyId = other.keyId;
    }
    h.runtime.transport = async (url, init) => {
      if (String(url).endsWith("/api/device/poll")) {
        if (failure === "network")
          throw new Error("synthetic-sensitive-network-error");
        if (failure === "denied" || failure === "expired")
          return Response.json(
            {
              error: {
                code: failure === "denied" ? "FORBIDDEN" : "EXPIRED",
                message: "Synthetic denial",
              },
            },
            { status: 403 },
          );
      }
      return h.transport(url, init);
    };
    const args =
      failure === "denied" || failure === "clock"
        ? [...f.args, "--value-file", path.join(f.directory, "missing-value")]
        : f.args;
    await assert.rejects(runCli(args, h.runtime), (error: unknown) => {
      const safe = cliErrorMessage(error, "put");
      assert.ok(!safe.includes("synthetic-sensitive"));
      if (failure === "clock") assert.match(safe, /date\/time.*passman login/);
      else {
        assert.ok(error instanceof KeymanError);
        assert.equal(
          error.code,
          failure === "denied"
            ? "FORBIDDEN"
            : failure === "expired"
              ? "EXPIRED"
              : failure === "network"
                ? "UNAVAILABLE"
                : "KEY_MISMATCH",
        );
      }
      return true;
    });
    assert.equal(h.events.filter((e) => e === "/api/device/start").length, 1);
    assert.ok(!h.events.includes("secret"));
    assert.ok(!h.events.includes("/api/upload/context"));
    assert.deepEqual(
      await readFile(path.join(f.directory, "vault.json")),
      before,
    );
  });
}

test("pending approval stops at its deadline without reading a secret or replacing the vault", async (t) => {
  const f = await fixture(t),
    h = harness(f);
  const before = await readFile(path.join(f.directory, "vault.json"));
  // Advance the logical clock from the pending response, instead of relying on
  // a one-second OS timer waking at exactly its requested deadline.
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  h.runtime.transport = async (url, init) => {
    if (String(url).endsWith("/api/device/poll")) {
      h.events.push("pending");
      now += 1000;
      return Response.json({ status: "pending" });
    }
    const response = await h.transport(url, init);
    return Response.json({ ...(await response.json()), expiresIn: 1 });
  };
  await assert.rejects(
    runCli(f.args, h.runtime),
    (error: unknown) =>
      error instanceof KeymanError && error.code === "EXPIRED",
  );
  assert.deepEqual(h.events, ["/api/device/start", "browser", "pending"]);
  assert.deepEqual(
    await readFile(path.join(f.directory, "vault.json")),
    before,
  );
});

test("authorization rejected by the server has login guidance and no automatic upload replay", async (t) => {
  const f = await fixture(t),
    h = harness(f);
  f.identity.upload!.expiresAt = Math.floor(Date.now() / 1000) + 1200;
  await saveIdentity(f.directory, f.password, f.identity);
  h.runtime.transport = async (url, init) => {
    if (!String(url).endsWith("/api/upload")) return h.transport(url, init);
    h.events.push("rejected");
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "Synthetic denial" } },
      { status: 401 },
    );
  };
  await assert.rejects(runCli(f.args, h.runtime), (error: unknown) => {
    assert.match(cliErrorMessage(error, "put"), /passman login/);
    return true;
  });
  assert.deepEqual(h.events, ["secret", "/api/upload/context", "rejected"]);
});

test("CLI import renews before file input, previews without values, dry-runs, confirms and cancels safely", async (t) => {
  const f = await fixture(t),
    h = harness(f);
  const file = path.join(f.directory, ".env");
  const args = ["import", ...f.args.slice(1, -2), "--file", file];
  h.runtime.transport = async (url, init) => {
    if (String(url).endsWith("/api/device/poll")) {
      await writeFile(file, `A=${h.secret}\nB=${h.secret}`, { mode: 0o600 });
      if (process.platform === "win32") await windowsPrivatePath(file, true);
    }
    return h.transport(url, init);
  };
  await runCli([...args, "--dry-run"], h.runtime);
  assert.deepEqual(h.events, [
    "/api/device/start",
    "browser",
    "/api/device/poll",
    "/api/upload/import-context",
  ]);
  assert.ok(!h.output.join("\n").includes(h.secret));
  h.runtime.prompt = async (label) => {
    assert.match(label, /Type IMPORT/);
    return "cancel";
  };
  await assert.rejects(runCli(args, h.runtime), (error) =>
    /Import cancelled/.test(cliErrorMessage(error, "import")),
  );
  assert.ok(!h.events.includes("/api/upload/import"));
  h.runtime.prompt = async () => "IMPORT";
  await runCli(args, h.runtime);
  assert.equal(h.events.filter((e) => e === "/api/upload/import").length, 1);
  assert.ok(!h.output.join("\n").includes(h.secret));
});

test("CLI import refuses missing authorization before file access and requires explicit automation confirmation", async (t) => {
  const f = await fixture(t),
    h = harness(f);
  h.runtime.interactive = false;
  const file = path.join(f.directory, ".env");
  const args = ["import", ...f.args.slice(1, -2), "--file", file];
  await assert.rejects(runCli(args, h.runtime), (error) =>
    /passman login/.test(cliErrorMessage(error, "import")),
  );
  assert.equal(h.events.length, 0);
  f.identity.upload!.expiresAt = Math.floor(Date.now() / 1000) + 1200;
  await saveIdentity(f.directory, f.password, f.identity);
  await writeFile(file, `A=${h.secret}`, { mode: 0o600 });
  if (process.platform === "win32") await windowsPrivatePath(file, true);
  await assert.rejects(runCli(args, h.runtime), (error) =>
    /--yes/.test(cliErrorMessage(error, "import")),
  );
  assert.ok(!h.events.includes("/api/upload/import"));
  await runCli([...args, "--yes"], h.runtime);
  assert.equal(h.events.filter((e) => e === "/api/upload/import").length, 1);
  await assert.rejects(
    runCli([...args, "--replace", "--skip-existing"], h.runtime),
  );
  await writeFile(file, "A=\nA=synthetic-cli-secret-value");
  await assert.rejects(runCli([...args, "--yes"], h.runtime), (error) =>
    /DUPLICATE_KEY/.test(cliErrorMessage(error, "import")),
  );
});
