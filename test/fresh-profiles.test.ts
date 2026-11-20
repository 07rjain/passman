import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import {
  API_PATH,
  PassmanError,
  parseCredential,
  randomSecret,
  type ErrorCode,
} from "@passman/protocol";
import {
  connect,
  forgetServiceKey,
  saveServiceKey,
} from "../packages/passman/src/index.js";
import {
  credentialIndexId,
  resolveServiceKey,
} from "../packages/passman/src/connect.js";
import type {
  CustodyProfile,
  VaultSelection,
} from "../packages/passman/src/custody.js";

const origin = "https://passman.example";
const index = { origin, accountId: credentialIndexId };
const accountA = randomUUID();
const accountB = randomUUID();

class MemoryStore {
  reads = 0;
  contents = new Map<string, unknown>();

  #key(profile: CustodyProfile, selection: VaultSelection) {
    return JSON.stringify([profile, selection.origin, selection.accountId]);
  }

  async read(
    profile: CustodyProfile,
    selection: VaultSelection,
  ): Promise<unknown> {
    this.reads++;
    return this.contents.get(this.#key(profile, selection));
  }

  async write(
    profile: CustodyProfile,
    selection: VaultSelection,
    value: unknown,
    accept: (current: unknown) => boolean | Promise<boolean>,
  ) {
    const key = this.#key(profile, selection);
    if (await accept(this.contents.get(key)))
      this.contents.set(key, structuredClone(value));
  }

  async remove(profile: CustodyProfile, selection: VaultSelection) {
    this.contents.delete(this.#key(profile, selection));
  }
}

function key(accountId: string, kind = "pmr1") {
  return `${kind}.${accountId}.${randomUUID()}.${randomSecret()}`;
}

function code(expected: ErrorCode) {
  return (error: unknown) =>
    error instanceof PassmanError && error.code === expected;
}

const authorize: typeof globalThis.fetch = async (input, options) => {
  assert.equal(String(input), `${origin}${API_PATH}/status`);
  const header = new Headers(options?.headers).get("authorization");
  assert.ok(header && header.startsWith("Bearer "));
  const { accountId, id } = parseCredential(header.slice(7), "read");
  return Response.json({
    anchor: {
      version: 1,
      origin,
      accountId,
      vaultId: randomUUID(),
      writer: { kty: "OKP", crv: "Ed25519", x: randomSecret() },
    },
    epoch: 1,
    generation: 1,
    syncId: randomUUID(),
    activeKey: {
      id: randomSecret(),
      version: 1,
      publicKey: { kty: "OKP", crv: "X25519", x: randomSecret() },
    },
    credential: { id, projects: null, expiresAt: null, bootstrap: false },
  });
};

let environmentKey: string | undefined;
beforeEach(() => {
  environmentKey = process.env.PASSMAN_SERVICE_KEY;
  delete process.env.PASSMAN_SERVICE_KEY;
});
afterEach(() => {
  if (environmentKey === undefined) delete process.env.PASSMAN_SERVICE_KEY;
  else process.env.PASSMAN_SERVICE_KEY = environmentKey;
});

test("removing a default never selects a different saved account", async () => {
  const credentialStore = new MemoryStore();
  const options = { origin, credentialStore, fetch: authorize };
  const a = key(accountA),
    b = key(accountB);
  await saveServiceKey({ ...options, serviceKey: a });
  await saveServiceKey({ ...options, serviceKey: b });
  assert.equal((await connect(options)).account.accountId, accountA);
  assert.equal(await resolveServiceKey({ ...options, accountId: accountB }), b);
  await forgetServiceKey({ ...options, accountId: accountA });
  await assert.rejects(connect(options), code("PROFILE_REQUIRED"));
  await assert.rejects(
    connect({ ...options, accountId: accountA }),
    code("PROFILE_REQUIRED"),
  );
  assert.equal(
    (await connect({ ...options, accountId: accountB })).account.accountId,
    accountB,
  );
  await saveServiceKey({ ...options, serviceKey: b });
  await assert.rejects(connect(options), code("PROFILE_REQUIRED"));
  await saveServiceKey({ ...options, serviceKey: b, setDefault: true });
  assert.equal((await connect(options)).account.accountId, accountB);
});

test("a nil account credential has an independent slot from the profile index", async () => {
  const credentialStore = new MemoryStore();
  const options = { origin, credentialStore, fetch: authorize };
  const credential = key(credentialIndexId);
  await saveServiceKey({ ...options, serviceKey: credential });
  assert.deepEqual(await credentialStore.read("credential-index", index), {
    version: 1,
    accounts: [credentialIndexId],
    defaultAccount: credentialIndexId,
  });
  assert.equal(await credentialStore.read("credential", index), credential);
  assert.equal(await resolveServiceKey(options), credential);
  await forgetServiceKey({ ...options, accountId: credentialIndexId });
  assert.deepEqual(await credentialStore.read("credential-index", index), {
    version: 1,
    accounts: [],
    defaultAccount: undefined,
  });
  await saveServiceKey({ ...options, serviceKey: key(accountB) });
  await assert.rejects(connect(options), code("PROFILE_REQUIRED"));
});

test("explicit or environment credentials never consult saved profiles on error", async () => {
  const credentialStore = new MemoryStore();
  const options = { origin, credentialStore, fetch: authorize };
  const a = key(accountA),
    b = key(accountB);
  await saveServiceKey({ ...options, serviceKey: a });
  credentialStore.reads = 0;
  process.env.PASSMAN_SERVICE_KEY = b;
  assert.equal(await resolveServiceKey(options), b);
  assert.equal(await resolveServiceKey({ ...options, serviceKey: a }), a);
  await assert.rejects(
    connect({ ...options, serviceKey: "" }),
    code("UNAUTHORIZED"),
  );
  await assert.rejects(
    connect({ ...options, serviceKey: key(accountA, "pma1") }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    connect({ ...options, serviceKey: a, accountId: accountB }),
    code("CONTEXT_MISMATCH"),
  );
  await assert.rejects(
    connect({ ...options, accountId: "" }),
    code("INVALID_REQUEST"),
  );
  process.env.PASSMAN_SERVICE_KEY = "bad";
  await assert.rejects(connect(options), code("UNAUTHORIZED"));
  assert.equal(credentialStore.reads, 0);
});

test("corrupt saved indexes and substituted stored credentials fail closed", async () => {
  const credentialStore = new MemoryStore();
  const options = { origin, credentialStore, fetch: authorize };
  const a = key(accountA),
    b = key(accountB);
  for (const corrupt of [
    "invalid fixture",
    { version: 1, accounts: [accountA], defaultAccount: accountB },
    { version: 1, accounts: [accountA, accountA], defaultAccount: accountA },
  ]) {
    await credentialStore.write("credential-index", index, corrupt, () => true);
    await assert.rejects(connect(options), code("STORAGE_UNAVAILABLE"));
  }
  await credentialStore.write(
    "credential",
    { origin, accountId: accountA },
    b,
    () => true,
  );
  await assert.rejects(
    connect({ ...options, accountId: accountA }),
    code("CONTEXT_MISMATCH"),
  );
  await credentialStore.write(
    "credential",
    { origin, accountId: accountA },
    a,
    () => true,
  );
  assert.equal(await resolveServiceKey({ ...options, accountId: accountA }), a);
});
