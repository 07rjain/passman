import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { rootCertificates } from "node:tls";
import { once } from "node:events";
import { buildDistribution } from "./build.mjs";
import { assertPublishedClient } from "./public-release.mjs";
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
  const keys = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const installerFile = path.join(fixture, "install.sh");
  const pinnedKey = await readFile(
    path.join(root, "distribution/release-public.pem"),
    "utf8",
  );
  const installerSource = await readFile(
    path.join(root, "distribution/install.sh"),
    "utf8",
  );
  assert.ok(installerSource.includes(pinnedKey.trim()));
  await writeFile(
    installerFile,
    installerSource.replace(
      pinnedKey.trim(),
      keys.publicKey.export({ type: "spki", format: "pem" }).toString().trim(),
    ),
  );
  const signManifest = async (release) => {
    const manifest = path.join(release.output, release.filename + ".sha256");
    await writeFile(
      manifest + ".sig",
      sign("sha256", await readFile(manifest), keys.privateKey),
    );
  };
  const release = await buildDistribution(path.join(fixture, "releases"));
  await signManifest(release);
  let publicFault;
  const verifyPublic = () =>
    assertPublishedClient({
      minimumVersion: release.version,
      publicKey: keys.publicKey,
      transport: async (url) => {
        const name = new URL(url).pathname.split("/").at(-1);
        if (publicFault === "unavailable")
          return new globalThis.Response(null, { status: 404 });
        if (name === "latest.txt" && publicFault === "old")
          return new globalThis.Response("0.0.0");
        if (name.endsWith(".sig") && publicFault === "signature")
          return new globalThis.Response("invalid");
        if (name.endsWith(".tgz") && publicFault === "archive")
          return new globalThis.Response("altered");
        return new globalThis.Response(
          await readFile(path.join(release.output, name)),
        );
      },
    });
  await verifyPublic();
  for (publicFault of ["unavailable", "old", "signature", "archive"])
    await assert.rejects(verifyPublic());
  publicFault = undefined;
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
    "import {KeymanClient,prepareEnvImport,type PreparedEnvImport,type Identity} from '@07rjain/passman';declare const identity:Identity;const c=new KeymanClient({identity,serviceKey:'local',project:'test'});const v:Promise<string>=c.getSecret({name:'KEY'});void v;const plan:Promise<PreparedEnvImport>=prepareEnvImport({identity,project:'test',source:'KEY=synthetic'});void plan;",
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
    "import assert from 'node:assert/strict';import {KeymanClient,KeymanError,initializeIdentity,unlockIdentity,parseEnv,prepareEnvImport} from '@07rjain/passman';assert.equal(typeof KeymanClient,'function');assert.equal(typeof initializeIdentity,'function');assert.equal(typeof unlockIdentity,'function');assert.equal(typeof prepareEnvImport,'function');assert.equal(parseEnv('KEY=synthetic')[0].name,'KEY');assert.equal(new KeymanError('NOT_FOUND').code,'NOT_FOUND');const i=await initializeIdentity('./vault','synthetic passphrase for test','https://passman.subdomain.wtf');assert.equal((await unlockIdentity('./vault','synthetic passphrase for test')).keyId,i.keyId);",
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
  let forgeManifest = false;
  let tamperSignature = false;
  let unavailable = false;
  server = createServer(
    { key: await readFile(path.join(fixture, "key.pem")), cert },
    async (req, res) => {
      if (req.url === "/install.sh") {
        res.end(await readFile(installerFile));
        return;
      }
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
      if (
        req.url ===
        "/download/passman-v" +
          release.version +
          "/" +
          release.filename +
          ".sha256.sig"
      )
        filename = release.filename + ".sha256.sig";
      if (!filename || unavailable) {
        res.writeHead(404).end();
        return;
      }
      res.end(
        forgeManifest && filename.endsWith(".sha256")
          ? createHash("sha256").update("corrupted").digest("hex") +
              "  " +
              release.filename +
              "\n"
          : tamperSignature && filename.endsWith(".sig")
            ? Buffer.alloc(384)
            : tamper && filename.endsWith(".tgz")
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
  const profileContent =
    "# Existing shell settings\nexport PASSMAN_PROFILE_TEST=preserved\n";
  for (const name of [".bashrc", ".bash_profile", ".profile", ".zshrc"])
    await writeFile(path.join(home, name), profileContent);
  const env = {
    ...process.env,
    HOME: home,
    PASSMAN_DOWNLOAD_BASE: "https://localhost:" + port,
    PASSMAN_INSTALL_DIR: path.join(home, "install ' directory"),
    PASSMAN_BIN_DIR: path.join(home, "command directory"),
    CURL_CA_BUNDLE: path.join(fixture, "ca.pem"),
    PATH: "/usr/bin:/bin",
    ZDOTDIR: home,
    PASSMAN_NO_MODIFY_PATH: "0",
  };
  const install = () => run("sh", [installerFile], { env });
  const first = await install();
  assert.equal(first.code, 0, first.output);
  const launcher = path.join(env.PASSMAN_BIN_DIR, "passman");
  assert.equal(
    (await run(launcher, ["--version"])).output.trim(),
    release.version,
  );
  const profiles = new Map();
  for (const name of [".bashrc", ".bash_profile", ".profile", ".zshrc"]) {
    const file = path.join(home, name);
    const content = await readFile(file, "utf8");
    assert.ok(
      content.startsWith(profileContent),
      "Existing settings must survive",
    );
    profiles.set(file, content);
    const shell = await run(
      "sh",
      [
        "-c",
        `. "$HOME/${name}"; passman --version; printf '%s\\n' "$PASSMAN_PROFILE_TEST"`,
      ],
      { env },
    );
    assert.equal(shell.code, 0, shell.output);
    assert.equal(shell.output.trim(), release.version + "\npreserved");
  }
  const activation = first.output
    .split("\n")
    .find((line) => line.startsWith(". "));
  assert.ok(activation, "Print a current-terminal activation command");
  const activated = await run(
    "sh",
    [
      "-c",
      `${activation}\n${activation}\npassman --version\nprintf '%s\\n' "$PATH"`,
    ],
    { env },
  );
  assert.equal(activated.code, 0, activated.output);
  assert.equal(
    activated.output.trim(),
    release.version + "\n" + env.PASSMAN_BIN_DIR + ":" + env.PATH,
  );
  const again = await install();
  assert.equal(again.code, 0, again.output);
  for (const [file, content] of profiles)
    assert.equal(
      await readFile(file, "utf8"),
      content,
      "Reinstall must not duplicate PATH setup",
    );
  // Exercise the published copy/paste flow in the same shell, starting without
  // ~/.local/bin in PATH. Use the private runtime, not system Node.
  const commandHome = path.join(fixture, "fresh-terminal");
  await mkdir(commandHome);
  const commandEnv = {
    ...env,
    HOME: commandHome,
    ZDOTDIR: commandHome,
    PASSMAN_BIN_DIR: "",
  };
  const copied = await run(
    "sh",
    [
      "-c",
      `curl -fsSL https://localhost:${port}/install.sh | sh && . "$HOME/.local/share/passman/env" && passman --version`,
    ],
    {
      env: {
        ...commandEnv,
        PASSMAN_INSTALL_DIR: path.join(commandHome, ".local/share/passman"),
      },
    },
  );
  assert.equal(copied.code, 0, copied.output);
  assert.ok(copied.output.trim().endsWith(release.version), copied.output);
  const interactive = await run(
    "bash",
    [
      "--noprofile",
      "--rcfile",
      path.join(commandHome, ".bashrc"),
      "-ic",
      "passman --version",
    ],
    { env: commandEnv },
  );
  assert.equal(interactive.code, 0, interactive.output);
  assert.ok(
    interactive.output.trim().endsWith(release.version),
    interactive.output,
  );

  // Custom Zsh configuration and paths with shell metacharacters remain literal.
  const zshHome = path.join(home, "zsh ' $ configuration");
  await mkdir(zshHome);
  const zshInstall = await run("sh", [installerFile], {
    env: { ...env, ZDOTDIR: zshHome },
  });
  assert.equal(zshInstall.code, 0, zshInstall.output);
  const zshPath = await run(
    "sh",
    ["-c", '. "$ZDOTDIR/.zshrc"; passman --version'],
    { env: { ...env, ZDOTDIR: zshHome } },
  );
  assert.equal(zshPath.code, 0, zshPath.output);
  assert.equal(zshPath.output.trim(), release.version);
  const zshAvailable = await run("sh", ["-c", "command -v zsh"]);
  if (zshAvailable.code === 0) {
    const zsh = await run(
      zshAvailable.output.trim(),
      ["-d", "-i", "-c", "passman --version"],
      { env: { ...env, ZDOTDIR: zshHome } },
    );
    assert.equal(zsh.code, 0, zsh.output);
    assert.equal(zsh.output.trim(), release.version);
  }

  // Respect Bash login precedence without creating .bash_profile, and do not
  // overwrite symlinked dotfiles or append anything when profile edits opt out.
  const settingsHome = path.join(fixture, "existing-settings");
  await mkdir(settingsHome);
  await writeFile(path.join(settingsHome, ".bash_login"), profileContent);
  const externalProfile = path.join(fixture, "external-bashrc");
  await writeFile(externalProfile, profileContent);
  await symlink(externalProfile, path.join(settingsHome, ".bashrc"));
  const settingsEnv = { ...env, HOME: settingsHome, ZDOTDIR: settingsHome };
  const settings = await run("sh", [installerFile], { env: settingsEnv });
  assert.equal(settings.code, 0, settings.output);
  assert.match(settings.output, /could not configure .*\.bashrc/);
  assert.equal(await readFile(externalProfile, "utf8"), profileContent);
  await assert.rejects(readFile(path.join(settingsHome, ".bash_profile")), {
    code: "ENOENT",
  });
  const loginShell = await run(
    "sh",
    ["-c", '. "$HOME/.bash_login"; passman --version'],
    { env: settingsEnv },
  );
  assert.equal(loginShell.code, 0, loginShell.output);
  assert.equal(loginShell.output.trim(), release.version);
  const optedOutHome = path.join(fixture, "no-profile-edits");
  await mkdir(optedOutHome);
  await writeFile(path.join(optedOutHome, ".profile"), profileContent);
  const optedOut = await run("sh", [installerFile], {
    env: {
      ...env,
      HOME: optedOutHome,
      ZDOTDIR: optedOutHome,
      PASSMAN_NO_MODIFY_PATH: "1",
    },
  });
  assert.equal(optedOut.code, 0, optedOut.output);
  assert.equal(
    await readFile(path.join(optedOutHome, ".profile"), "utf8"),
    profileContent,
  );
  await assert.rejects(readFile(path.join(optedOutHome, ".bashrc")), {
    code: "ENOENT",
  });
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
  await signManifest(release);
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
  forgeManifest = true;
  const forged = await install();
  assert.notEqual(forged.code, 0);
  assert.match(forged.output, /signature invalid/);
  forgeManifest = false;
  tamper = false;
  tamperSignature = true;
  const unsigned = await install();
  assert.notEqual(unsigned.code, 0);
  assert.match(unsigned.output, /signature invalid/);
  tamperSignature = false;
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
  for (const [file, content] of profiles)
    assert.equal(
      await readFile(file, "utf8"),
      content,
      "Upgrades and rejected downloads preserve shell settings",
    );
  console.log(
    "Passman artifact installs offline, SDK declarations/runtime work, and HTTPS install/reinstall/tamper/PATH checks pass without changing the vault.",
  );
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(fixture, { recursive: true, force: true });
}
