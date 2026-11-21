import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateIdentity, decryptValue } from "@keyman-mvp/core";
import {
  prepareEnvImport,
  ImportCommitError,
  KeymanError,
  type Identity,
  type Transport,
} from "../packages/client/src/index";

async function fixture(existing = false) {
  const generated = await generateIdentity();
  const identity: Identity = {
    version: 1,
    origin: "https://import.test",
    ...generated,
    vault: {
      id: randomUUID(),
      accountId: randomUUID(),
      publicKey: generated.publicKey,
      keyId: generated.keyId,
    },
    upload: {
      token: "kmu_" + "a".repeat(43),
      expiresAt: Math.floor(Date.now() / 1000) + 1200,
    },
  };
  const project = { id: randomUUID(), name: "import" },
    paths: string[] = [];
  const transport: Transport = async (url, init) => {
    const pathname = new URL(String(url)).pathname;
    paths.push(pathname);
    const body = String(init?.body);
    assert.ok(!body.includes("synthetic-import-value"));
    assert.ok(!body.includes(identity.privateKey.d));
    const input = JSON.parse(body);
    if (pathname.endsWith("import-context"))
      return Response.json({
        vault: identity.vault,
        project,
        entries: input.names.map((name: string) => ({
          name,
          revision: existing && name === "A" ? 2 : 0,
        })),
      });
    assert.equal(pathname, "/api/upload/import");
    for (const entry of input.entries) {
      const value = await decryptValue(entry.envelope, identity.privateKey, {
        version: 1,
        accountId: identity.vault!.accountId,
        vaultId: identity.vault!.id,
        projectId: project.id,
        project: project.name,
        name: entry.name,
        revision: entry.expectedRevision + 1,
      });
      assert.equal(
        value,
        entry.name === "EMPTY" ? "" : "synthetic-import-value",
      );
    }
    return Response.json({
      imported: input.entries.map(
        (entry: { name: string; expectedRevision: number }) => ({
          name: entry.name,
          revision: entry.expectedRevision + 1,
        }),
      ),
    });
  };
  return { identity, project, paths, transport };
}

test("SDK preview serializes metadata only; commit encrypts all values in one request and is single-use", async () => {
  const f = await fixture();
  const prepared = await prepareEnvImport({
    ...f,
    project: "import",
    source: "A=synthetic-import-value\nB=synthetic-import-value",
  });
  assert.equal(prepared.preview.ready, true);
  assert.ok(!JSON.stringify(prepared).includes("synthetic-import-value"));
  assert.deepEqual(f.paths, ["/api/upload/import-context"]);
  assert.equal((await prepared.commit()).imported.length, 2);
  await assert.rejects(prepared.commit(), KeymanError);
  assert.deepEqual(f.paths, [
    "/api/upload/import-context",
    "/api/upload/import",
  ]);
});

test("SDK conflict policies stop by default, skip only existing entries or deliberately replace", async () => {
  for (const policy of ["error", "skip", "replace"] as const) {
    const f = await fixture(true);
    const prepared = await prepareEnvImport({
      ...f,
      project: "import",
      source: "A=synthetic-import-value\nB=synthetic-import-value",
      conflicts: policy,
    });
    if (policy === "error") {
      prepared.preview.ready = true;
      await assert.rejects(prepared.commit(), KeymanError);
      assert.equal(f.paths.length, 1);
    } else {
      const result = await prepared.commit();
      assert.equal(result.imported.length, policy === "skip" ? 1 : 2);
      assert.deepEqual(result.skipped, policy === "skip" ? ["A"] : []);
    }
  }
});

test("empty values need acknowledgement and all-skipped plans do not write", async () => {
  const f = await fixture(true);
  const empty = await prepareEnvImport({
    ...f,
    project: "import",
    source: "EMPTY=",
  });
  assert.equal(empty.preview.ready, false);
  await assert.rejects(empty.commit());
  const allowed = await prepareEnvImport({
    ...f,
    project: "import",
    source: "EMPTY=",
    allowEmpty: true,
  });
  assert.equal((await allowed.commit()).imported.length, 1);
  const skipped = await prepareEnvImport({
    ...f,
    project: "import",
    source: "A=",
    conflicts: "skip",
  });
  const before = f.paths.length;
  assert.deepEqual(await skipped.commit(), { imported: [], skipped: ["A"] });
  assert.equal(f.paths.length, before);
});

test("SDK rejects expiry, invalid files and substituted import context before upload", async () => {
  const f = await fixture();
  f.identity.upload!.expiresAt = 1;
  await assert.rejects(
    prepareEnvImport({
      ...f,
      project: "import",
      source: "A=synthetic-import-value",
    }),
    KeymanError,
  );
  assert.equal(f.paths.length, 0);
  f.identity.upload!.expiresAt = Math.floor(Date.now() / 1000) + 1200;
  await assert.rejects(
    prepareEnvImport({ ...f, project: "import", source: "INVALID" }),
  );
  assert.equal(f.paths.length, 0);
  for (const changed of ["account", "key", "names"]) {
    const transport: Transport = async () =>
      Response.json({
        vault: {
          ...f.identity.vault,
          ...(changed === "account"
            ? { accountId: randomUUID() }
            : changed === "key"
              ? { keyId: "b".repeat(43) }
              : {}),
        },
        project: f.project,
        entries: [{ name: changed === "names" ? "OTHER" : "A", revision: 0 }],
      });
    await assert.rejects(
      prepareEnvImport({
        identity: f.identity,
        project: "import",
        source: "A=synthetic-import-value",
        transport,
      }),
      KeymanError,
    );
  }
});

test("lost/malformed commit responses are unknown outcomes and never automatically retried", async () => {
  for (const malformed of [false, true]) {
    const f = await fixture();
    let commits = 0;
    const transport: Transport = async (url, init) => {
      if (String(url).endsWith("import-context")) return f.transport(url, init);
      commits++;
      if (malformed) return Response.json({ imported: [] });
      throw new Error("synthetic-sensitive-network-error");
    };
    const prepared = await prepareEnvImport({
      ...f,
      project: "import",
      source: "A=synthetic-import-value",
      transport,
    });
    await assert.rejects(
      prepared.commit(),
      (error: unknown) =>
        error instanceof ImportCommitError &&
        error.outcome === "unknown" &&
        !error.message.includes("sensitive"),
    );
    await assert.rejects(prepared.commit());
    assert.equal(commits, 1);
  }
});

test(
  "protected environment input rejects FIFOs promptly rather than blocking",
  { skip: process.platform === "win32" },
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "passman-env-fifo-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, "input.env");
    assert.equal(spawnSync("mkfifo", [file]).status, 0);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        'import assert from "node:assert/strict"; import {readEnvFile} from "./packages/client/src/index.ts"; await assert.rejects(readEnvFile(process.argv[1]));',
        file,
      ],
      { timeout: 5000, encoding: "utf8" },
    );
    assert.equal(
      result.status,
      0,
      "Non-regular private input did not reject promptly",
    );
  },
);
