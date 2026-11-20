import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, ".."),
  directory = await mkdtemp(path.join(tmpdir(), "keyman-mvp-pack-"));
try {
  const tarballs = [];
  for (const name of ["core", "client"]) {
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          process.env.npm_execpath,
          "pack",
          "--json",
          "--pack-destination",
          directory,
        ],
        {
          cwd: path.join(root, "packages", name),
          encoding: "utf8",
        },
      ),
    )[0];
    assert.ok(
      result.files.every(
        (f) => !/(\.env|vault\.json|ignore-docs|private-key)/.test(f.path),
      ),
    );
    tarballs.push(path.join(directory, result.filename));
  }
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "keyman-mvp-artifact-consumer",
      private: true,
      type: "module",
    }),
  );
  execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...tarballs,
    ],
    { cwd: directory, stdio: "pipe" },
  );
  await writeFile(
    path.join(directory, "check.mjs"),
    `import assert from 'node:assert/strict';import {generateIdentity,encryptValue,decryptValue} from '@keyman-mvp/core';import {KeymanClient,KeymanError,parseEnv,prepareEnvImport} from '@keyman-mvp/client';const i=await generateIdentity();const c={version:1,accountId:crypto.randomUUID(),vaultId:crypto.randomUUID(),projectId:crypto.randomUUID(),project:'demo',name:'KEY',revision:1};const e=await encryptValue('synthetic-value',i.publicKey,c);assert.equal(await decryptValue(e,i.privateKey,c),'synthetic-value');assert.equal(typeof KeymanClient,'function');assert.equal(new KeymanError('NOT_FOUND').code,'NOT_FOUND');assert.equal(parseEnv('KEY=synthetic-value')[0].name,'KEY');const profile={version:1,origin:'https://artifact.test',...i,vault:{id:c.vaultId,accountId:c.accountId,publicKey:i.publicKey,keyId:i.keyId},upload:{token:'kmu_'+'a'.repeat(43),expiresAt:Math.floor(Date.now()/1000)+1200}};const prepared=await prepareEnvImport({identity:profile,project:'demo',source:'KEY=synthetic-value',transport:async url=>Response.json(String(url).endsWith('import-context')?{vault:profile.vault,project:{id:c.projectId,name:'demo'},entries:[{name:'KEY',revision:0}]}:{imported:[{name:'KEY',revision:1}]})});assert.ok(!JSON.stringify(prepared).includes('synthetic-value'));assert.equal((await prepared.commit()).imported.length,1);`,
  );
  execFileSync(process.execPath, ["check.mjs"], {
    cwd: directory,
    stdio: "pipe",
  });
  await writeFile(
    path.join(directory, "consumer.ts"),
    `import {KeymanClient,prepareEnvImport,type PreparedEnvImport,type Identity} from '@keyman-mvp/client';declare const identity:Identity;const client=new KeymanClient({identity,project:'demo',serviceKey:'configured-locally'});const result:Promise<string>=client.getSecret({name:'KEY'});void result;const plan:Promise<PreparedEnvImport>=prepareEnvImport({identity,project:'demo',source:'KEY=synthetic'});void plan;`,
  );
  execFileSync(
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
    { cwd: directory, stdio: "pipe" },
  );
  const help = execFileSync(
    process.execPath,
    [path.join(directory, "node_modules/@keyman-mvp/client/dist/cli.js")],
    { encoding: "utf8" },
  );
  assert.match(help, /No command prints provider values/);
  console.log(
    "Core/client tarballs install, type-check, encrypt/decrypt, and expose the CLI.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
