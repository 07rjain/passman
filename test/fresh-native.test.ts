import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
  NativeRuntimeCustody,
  NativeStore,
} from "../packages/passman/src/native-custody.js";
import { initializeVault } from "../packages/passman/src/vault.js";

test(
  "native keystore persists runtime and service credential with no interactive unlock",
  {
    skip:
      process.env.PASSMAN_NATIVE_FIXTURE !== "1"
        ? "Use an isolated native runner; Linux: npm run test:fresh:native"
        : false,
  },
  async () => {
    const store = new NativeStore(),
      custody = new NativeRuntimeCustody();
    const { admin } = await initializeVault(
      "http://localhost:3100",
      randomUUID(),
      "synthetic native keyring fixture",
    );
    const selection = admin.runtime.anchor;
    const token = `synthetic-native-${randomUUID()}`;
    try {
      assert.equal(await store.read("credential", selection), undefined);
      await store.write(
        "credential",
        selection,
        token,
        (current) => current === undefined,
      );
      assert.equal(
        await new NativeStore().read("credential", selection),
        token,
      );
      const replacement = `synthetic-replacement-${randomUUID()}`;
      await assert.doesNotReject(
        () =>
          store.write(
            "credential",
            selection,
            replacement,
            (current) => current === token,
          ),
        "Replacing an existing native credential must succeed",
      );
      assert.equal(
        await new NativeStore().read("credential", selection),
        replacement,
      );
      await custody.saveRuntime(admin.runtime);
      const restored = await new NativeRuntimeCustody().loadRuntime(selection);
      assert.deepEqual(restored, admin.runtime);
      assert.equal("signingKey" in restored!, false);
      await store.write(
        "runtime",
        selection,
        {
          ...admin.runtime,
          anchor: { ...admin.runtime.anchor, accountId: randomUUID() },
        },
        () => true,
      );
      await assert.rejects(custody.loadRuntime(selection), {
        code: "CONTEXT_MISMATCH",
      });
      await assert.rejects(
        new NativeRuntimeCustody().saveRuntime({
          ...admin.runtime,
          generation: 0,
        }),
      );
    } finally {
      await store.remove("runtime", selection);
      await store.remove("credential", selection);
    }
    assert.equal(await store.read("runtime", selection), undefined);
  },
);

const isolated =
  process.platform === "linux" &&
  process.env.PASSMAN_NATIVE_FIXTURE === "1" &&
  process.env.PASSMAN_NATIVE_ISOLATED === "1";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test(
  "native stores serialize competing writes within one account profile",
  {
    skip: isolated
      ? false
      : "Requires the isolated Linux Secret Service fixture",
  },
  async () => {
    const firstStore = new NativeStore();
    const secondStore = new NativeStore();
    const selection = {
      origin: "http://localhost:3100",
      accountId: randomUUID(),
    };
    const firstToken = `synthetic-winner-${randomUUID()}`;
    const secondToken = `synthetic-contender-${randomUUID()}`;
    const entered = deferred();
    const release = deferred();
    const contender = deferred();
    let second: Promise<void> | undefined;
    const first = firstStore.write(
      "credential",
      selection,
      firstToken,
      async (current) => {
        assert.equal(current, undefined);
        entered.resolve();
        await release.promise;
        return true;
      },
    );
    try {
      await Promise.race([entered.promise, first]);
      second = secondStore.write(
        "credential",
        selection,
        secondToken,
        (current) => {
          contender.resolve();
          assert.equal(current, firstToken);
          return false;
        },
      );
      const competing = second.then(() => "second finished");
      assert.equal(
        await Promise.race([
          contender.promise,
          competing,
          delay(150, "protected"),
        ]),
        "protected",
      );
      release.resolve();
      await Promise.all([first, second]);
      assert.equal(
        await new NativeStore().read("credential", selection),
        firstToken,
      );
      assert.equal(
        await secondStore.read("admin-credential", selection),
        undefined,
      );
      assert.equal(
        await secondStore.read("credential", {
          ...selection,
          accountId: randomUUID(),
        }),
        undefined,
      );
    } finally {
      release.resolve();
      await Promise.allSettled([first, second]);
      await firstStore.remove("credential", selection);
    }
  },
);

test(
  "locked Secret Service rejects reads and writes with VAULT_LOCKED",
  {
    skip: isolated
      ? false
      : "Locking the collection requires the isolated Linux Secret Service fixture",
    timeout: 8_000,
  },
  async () => {
    const store = new NativeStore();
    const selection = {
      origin: "http://localhost:3100",
      accountId: randomUUID(),
    };
    await store.write(
      "credential",
      selection,
      "synthetic locked fixture",
      () => true,
    );
    // The isolated runner removes the entire locked collection after this test.
    await promisify(execFile)(
      "/usr/bin/python3",
      [
        "-c",
        `
import dbus
bus=dbus.SessionBus()
obj=bus.get_object('org.freedesktop.secrets','/org/freedesktop/secrets')
service=dbus.Interface(obj,'org.freedesktop.Secret.Service')
collection=service.ReadAlias('default')
assert collection!='/'
service.Lock([collection])
properties=dbus.Interface(bus.get_object('org.freedesktop.secrets',collection),'org.freedesktop.DBus.Properties')
assert properties.Get('org.freedesktop.Secret.Collection','Locked')
`,
      ],
      { timeout: 5_000 },
    );
    await assert.rejects(store.read("credential", selection), {
      code: "VAULT_LOCKED",
    });
    await assert.rejects(
      store.write(
        "credential",
        { ...selection, accountId: randomUUID() },
        "synthetic blocked fixture",
        () => true,
      ),
      { code: "VAULT_LOCKED" },
    );
  },
);

const macKeychain =
  process.platform === "darwin" && process.env.PASSMAN_NATIVE_FIXTURE === "1"
    ? process.env.PASSMAN_NATIVE_MACOS_KEYCHAIN
    : undefined;
test(
  "locked macOS fixture rejects existing reads and new writes without prompting",
  {
    skip: macKeychain ? false : "Requires the isolated macOS Keychain fixture",
    timeout: 8000,
  },
  async () => {
    assert(macKeychain);
    const password = process.env.PASSMAN_NATIVE_MACOS_PASSWORD;
    assert(password);
    const store = new NativeStore(),
      selection = { origin: "http://localhost:3100", accountId: randomUUID() };
    await store.write(
      "credential",
      selection,
      "synthetic macOS locked fixture",
      () => true,
    );
    const security = promisify(execFile);
    try {
      await security("/usr/bin/security", ["lock-keychain", macKeychain], {
        timeout: 5000,
      });
      await assert.rejects(store.read("credential", selection), {
        code: "VAULT_LOCKED",
      });
      await assert.rejects(
        store.write(
          "credential",
          { ...selection, accountId: randomUUID() },
          "synthetic blocked fixture",
          () => true,
        ),
        { code: "VAULT_LOCKED" },
      );
    } finally {
      await security(
        "/usr/bin/security",
        ["unlock-keychain", "-p", password, macKeychain],
        { timeout: 5000 },
      );
      await store.remove("credential", selection);
    }
  },
);
