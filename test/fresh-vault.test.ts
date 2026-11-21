import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  API_PATH,
  PassmanError,
  anchorTuple,
  openBox,
  randomSecret,
  refreshRuntime,
  sealValue,
  signRecord,
  type ErrorCode,
  type RecordContext,
  type SecretRecord,
  type VaultBundle,
} from "@passman/protocol";
import {
  RuntimeClient,
  environmentRuntimeCustody,
  mountedRuntimeCustody,
} from "../packages/passman/src/index.js";
import { AdminClient } from "../packages/passman/src/admin.js";
import { installReplacementRuntime } from "../packages/passman/src/writer-replacement.js";
import {
  UnixFileStore,
  UnixRuntimeCustody,
} from "../packages/passman/src/custody.js";
import {
  initializeVault,
  replaceWriterVault,
  restoreAdmin,
  restoreRuntime,
  rewrapVaultPassword,
  rotateVaultKey,
} from "../packages/passman/src/vault.js";

const origin = "https://passman.example";
const password = "local fixture password";
const replacement = "next local fixture password";
const posix = process.platform === "linux" || process.platform === "darwin";
let a: Awaited<ReturnType<typeof initializeVault>>;
let b: Awaited<ReturnType<typeof initializeVault>>;

before(async () => {
  a = await initializeVault(origin, randomUUID(), password);
  b = await initializeVault(origin, randomUUID(), password);
});

function rejects(code: ErrorCode) {
  return (error: unknown) =>
    error instanceof PassmanError && error.code === code;
}

test("the password restores full admin custody separately from runtime-only bootstrap", async () => {
  const { administration, ...bootstrap } = a.bundle;
  const restored = await restoreRuntime(bootstrap, password);
  const admin = await restoreAdmin(a.bundle, password);
  assert.deepEqual(restored.anchor, a.bundle.anchor);
  assert.deepEqual(restored.keys, a.admin.runtime.keys);
  assert.equal(restored.syncKey, a.admin.runtime.syncKey);
  assert.notEqual(restored.installationId, a.admin.runtime.installationId);
  assert.deepEqual(admin.signingKey, a.admin.signingKey);
  assert.equal(Object.hasOwn(restored, "signingKey"), false);
  const context = [
    "passman/password",
    1,
    administration.profile,
    administration.purpose,
    administration.salt,
    anchorTuple(administration.anchor),
    administration.epoch,
    administration.syncId,
    administration.revision,
  ];
  await assert.rejects(
    openBox(administration.box, restored.syncKey, context),
    rejects("INTEGRITY_FAILED"),
  );
  await assert.rejects(restoreAdmin(bootstrap, password), rejects("FORBIDDEN"));
  await assert.rejects(
    restoreRuntime(bootstrap, "incorrect fixture password"),
    rejects("PASSWORD_INVALID"),
  );
  await assert.rejects(
    restoreRuntime(bootstrap, password, undefined, b.bundle.anchor),
    rejects("CONTEXT_MISMATCH"),
  );
  await assert.rejects(
    restoreRuntime({ ...bootstrap, bootstrap: administration }, password),
    rejects("CONTEXT_MISMATCH"),
  );
  await assert.rejects(
    restoreRuntime(
      {
        ...bootstrap,
        bootstrap: { ...bootstrap.bootstrap, profile: "changed" },
      },
      password,
    ),
    rejects("INTEGRITY_FAILED"),
  );
});

test("password rewrap preserves deployed sync and separates remembered, current, and replaced epochs", async () => {
  const updated = await rewrapVaultPassword(a.bundle, a.admin, replacement);
  assert.equal(updated.generation, a.bundle.generation + 1);
  assert.equal(updated.bootstrap.revision, a.bundle.bootstrap.revision + 1);
  assert.equal(
    updated.administration.revision,
    a.bundle.administration.revision + 1,
  );
  assert.equal(updated.syncId, a.bundle.syncId);
  await assert.rejects(
    restoreRuntime(updated, password),
    rejects("PASSWORD_INVALID"),
  );
  const oldRuntime = await restoreRuntime(a.bundle, password);
  assert.deepEqual(
    (await refreshRuntime(updated.keyring, oldRuntime)).keys,
    oldRuntime.keys,
  );
  assert.deepEqual(
    (await restoreAdmin(updated, replacement)).signingKey,
    a.admin.signingKey,
  );
  await assert.rejects(
    rewrapVaultPassword(
      a.bundle,
      { version: 1, runtime: oldRuntime, signingKey: b.admin.signingKey },
      replacement,
    ),
    rejects("CONTEXT_MISMATCH"),
  );
  const replaced = await rotateVaultKey(updated, a.admin, password);
  assert.equal(replaced.bundle.epoch, a.bundle.epoch + 1);
  assert.notEqual(replaced.bundle.syncId, a.bundle.syncId);
  await assert.rejects(
    refreshRuntime(replaced.bundle.keyring, oldRuntime),
    rejects("CONTEXT_MISMATCH"),
  );
  const reprovisioned = await restoreRuntime(replaced.bundle, password);
  assert.equal(reprovisioned.keys.length, 2);
  assert.notEqual(reprovisioned.activeKeyId, oldRuntime.activeKeyId);
});

function recordContext(
  bundle: VaultBundle,
  state: RecordContext["state"] = "active",
): RecordContext {
  return {
    version: 1,
    origin,
    accountId: bundle.anchor.accountId,
    vaultId: bundle.anchor.vaultId,
    projectId: randomUUID(),
    project: "billing",
    name: "EXAMPLE_KEY",
    secretId: randomUUID(),
    keyId: bundle.activeKey.id,
    epoch: bundle.epoch,
    revision: 1,
    state,
  };
}

test("a read validates account, scope, signer and revision while metadata works without custody", async () => {
  const credentialId = randomUUID();
  const serviceKey = `pmr1.${a.bundle.anchor.accountId}.${credentialId}.${randomSecret()}`;
  const address = { project: "billing", name: "EXAMPLE_KEY" };
  const context = recordContext(a.bundle);
  const signed = await signRecord(
    await sealValue("", a.bundle.activeKey.publicKey, context),
    a.admin.signingKey,
  );
  let record: SecretRecord | undefined = signed;
  let scope = [context.projectId];
  let deny = false;
  let publicAnchor = a.bundle.anchor;
  const fetch: typeof globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, origin);
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      `Bearer ${serviceKey}`,
    );
    const path = url.pathname.slice(API_PATH.length);
    if (deny)
      return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
    if (path === "/status")
      return Response.json({
        anchor: publicAnchor,
        epoch: a.bundle.epoch,
        generation: a.bundle.generation,
        syncId: a.bundle.syncId,
        activeKey: a.bundle.activeKey,
        credential: {
          id: credentialId,
          projects: scope,
          expiresAt: null,
          bootstrap: false,
        },
      });
    if (path === "/projects")
      return Response.json({
        projects: [
          {
            id: context.projectId,
            name: context.project,
            createdAt: new Date().toISOString(),
            secretCount: 1,
          },
        ],
      });
    assert.equal(path, "/projects/billing/secrets/EXAMPLE_KEY");
    return record
      ? Response.json(record)
      : Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  };
  const metadata = new RuntimeClient({
    origin,
    serviceKey,
    fetch,
    custody: null,
  });
  assert.equal((await metadata.listProjects())[0]?.name, address.project);
  assert.deepEqual(
    (await metadata.getEncryptedSecret(address)).context,
    context,
  );
  await assert.rejects(
    metadata.getSecret(address),
    rejects("VAULT_NOT_PROVISIONED"),
  );
  const reader = new RuntimeClient({
    origin,
    serviceKey,
    fetch,
    custody: {
      loadRuntime: async (selection) => {
        assert.deepEqual(selection, {
          origin,
          accountId: a.bundle.anchor.accountId,
        });
        return a.admin.runtime;
      },
    },
  });
  assert.equal(await reader.getSecret(address), "");
  scope = [randomUUID()];
  await assert.rejects(reader.getSecret(address), rejects("FORBIDDEN"));
  scope = [context.projectId];
  publicAnchor = { ...a.bundle.anchor, writer: b.bundle.anchor.writer };
  await assert.rejects(reader.getSecret(address), rejects("CONTEXT_MISMATCH"));
  publicAnchor = a.bundle.anchor;
  record = await sealValue("website fixture", a.bundle.activeKey.publicKey, {
    ...context,
    state: "pending",
  });
  assert.equal(await metadata.hasSecret(address), true);
  await assert.rejects(
    reader.getSecret(address),
    rejects("PENDING_VERIFICATION_REQUIRED"),
  );
  record = { ...record, context: { ...context, state: "active" } };
  await assert.rejects(reader.getSecret(address), rejects("SIGNATURE_INVALID"));
  record = await signRecord(
    await sealValue("\ufeffnext", a.bundle.activeKey.publicKey, {
      ...context,
      revision: 2,
    }),
    a.admin.signingKey,
  );
  assert.equal(await reader.getSecret(address), "\ufeffnext");
  record = signed;
  await assert.rejects(reader.getSecret(address), rejects("CONTEXT_MISMATCH"));
  record = await sealValue(
    "other account fixture",
    b.bundle.activeKey.publicKey,
    recordContext(b.bundle),
  );
  await assert.rejects(
    metadata.getEncryptedSecret(address),
    rejects("CONTEXT_MISMATCH"),
  );
  record = undefined;
  assert.equal(await metadata.hasSecret(address), false);
  deny = true;
  await assert.rejects(metadata.hasSecret(address), rejects("FORBIDDEN"));
});

test("an ordinary read refreshes a writer-signed keyring once and reuses it after local persistence", async () => {
  const rotated = await rotateVaultKey(a.bundle, a.admin);
  const bundle = rotated.bundle;
  const context = recordContext(bundle);
  const record = await signRecord(
    await sealValue("rotated", bundle.activeKey.publicKey, context),
    a.admin.signingKey,
  );
  const credentialId = randomUUID();
  const serviceKey = `pmr1.${bundle.anchor.accountId}.${credentialId}.${randomSecret()}`;
  let runtime = a.admin.runtime;
  let refreshes = 0;
  const custody = {
    loadRuntime: async () => runtime,
    saveRuntime: async (value: typeof runtime) => {
      runtime = value;
    },
  };
  const fetch: typeof globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname.slice(API_PATH.length);
    if (path === "/status")
      return Response.json({
        anchor: bundle.anchor,
        epoch: bundle.epoch,
        generation: bundle.generation,
        syncId: bundle.syncId,
        activeKey: bundle.activeKey,
        credential: {
          id: credentialId,
          projects: null,
          expiresAt: null,
          bootstrap: false,
        },
      });
    if (path === "/keyring") {
      refreshes++;
      return Response.json({ keyring: bundle.keyring });
    }
    assert.equal(path, "/projects/billing/secrets/EXAMPLE_KEY");
    return Response.json(record);
  };
  const options = { origin, serviceKey, fetch, custody };
  const address = { project: context.project, name: context.name };
  const reader = new RuntimeClient(options);
  assert.deepEqual(
    await Promise.all([reader.getSecret(address), reader.getSecret(address)]),
    ["rotated", "rotated"],
  );
  assert.equal(refreshes, 1);
  assert.equal(await new RuntimeClient(options).getSecret(address), "rotated");
  assert.equal(refreshes, 1);
});

test("administrative password change rejects a stale bundle before publishing a wrapper", async () => {
  const current = (await rotateVaultKey(a.bundle, a.admin)).bundle;
  const credentialId = randomUUID();
  const adminKey = `pma1.${a.bundle.anchor.accountId}.${credentialId}.${randomSecret()}`;
  let posts = 0;
  const fetch: typeof globalThis.fetch = async (input, options) => {
    if (options?.method === "POST") posts++;
    const route = new URL(String(input)).pathname.slice(API_PATH.length);
    if (route === "/status")
      return Response.json({
        anchor: current.anchor,
        epoch: current.epoch,
        generation: current.generation,
        syncId: current.syncId,
        activeKey: current.activeKey,
        credential: {
          id: credentialId,
          projects: null,
          expiresAt: Date.now() + 60_000,
          bootstrap: false,
        },
      });
    if (route === "/keyring")
      return Response.json({ keyring: current.keyring });
    return new Response(null, { status: 503 });
  };
  const admin = new AdminClient({
    origin,
    adminKey,
    fetch,
    custody: { loadAdmin: async () => a.admin, saveAdmin: async () => {} },
  });
  await assert.rejects(
    admin.changePassword(
      a.bundle,
      password,
      replacement,
      "local-management-fixture",
    ),
    rejects("CONTEXT_MISMATCH"),
  );
  assert.equal(posts, 0);
});

test("deployment environment custody explicitly validates the selected account", async () => {
  const material = JSON.stringify(a.admin.runtime);
  const configured = environmentRuntimeCustody("TEST_RUNTIME", {
    TEST_RUNTIME: material,
  });
  assert.deepEqual(
    await configured.loadRuntime(a.bundle.anchor),
    a.admin.runtime,
  );
  await assert.rejects(
    configured.loadRuntime(b.bundle.anchor),
    rejects("CONTEXT_MISMATCH"),
  );
  assert.equal(
    await environmentRuntimeCustody("TEST_RUNTIME", {}).loadRuntime(
      a.bundle.anchor,
    ),
    undefined,
  );
});

test(
  "owner-only Unix custody rejects shared paths, symlinks and live locks",
  { skip: !posix },
  async () => {
    const parent = await mkdtemp(join(tmpdir(), "passman-v1-test-"));
    const path = join(parent, "custody");
    try {
      const storage = new UnixRuntimeCustody(path);
      await storage.saveRuntime(a.admin.runtime);
      await storage.saveRuntime(b.admin.runtime);
      assert.deepEqual(
        await storage.loadRuntime(a.bundle.anchor),
        a.admin.runtime,
      );
      assert.deepEqual(
        await storage.loadRuntime(b.bundle.anchor),
        b.admin.runtime,
      );
      const names = await readdir(path);
      assert.equal(names.length, 2);
      const candidate = await Promise.all(
        names.map(async (name) => ({
          name,
          item: JSON.parse(
            await readFile(join(path, name), "utf8"),
          ) as typeof a.admin.runtime,
        })),
      );
      const entry = candidate.find(
        (item) => item.item.anchor.accountId === a.bundle.anchor.accountId,
      );
      assert.ok(entry);
      const file = join(path, entry.name);
      await chmod(file, 0o644);
      await assert.rejects(
        storage.loadRuntime(a.bundle.anchor),
        rejects("STORAGE_UNAVAILABLE"),
      );
      await chmod(file, 0o600);
      await writeFile(`${file}.lock`, JSON.stringify({ pid: process.pid }), {
        mode: 0o600,
      });
      await assert.rejects(
        new UnixFileStore(path).recoverLock("runtime", a.bundle.anchor),
        rejects("CONFLICT"),
      );
      await rm(`${file}.lock`);
      const link = join(parent, "link");
      await symlink(path, link);
      await assert.rejects(
        new UnixRuntimeCustody(link).loadRuntime(a.bundle.anchor),
        rejects("STORAGE_UNAVAILABLE"),
      );
      const mount = join(parent, "credential.json");
      await writeFile(mount, JSON.stringify(a.admin.runtime), { mode: 0o440 });
      assert.deepEqual(
        await mountedRuntimeCustody(mount).loadRuntime(a.bundle.anchor),
        a.admin.runtime,
      );
      const alias = join(parent, "mount-link");
      await symlink(mount, alias);
      await assert.rejects(
        mountedRuntimeCustody(alias).loadRuntime(a.bundle.anchor),
        rejects("STORAGE_UNAVAILABLE"),
      );
      const revision = join(parent, "..revision");
      await mkdir(revision, { mode: 0o700 });
      await writeFile(
        join(revision, "runtime.json"),
        JSON.stringify(a.admin.runtime),
        { mode: 0o440 },
      );
      await symlink("..revision", join(parent, "..data"));
      const projected = join(parent, "runtime.json");
      await symlink("..data/runtime.json", projected);
      const projectedRuntime = mountedRuntimeCustody(projected).loadRuntime(
        a.bundle.anchor,
      );
      if (process.getuid?.() === 0)
        assert.deepEqual(await projectedRuntime, a.admin.runtime);
      else
        await assert.rejects(projectedRuntime, rejects("STORAGE_UNAVAILABLE"));
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  },
);

test(
  "an independently pinned replacement writer can advance a runtime across multiple epochs",
  { skip: !posix },
  async () => {
    const folder = await mkdtemp(
      join(await realpath(tmpdir()), "passman-v1-repin-"),
    );
    try {
      const custody = new UnixRuntimeCustody(join(folder, "custody"));
      const previous = a.admin.runtime;
      await custody.saveRuntime(previous);
      const advanced = await rotateVaultKey(a.bundle, a.admin, replacement);
      const replaced = await replaceWriterVault(
        advanced.bundle,
        advanced.admin,
        password,
      );
      assert.equal(replaced.bundle.epoch, a.bundle.epoch + 2);
      await assert.rejects(
        custody.saveRuntime(replaced.admin.runtime),
        rejects("CONTEXT_MISMATCH"),
      );
      await assert.rejects(
        installReplacementRuntime(
          replaced.bundle,
          password,
          previous,
          { ...replaced.bundle.anchor, writer: b.bundle.anchor.writer },
          custody,
        ),
        rejects("CONTEXT_MISMATCH"),
      );
      assert.deepEqual(await custody.loadRuntime(a.bundle.anchor), previous);
      const runtime = await installReplacementRuntime(
        replaced.bundle,
        password,
        previous,
        replaced.bundle.anchor,
        custody,
      );
      assert.equal(runtime.installationId, previous.installationId);
      assert.deepEqual(await custody.loadRuntime(a.bundle.anchor), runtime);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);

test(
  "rotation cancellation preserves ambiguous and committed stages until a different signed generation is live",
  { skip: !posix },
  async () => {
    const folder = await mkdtemp(
      join(await realpath(tmpdir()), "passman-v1-cancel-"),
    );
    const directory = join(folder, "custody");
    const store = new UnixFileStore(directory);
    let remote: VaultBundle | undefined;
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      const path = request.url?.slice(API_PATH.length);
      if (path === "/administration" && remote)
        response.end(JSON.stringify(remote));
      else if (path === "/account" && remote)
        response.end(
          JSON.stringify({
            account: {
              accountId: remote.anchor.accountId,
              vaultId: remote.anchor.vaultId,
              anchor: remote.anchor,
            },
          }),
        );
      else {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: { code: "UNAVAILABLE" } }));
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const listening = server.address();
    assert.ok(listening && typeof listening === "object");
    const loopback = `http://127.0.0.1:${listening.port}`;
    const accountId = randomUUID();
    const selected = { origin: loopback, accountId };
    const env = {
      ...process.env,
      PASSMAN_ADMIN_KEY: `pma1.${accountId}.${randomUUID()}.${randomSecret()}`,
      PASSMAN_MANAGEMENT_TOKEN: "synthetic-management-token",
    };
    async function cancelRotation() {
      const cli = fileURLToPath(
        new URL("../packages/passman/src/cli.ts", import.meta.url),
      );
      const subprocess = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          cli,
          "vault",
          "rotate",
          "cancel",
          "--origin",
          loopback,
          "--account",
          accountId,
          "--file-mode",
          "--store-dir",
          directory,
        ],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "",
        stderr = "";
      subprocess.stdout.setEncoding("utf8").on("data", (data: string) => {
        stdout += data;
      });
      subprocess.stderr.setEncoding("utf8").on("data", (data: string) => {
        stderr += data;
      });
      const [code] = await once(subprocess, "close");
      return { code, stdout, stderr };
    }
    try {
      const previous = await initializeVault(loopback, accountId, password);
      const candidate = await rotateVaultKey(previous.bundle, previous.admin);
      const stage = {
        expectedGeneration: previous.bundle.generation,
        fromEpoch: previous.bundle.epoch,
        ...candidate,
      };
      await store.write("rotation", selected, stage, () => true);
      assert.match((await cancelRotation()).stderr, /UNAVAILABLE/);
      assert.deepEqual(await store.read("rotation", selected), stage);
      remote = previous.bundle;
      assert.match((await cancelRotation()).stderr, /CONFLICT/);
      assert.deepEqual(await store.read("rotation", selected), stage);
      remote = candidate.bundle;
      assert.match((await cancelRotation()).stderr, /CONFLICT/);
      assert.deepEqual(await store.read("rotation", selected), stage);
      remote = (await rotateVaultKey(previous.bundle, previous.admin)).bundle;
      const cancelled = await cancelRotation();
      assert.equal(cancelled.code, 0, cancelled.stderr);
      assert.deepEqual(JSON.parse(cancelled.stdout), { cancelled: true });
      assert.deepEqual(await store.read("rotation", selected), {
        complete: true,
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(folder, { recursive: true, force: true });
    }
  },
);
