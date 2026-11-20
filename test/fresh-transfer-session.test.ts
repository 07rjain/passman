import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { b64, digest, jsonBytes, randomSecret } from "@passman/protocol";
import {
  FileTransferSessions,
  receiveTransfer,
} from "../packages/passman/src/transfers.js";

function fixture() {
  const selection = {
    origin: "https://vault.example.test",
    accountId: randomUUID(),
  };
  let data: unknown;
  const sessions = new FileTransferSessions(
    {
      async read() {
        return data;
      },
      async write(_profile, _selection, input, accept) {
        if (await accept(data)) data = input;
      },
    },
    selection,
  );
  return { sessions, selection, stored: () => data };
}

test("forgetting a recipient session erases only the named transfer proof", async () => {
  const { sessions, stored } = fixture();
  const transferId = randomUUID();
  const receiving = {
    version: 1 as const,
    transferId,
    expiresAt: Date.now() + 60_000,
    codeHash: await digest("synthetic transfer code"),
    sessionSecret: randomSecret(),
    installationId: randomUUID(),
  };
  await sessions.save(transferId, receiving);
  await assert.rejects(sessions.load(randomUUID()), { code: "CONFLICT" });
  await assert.rejects(sessions.abandon(randomUUID()), { code: "CONFLICT" });
  await assert.rejects(sessions.abandon("invalid-id"), {
    code: "INVALID_REQUEST",
  });
  assert.deepEqual(await sessions.load(transferId), receiving);
  await sessions.abandon(transferId);
  assert.equal(await sessions.load(transferId), undefined);
  assert.deepEqual(stored(), { completed: transferId });
  const restarted = { ...receiving, sessionSecret: randomSecret() };
  await sessions.save(transferId, restarted);
  await assert.rejects(sessions.complete(transferId, receiving), {
    code: "CONFLICT",
  });
  assert.deepEqual(await sessions.load(transferId), restarted);
  await sessions.abandon(transferId);
  const expiredId = randomUUID();
  const expired = {
    ...receiving,
    transferId: expiredId,
    expiresAt: Date.now() - 1,
  };
  await sessions.save(expiredId, expired);
  assert.deepEqual(await sessions.load(expiredId), expired);
  await assert.rejects(
    sessions.save(expiredId, { ...expired, sessionSecret: randomSecret() }),
    { code: "CONFLICT" },
  );
  const next = { ...receiving, transferId: randomUUID() };
  await sessions.save(next.transferId, next);
  assert.deepEqual(await sessions.load(next.transferId), next);
});

test("terminal claim denial clears a staged proof while an interrupted claim preserves it", async () => {
  const { sessions, selection } = fixture();
  const code = {
    version: 1 as const,
    ...selection,
    vaultId: randomUUID(),
    transferId: randomUUID(),
    expiresAt: Date.now() + 60_000,
    epoch: 1,
    encryptionKey: randomSecret(),
    claimSecret: randomSecret(),
  };
  const receiver = {
    origin: code.origin,
    serviceKey: `pmr1.${code.accountId}.${randomUUID()}.${randomSecret()}`,
    code: `pmt1.${b64(jsonBytes(code))}`,
    sessions,
    custody: {
      async loadRuntime() {
        return undefined;
      },
      async saveRuntime() {
        assert.fail("denied claim must not install material");
      },
    },
  };
  await assert.rejects(
    receiveTransfer({
      ...receiver,
      fetch: async () => {
        throw new Error("synthetic interrupted request");
      },
    }),
    { code: "UNAVAILABLE" },
  );
  assert.ok(await sessions.load(code.transferId));
  await assert.rejects(
    receiveTransfer({
      ...receiver,
      fetch: async () =>
        Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    }),
    { code: "FORBIDDEN" },
  );
  assert.equal(await sessions.load(code.transferId), undefined);
});
