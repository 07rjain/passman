import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFreshDistribution } from "./fresh.mjs";
import { assertPublishedVersion } from "./public-release.mjs";
const dir = await mkdtemp(path.join(tmpdir(), "passman-fresh-dist-"));
const npm = (args, cwd) =>
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
try {
  const result = await buildFreshDistribution(path.join(dir, "assets"));
  const consumer = path.join(dir, "consumer");
  await mkdir(consumer);
  await writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify({ type: "module", private: true }),
  );
  npm(
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      path.join(result.output, result.filename),
    ],
    consumer,
  );
  const fixture = `import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {connect,RuntimeClient} from '@passman/sdk';import {initializeVault,restoreRuntime,restoreAdmin} from '@passman/sdk/admin';import {createTransfer,receiveTransfer} from '@passman/sdk/transfers';import {WriterReplacementClient} from '@passman/sdk/writer-replacement';const {admin,bundle}=await initializeVault('https://example.test',randomUUID(),'Synthetic distribution password');assert.equal((await restoreRuntime(bundle,'Synthetic distribution password')).activeKeyId,admin.runtime.activeKeyId);assert.equal((await restoreAdmin(bundle,'Synthetic distribution password')).signingKey.x,admin.signingKey.x);assert.equal(typeof connect,'function');assert.equal(typeof RuntimeClient,'function');assert.equal(typeof createTransfer,'function');assert.equal(typeof receiveTransfer,'function');assert.equal(typeof WriterReplacementClient,'function');`;
  execFileSync(process.execPath, ["--input-type=module", "--eval", fixture], {
    cwd: consumer,
    stdio: "pipe",
  });
  const cli = path.join(consumer, "node_modules/@passman/sdk/dist/cli.js");
  assert.equal(
    execFileSync(process.execPath, [cli, "--version"], {
      encoding: "utf8",
    }).trim(),
    result.version,
  );
  assert.match(
    execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }),
    /vault transfer receive/,
  );
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const manifest = Buffer.from(
    `${createHash("sha256")
      .update(await readFile(path.join(result.output, result.filename)))
      .digest("hex")}  ${result.filename}\n`,
  );
  const signature = sign("sha256", manifest, privateKey);
  const transport = async (url) => {
    const name = new URL(url).pathname.split("/").at(-1);
    assert(!String(url).includes("/latest/"));
    return new globalThis.Response(
      name.endsWith(".sig")
        ? signature
        : name.endsWith(".sha256")
          ? manifest
          : await readFile(path.join(result.output, result.filename)),
    );
  };
  await assertPublishedVersion({
    version: result.version,
    publicKey,
    transport,
  });
  await assert.rejects(
    assertPublishedVersion({
      version: result.version,
      publicKey,
      transport: async (url) =>
        String(url).endsWith(".tgz")
          ? new globalThis.Response("tampered")
          : transport(url),
    }),
  );
  await assert.rejects(
    assertPublishedVersion({
      version: result.version,
      publicKey,
      transport: async () => new globalThis.Response("invalid signature"),
    }),
  );
  for (const name of ["install-v1.sh", "install-v1.ps1"])
    assert(
      (await readFile(path.join(result.output, name), "utf8")).includes(
        result.version,
      ),
    );
  console.log(
    "Fresh distribution: offline bundled SDK/subpaths, restoration, CLI version/help, pinned signed-release gate and tamper rejection passed.",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
