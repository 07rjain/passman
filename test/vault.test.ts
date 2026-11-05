import assert from "node:assert/strict";
import { windowsPrivatePath } from "../packages/client/src/windows";
import { test } from "node:test";
import {
  mkdtemp,
  rm,
  readFile,
  chmod,
  stat,
  writeFile,
  mkdir,
  symlink,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  initializeIdentity,
  unlockIdentity,
  LocalVaultError,
  KeymanClient,
  KeymanError,
  request,
  saveIdentity,
  readPrivateFile,
} from "@keyman-mvp/client";
await test(
  "POSIX rejects retargetable vault aliases and writable input parents without altering either vault",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "passman-path-regression-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = path.join(root, "first"),
      second = path.join(root, "second"),
      alias = path.join(root, "alias");
    const identity = await initializeIdentity(
      first,
      "synthetic-first-passphrase",
      "https://passman.test",
    );
    await initializeIdentity(
      second,
      "synthetic-second-passphrase",
      "https://passman.test",
    );
    const before = await readFile(path.join(second, "vault.json"));
    await symlink(first, alias);
    await assert.rejects(
      unlockIdentity(alias, "synthetic-first-passphrase"),
      LocalVaultError,
    );
    await unlink(alias);
    await symlink(second, alias);
    await assert.rejects(
      saveIdentity(alias, "synthetic-first-passphrase", identity),
      LocalVaultError,
    );
    assert.deepEqual(await readFile(path.join(second, "vault.json")), before);
    const shared = path.join(root, "shared");
    await mkdir(shared, { mode: 0o777 });
    await chmod(shared, 0o777);
    const input = path.join(shared, "input");
    await writeFile(input, "synthetic-input", { mode: 0o600 });
    await assert.rejects(readPrivateFile(input), LocalVaultError);
    await assert.rejects(
      initializeIdentity(
        path.join(shared, "new"),
        "synthetic-passphrase",
        "https://passman.test",
      ),
      LocalVaultError,
    );
  },
);
await test("local identity is encrypted, never overwritten, and rejects wrong passwords/tamper/permissions", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "keyman-mvp-unit-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  if (process.platform === "win32") await windowsPrivatePath(dir, true);
  const identity = await initializeIdentity(
    dir,
    "synthetic-passphrase",
    "https://keyman.test",
  );
  const file = path.join(dir, "vault.json"),
    raw = await readFile(file, "utf8");
  if (process.platform !== "win32")
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(raw.includes(identity.privateKey.d), false);
  assert.deepEqual(await unlockIdentity(dir, "synthetic-passphrase"), identity);
  await assert.rejects(
    unlockIdentity(dir, "synthetic-wrong-passphrase"),
    LocalVaultError,
  );
  await assert.rejects(
    initializeIdentity(dir, "synthetic-passphrase", "https://keyman.test"),
  );
  if (process.platform !== "win32") {
    await chmod(file, 0o644);
    await assert.rejects(
      unlockIdentity(dir, "synthetic-passphrase"),
      LocalVaultError,
    );
    await chmod(file, 0o600);
  }
  const parsed = JSON.parse(raw) as { tag: string };
  parsed.tag = (parsed.tag[0] === "A" ? "B" : "A") + parsed.tag.slice(1);
  await writeFile(file, JSON.stringify(parsed));
  await assert.rejects(
    unlockIdentity(dir, "synthetic-passphrase"),
    LocalVaultError,
  );
});
await test("client refuses unlinked identities and bounds untrusted API responses", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "keyman-mvp-client-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  if (process.platform === "win32") await windowsPrivatePath(dir, true);
  const identity = await initializeIdentity(
    dir,
    "synthetic-passphrase",
    "https://keyman.test",
  );
  assert.throws(
    () =>
      new KeymanClient({ identity, serviceKey: "invalid", project: "test" }),
    KeymanError,
  );
  let cancelled = false;
  await assert.rejects(
    request(
      identity.origin,
      "/api/anything",
      {},
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(150001));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    ),
    KeymanError,
  );
  assert.equal(cancelled, true);
});
