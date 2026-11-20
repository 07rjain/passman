import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  directory = await mkdtemp(path.join(tmpdir(), "passman-fresh-artifact-"));
const npm = (args, cwd = directory) =>
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
try {
  const packages = [];
  for (const name of ["protocol", "passman"]) {
    const [artifact] = JSON.parse(
      npm(
        ["pack", "--json", "--pack-destination", directory],
        path.join(root, "packages", name),
      ),
    );
    assert(
      artifact.files.every((file) =>
        /^(dist\/|package\.json$)/.test(file.path),
      ),
      "Only compiled library files enter artifacts",
    );
    packages.push(path.join(directory, artifact.filename));
  }
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "passman-fresh-fixture",
      private: true,
      type: "module",
    }),
  );
  npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", ...packages]);
  const code = `import assert from 'node:assert/strict';
import {connect,login,RuntimeClient,NativeRuntimeCustody,PassmanError} from '@passman/sdk';
import {initializeVault,restoreRuntime,restoreAdmin,AdminClient} from '@passman/sdk/admin';
import {createTransfer,receiveTransfer} from '@passman/sdk/transfers';
import {WriterReplacementClient,prepareWriterReplacement} from '@passman/sdk/writer-replacement';
import {randomUUID} from 'node:crypto';
const {admin,bundle}=await initializeVault('http://localhost:3100',randomUUID(),'synthetic fixture passphrase');
const runtime=await restoreRuntime(bundle,'synthetic fixture passphrase');
assert.equal(runtime.activeKeyId,admin.runtime.activeKeyId);assert(!('signingKey' in runtime));
assert.equal((await restoreAdmin(bundle,'synthetic fixture passphrase')).signingKey.x,admin.signingKey.x);
assert.equal(typeof connect,'function');assert.equal(typeof login,'function');assert.equal(typeof WriterReplacementClient,'function');assert.equal(typeof prepareWriterReplacement,'function');assert.equal(typeof createTransfer,'function');assert.equal(typeof receiveTransfer,'function');
assert.equal(typeof NativeRuntimeCustody,'function');assert.equal(typeof RuntimeClient,'function');assert.equal(typeof AdminClient,'function');
assert.equal(new PassmanError('FORBIDDEN').code,'FORBIDDEN');`;
  execFileSync(process.execPath, ["--input-type=module", "--eval", code], {
    cwd: directory,
    stdio: "pipe",
  });
  const help = execFileSync(
    process.execPath,
    [path.join(directory, "node_modules/@passman/sdk/dist/cli.js"), "--help"],
    { cwd: directory, encoding: "utf8" },
  );
  assert.match(help, /Usage: passman-v1/);
  const shim = path.join(
    directory,
    "node_modules/.bin",
    process.platform === "win32" ? "passman-v1.cmd" : "passman-v1",
  );
  const shimHelp =
    process.platform === "win32"
      ? execFileSync(
          process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
          ["/d", "/s", "/c", `""${shim}" --help"`],
          { cwd: directory, encoding: "utf8" },
        )
      : execFileSync(shim, ["--help"], { cwd: directory, encoding: "utf8" });
  assert.match(shimHelp, /Usage: passman-v1/);
  await writeFile(
    path.join(directory, "consumer.ts"),
    `import {connect,login,type RuntimeOptions} from '@passman/sdk'; import {AdminClient,initializeVault} from '@passman/sdk/admin'; import {createTransfer} from '@passman/sdk/transfers'; import {WriterReplacementClient,prepareWriterReplacement} from '@passman/sdk/writer-replacement'; void login;void WriterReplacementClient;void prepareWriterReplacement;void connect; void initializeVault; void AdminClient; void createTransfer; const options: RuntimeOptions={origin:'https://example.test',serviceKey:'synthetic'}; void options;`,
  );
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2023",
      "consumer.ts",
    ],
    { cwd: directory, stdio: "pipe" },
  );
  process.stdout.write(
    "Fresh SDK artifacts: isolated imports, crypto restoration, CLI help and TypeScript declarations passed.\n",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
