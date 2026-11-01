import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { rootCertificates } from "node:tls";
import { once } from "node:events";
import { buildDistribution } from "./build.mjs";
const root = path.resolve(import.meta.dirname, "..");
const fixture = await mkdtemp(path.join(tmpdir(), "passman-install-"));
const run = async (command, args, options = {}) => {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (output += b));
  const [code] = await once(child, "exit");
  return { code, output };
};
let server;
try {
  const versionRoot = path.join(fixture, "versioning");
  for (const name of ["distribution", "packages/client", "docs"])
    await mkdir(path.join(versionRoot, name), { recursive: true });
  await writeFile(
    path.join(versionRoot, "distribution/version.mjs"),
    await readFile(path.join(root, "distribution/version.mjs")),
  );
  await writeFile(
    path.join(versionRoot, "packages/client/package.json"),
    JSON.stringify({ version: "0.1.0" }),
  );
  await writeFile(
    path.join(versionRoot, "package-lock.json"),
    JSON.stringify({ packages: { "packages/client": { version: "0.1.0" } } }),
  );
  await writeFile(
    path.join(versionRoot, "docs/SDK_CHANGELOG.md"),
    "# Changelog\n\n## Unreleased\n\n- Fix retrieval.\n\n## 0.1.0 — previous\n",
  );
  const bumped = await run(process.execPath, [
    path.join(versionRoot, "distribution/version.mjs"),
    "patch",
  ]);
  assert.equal(bumped.code, 0, bumped.output);
  assert.equal(
    JSON.parse(
      await readFile(
        path.join(versionRoot, "packages/client/package.json"),
        "utf8",
      ),
    ).version,
    "0.1.1",
  );
  const empty = await run(process.execPath, [
    path.join(versionRoot, "distribution/version.mjs"),
    "patch",
  ]);
  assert.notEqual(empty.code, 0);
  const release = await buildDistribution(path.join(fixture, "releases"));
  const consumer = path.join(fixture, "consumer");
  await mkdir(consumer);
  await writeFile(
    path.join(consumer, "package.json"),
    '{"private":true,"type":"module"}',
  );
  const installed = await run(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      path.join(fixture, "empty-cache"),
      path.join(release.output, release.filename),
    ],
    { cwd: consumer },
  );
  assert.equal(installed.code, 0, installed.output);
  await writeFile(
    path.join(consumer, "consumer.ts"),
    "import {KeymanClient,type Identity} from '@07rjain/passman';declare const identity:Identity;const c=new KeymanClient({identity,serviceKey:'local',project:'test'});const v:Promise<string>=c.getSecret({name:'KEY'});void v;",
  );
  const typed = await run(
    process.execPath,
    [
      path.join(root, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2023",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "consumer.ts",
    ],
    { cwd: consumer },
  );
  assert.equal(typed.code, 0, typed.output);
  await writeFile(
    path.join(consumer, "runtime.mjs"),
    "import assert from 'node:assert/strict';import {KeymanClient,KeymanError,initializeIdentity,unlockIdentity} from '@07rjain/passman';assert.equal(typeof KeymanClient,'function');assert.equal(typeof initializeIdentity,'function');assert.equal(typeof unlockIdentity,'function');assert.equal(new KeymanError('NOT_FOUND').code,'NOT_FOUND');const i=await initializeIdentity('./vault','synthetic passphrase for test','https://passman.subdomain.wtf');assert.equal((await unlockIdentity('./vault','synthetic passphrase for test')).keyId,i.keyId);",
  );
  const runtime = await run(process.execPath, ["runtime.mjs"], {
    cwd: consumer,
  });
  assert.equal(runtime.code, 0, runtime.output);
  const cli = path.join(consumer, "node_modules/@07rjain/passman/dist/cli.js");
  const version = await run(process.execPath, [cli, "--version"]);
  assert.equal(version.output.trim(), release.version);
  const files = execFileSync(
    "tar",
    ["-tzf", path.join(release.output, release.filename)],
    { encoding: "utf8" },
  ).split("\n");
  assert.ok(
    !files.some((f) =>
      /\.env|vault\.json|ignore-docs|packages\/client\/src/.test(f),
    ),
  );
  assert.ok(files.includes("package/LICENSE"));
  const packageMetadata = JSON.parse(
    await readFile(
      path.join(consumer, "node_modules/@07rjain/passman/package.json"),
      "utf8",
    ),
  );
  assert.equal(
    packageMetadata.repository.url,
    "https://github.com/07rjain/passman.git",
  );
  assert.equal(packageMetadata.repository.directory, "packages/client");
  assert.ok(
    files.includes("package/node_modules/@keyman-mvp/core/dist/index.js"),
  );
  assert.ok(files.includes("package/node_modules/zod/package.json"));
  await writeFile(
    path.join(fixture, "openssl.conf"),
    "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\n",
  );
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      path.join(fixture, "key.pem"),
      "-out",
      path.join(fixture, "cert.pem"),
      "-config",
      path.join(fixture, "openssl.conf"),
    ],
    { stdio: "ignore" },
  );
  const cert = await readFile(path.join(fixture, "cert.pem"));
  await writeFile(
    path.join(fixture, "ca.pem"),
    rootCertificates.join("\n") + "\n" + cert,
  );
  let tamper = false;
  let unavailable = false;
  server = createServer(
    { key: await readFile(path.join(fixture, "key.pem")), cert },
    async (req, res) => {
      let filename;
      if (req.url === "/latest/download/latest.txt") filename = "latest.txt";
      else if (
        req.url ===
        "/download/passman-v" + release.version + "/" + release.filename
      )
        filename = release.filename;
      else if (
        req.url ===
        "/download/passman-v" +
          release.version +
          "/" +
          release.filename +
          ".sha256"
      )
        filename = release.filename + ".sha256";
      if (!filename || unavailable) {
        res.writeHead(404).end();
        return;
      }
      res.end(
        tamper && filename.endsWith(".tgz")
          ? "corrupted"
          : await readFile(path.join(release.output, filename)),
      );
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const home = path.join(fixture, "home");
  await mkdir(home);
  await mkdir(path.join(home, ".keyman-mvp"));
  await writeFile(
    path.join(home, ".keyman-mvp/vault.json"),
    "preserve-user-vault",
  );
  const env = {
    ...process.env,
    HOME: home,
    PASSMAN_DOWNLOAD_BASE: "https://localhost:" + port,
    PASSMAN_INSTALL_DIR: path.join(home, "install ' directory"),
    PASSMAN_BIN_DIR: path.join(home, "command directory"),
    CURL_CA_BUNDLE: path.join(fixture, "ca.pem"),
  };
  const install = () =>
    run("sh", [path.join(root, "distribution/install.sh")], { env });
  const first = await install();
  assert.equal(first.code, 0, first.output);
  const launcher = path.join(env.PASSMAN_BIN_DIR, "passman");
  assert.equal(
    (await run(launcher, ["--version"])).output.trim(),
    release.version,
  );
  const again = await install();
  assert.equal(again.code, 0, again.output);
  const oldVersion = release.version;
  const nextVersion = oldVersion.split(".");
  nextVersion[2] = String(Number(nextVersion[2]) + 1);
  const upgradeVersion = nextVersion.join(".");
  const upgrade = path.join(fixture, "upgrade");
  await mkdir(upgrade);
  execFileSync("tar", [
    "-xzf",
    path.join(release.output, release.filename),
    "-C",
    upgrade,
  ]);
  const updatedPackage = path.join(upgrade, "package/package.json");
  const updated = JSON.parse(await readFile(updatedPackage, "utf8"));
  updated.version = upgradeVersion;
  await writeFile(updatedPackage, JSON.stringify(updated));
  release.version = upgradeVersion;
  release.filename = "passman-" + upgradeVersion + ".tgz";
  execFileSync("tar", [
    "-czf",
    path.join(release.output, release.filename),
    "-C",
    upgrade,
    "package",
  ]);
  const sum = createHash("sha256")
    .update(await readFile(path.join(release.output, release.filename)))
    .digest("hex");
  await writeFile(
    path.join(release.output, release.filename + ".sha256"),
    sum + "  " + release.filename + "\n",
  );
  await writeFile(
    path.join(release.output, "latest.txt"),
    release.version + "\n",
  );
  const upgraded = await install();
  assert.equal(upgraded.code, 0, upgraded.output);
  assert.equal(
    (await run(launcher, ["--version"])).output.trim(),
    upgradeVersion,
  );
  assert.equal(
    (
      await run(
        path.join(
          env.PASSMAN_INSTALL_DIR,
          "versions",
          oldVersion,
          "runtime/bin/node",
        ),
        [
          path.join(
            env.PASSMAN_INSTALL_DIR,
            "versions",
            oldVersion,
            "package/dist/cli.js",
          ),
          "--version",
        ],
      )
    ).output.trim(),
    oldVersion,
  );
  tamper = true;
  const broken = await install();
  assert.notEqual(broken.code, 0);
  assert.match(broken.output, /checksum mismatch/);
  assert.equal(
    (await run(launcher, ["--version"])).output.trim(),
    release.version,
  );
  unavailable = true;
  const missing = await install();
  assert.notEqual(missing.code, 0);
  assert.match(missing.output, /selected release is publicly available/);
  assert.equal(
    (await run(launcher, ["--version"])).output.trim(),
    release.version,
  );
  assert.equal(
    await readFile(path.join(home, ".keyman-mvp/vault.json"), "utf8"),
    "preserve-user-vault",
  );
  console.log(
    "Passman artifact installs offline, SDK declarations/runtime work, and HTTPS install/reinstall/tamper checks pass without changing the vault.",
  );
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(fixture, { recursive: true, force: true });
}
