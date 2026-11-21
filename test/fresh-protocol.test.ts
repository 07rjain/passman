import assert from "node:assert/strict";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { test } from "node:test";
import {
  Aes256Gcm,
  CipherSuite,
  DhkemX25519HkdfSha256,
  HkdfSha256,
} from "@hpke/core";
import {
  b64,
  generateEncryptionKey,
  generateSigningKey,
  inspectRuntimePackage,
  openBox,
  openRuntime,
  openValue,
  parseCredential,
  randomSecret,
  refreshRuntime,
  runtimePackageContext,
  sealBox,
  sealValue,
  signObject,
  signRecord,
  signRuntime,
  validateAdministration,
  validateRuntime,
  verifyObject,
  verifyRecord,
  type BootstrapMaterial,
  type RecordContext,
  type RuntimeMaterial,
} from "@passman/protocol";

async function vault() {
  const [writer, key] = await Promise.all([
    generateSigningKey(),
    generateEncryptionKey(),
  ]);
  const bootstrap: BootstrapMaterial = {
    version: 1,
    anchor: {
      version: 1,
      origin: "https://vault.example.test",
      accountId: randomUUID(),
      vaultId: randomUUID(),
      writer: writer.publicKey,
    },
    epoch: 1,
    generation: 1,
    syncId: randomUUID(),
    syncKey: randomSecret(),
  };
  const runtime: RuntimeMaterial = {
    ...bootstrap,
    activeKeyId: key.id,
    keys: [key],
    installationId: randomUUID(),
  };
  const context: RecordContext = {
    version: 1,
    origin: bootstrap.anchor.origin,
    accountId: bootstrap.anchor.accountId,
    vaultId: bootstrap.anchor.vaultId,
    projectId: randomUUID(),
    project: "production",
    secretId: randomUUID(),
    name: "PROVIDER_API_KEY",
    keyId: key.id,
    epoch: 1,
    revision: 1,
    state: "active",
  };
  return { bootstrap, runtime, context, writer, key };
}

function flipByte(value: string) {
  const bytes = Buffer.from(value, "base64url");
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return bytes.toString("base64url");
}

await test("read and native credentials require canonical UUIDs, kind and 32-byte secrets", () => {
  const accountId = randomUUID();
  const id = randomUUID();
  const secret = b64(new Uint8Array(32));
  assert.deepEqual(
    parseCredential(`pmr1.${accountId}.${id}.${secret}`, "read"),
    { kind: "read", accountId, id },
  );
  assert.deepEqual(
    parseCredential(`pma1.${accountId}.${id}.${secret}`, "admin"),
    { kind: "admin", accountId, id },
  );
  assert.throws(
    () => parseCredential(`pma1.${accountId}.${id}.${secret}`, "read"),
    { code: "FORBIDDEN" },
  );
  for (const malformed of [
    `pmr1.${"-".repeat(36)}.${id}.${secret}`,
    `pmr1.${accountId}.${id.replaceAll("-", "0")}.${secret}`,
    `pmr1.${accountId}.11111111-1111-4111-7111-111111111111.${secret}`,
    `pmr1.${accountId}.ABCDEF01-1111-4111-8111-111111111111.${secret}`,
    `pmr1.${accountId}.${id}.${secret.slice(0, -1)}B`,
    `pmr1.${accountId}.${id}.${secret}=`,
  ])
    assert.throws(() => parseCredential(malformed), { code: "UNAUTHORIZED" });
});

await test("RFC 8032 Ed25519 key interoperates with compact JWS and an independent signer", async () => {
  // RFC 8032 section 7.1, TEST 1.
  const publicKey = {
    kty: "OKP" as const,
    crv: "Ed25519" as const,
    x: b64(
      Buffer.from(
        "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        "hex",
      ),
    ),
  };
  const privateKey = {
    ...publicKey,
    d: b64(
      Buffer.from(
        "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
        "hex",
      ),
    ),
  };
  const nativeKey = createPrivateKey({ key: privateKey, format: "jwk" });
  assert.equal(
    sign(null, Buffer.alloc(0), nativeKey).toString("hex"),
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  );
  const purpose = "passman-record+jws";
  const value = ["test", "🔒", 42];
  const nativeJws = (header: Record<string, string>) => {
    const message = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
    return `${message}.${sign(null, Buffer.from(message), nativeKey).toString("base64url")}`;
  };
  const reference = nativeJws({ alg: "Ed25519", typ: purpose });
  assert.equal(await signObject(value, privateKey, purpose), reference);
  assert.deepEqual(await verifyObject(reference, publicKey, purpose), value);
  for (const [input, type] of [
    [reference, "passman-keyring+jws"],
    [nativeJws({ alg: "EdDSA", typ: purpose }), purpose],
    [nativeJws({ alg: "Ed25519", typ: purpose, kid: "unknown" }), purpose],
  ] as const)
    await assert.rejects(verifyObject(input, publicKey, type), {
      code: "SIGNATURE_INVALID",
    });
  const [header, payload, signature] = reference.split(".");
  assert.ok(signature);
  await assert.rejects(
    verifyObject(
      `${header}.${payload}.${flipByte(signature)}`,
      publicKey,
      purpose,
    ),
    { code: "SIGNATURE_INVALID" },
  );
});

await test("HPKE transports exact strings and interoperates with the documented context bytes", async () => {
  const { context, key } = await vault();
  for (const value of [
    "",
    "secret-🗝️",
    "\ufeffBOM preserved",
    "é".repeat(32_768),
  ]) {
    const a = await sealValue(value, key.publicKey, context);
    const b = await sealValue(value, key.publicKey, context);
    assert.notEqual(a.envelope.enc, b.envelope.enc);
    assert.equal(
      await openValue(JSON.parse(JSON.stringify(a)), key.privateKey, context),
      value,
    );
  }
  await assert.rejects(sealValue("é".repeat(32_769), key.publicKey, context), {
    code: "INVALID_REQUEST",
  });
  await assert.rejects(sealValue("\ud800", key.publicKey, context), {
    code: "INVALID_REQUEST",
  });
  const record = await sealValue("synthetic envelope", key.publicKey, context);
  const receiver = new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
  const recipientKey = {
    publicKey: await crypto.subtle.importKey(
      "jwk",
      key.publicKey,
      "X25519",
      true,
      [],
    ),
    privateKey: await crypto.subtle.importKey(
      "jwk",
      key.privateKey,
      "X25519",
      false,
      ["deriveBits"],
    ),
  };
  const aad = Buffer.from(
    JSON.stringify([
      "passman/value",
      1,
      context.origin,
      context.accountId,
      context.vaultId,
      context.projectId,
      context.project,
      context.secretId,
      context.name,
      context.keyId,
      context.epoch,
      context.revision,
      "active",
    ]),
  );
  const plain = await receiver.open(
    {
      recipientKey,
      enc: Buffer.from(record.envelope.enc, "base64url"),
      info: Buffer.from("passman/value/1"),
    },
    Buffer.from(record.envelope.ciphertext, "base64url"),
    aad,
  );
  assert.equal(Buffer.from(plain).toString("utf8"), "synthetic envelope");
});

await test("record authentication binds the pinned writer, state, context and envelope", async () => {
  const {
    context,
    key,
    runtime: { anchor },
    writer,
  } = await vault();
  const pending = await sealValue("synthetic", key.publicKey, {
    ...context,
    state: "pending",
  });
  const unsigned = await sealValue("synthetic", key.publicKey, context);
  const active = await signRecord(unsigned, writer.privateKey);
  assert.deepEqual(await verifyRecord(active, anchor, context), active);
  assert.equal(
    await openValue(pending, key.privateKey, pending.context),
    "synthetic",
  );
  await assert.rejects(signRecord(pending, writer.privateKey), {
    code: "INVALID_REQUEST",
  });
  await assert.rejects(verifyRecord(pending, anchor, context), {
    code: "PENDING_VERIFICATION_REQUIRED",
  });
  await assert.rejects(verifyRecord({ ...pending, context }, anchor, context), {
    code: "SIGNATURE_INVALID",
  });
  await assert.rejects(verifyRecord(unsigned, anchor, context), {
    code: "SIGNATURE_INVALID",
  });
  const attacker = await generateSigningKey();
  await assert.rejects(
    verifyRecord(
      await signRecord(unsigned, attacker.privateKey),
      anchor,
      context,
    ),
    { code: "SIGNATURE_INVALID" },
  );
  for (const change of [
    { origin: "https://foreign.example.test" },
    { accountId: randomUUID() },
    { vaultId: randomUUID() },
    { projectId: randomUUID() },
    { project: "another" },
    { secretId: randomUUID() },
    { name: "DIFFERENT" },
    { keyId: randomSecret() },
    { epoch: 2 },
    { revision: 2 },
    { state: "deleted" as const },
  ]) {
    const changed = { ...context, ...change };
    const changedAnchor = {
      ...anchor,
      origin: changed.origin,
      accountId: changed.accountId,
      vaultId: changed.vaultId,
    };
    await assert.rejects(
      verifyRecord({ ...active, context: changed }, changedAnchor, changed),
      { code: "SIGNATURE_INVALID" },
    );
    await assert.rejects(openValue(active, key.privateKey, changed), {
      code: "CONTEXT_MISMATCH",
    });
    if (changed.keyId === key.id)
      await assert.rejects(
        openValue({ ...active, context: changed }, key.privateKey, changed),
        { code: "INTEGRITY_FAILED" },
      );
  }
  for (const field of ["enc", "ciphertext"] as const) {
    const changed = {
      ...active,
      envelope: {
        ...active.envelope,
        [field]: flipByte(active.envelope[field]),
      },
    };
    await assert.rejects(verifyRecord(changed, anchor, context), {
      code: "SIGNATURE_INVALID",
    });
    await assert.rejects(openValue(changed, key.privateKey, context), {
      code: "INTEGRITY_FAILED",
    });
  }
  await assert.rejects(
    openValue(active, (await generateEncryptionKey()).privateKey, context),
    { code: "CONTEXT_MISMATCH" },
  );
});

await test("runtime custody rejects mismatched fingerprints, private components and key versions", async () => {
  const { runtime, writer, key } = await vault();
  const other = await generateEncryptionKey(2);
  const anotherWriter = await generateSigningKey();
  const admin = { version: 1, runtime, signingKey: writer.privateKey };
  assert.deepEqual(await validateRuntime(runtime), runtime);
  assert.deepEqual(await validateAdministration(admin), admin);
  for (const invalid of [
    { ...runtime, activeKeyId: other.id },
    { ...runtime, keys: [key, { ...key, version: 2 }] },
    { ...runtime, keys: [key, { ...other, version: 1 }] },
    {
      ...runtime,
      keys: [
        { ...key, privateKey: { ...key.privateKey, d: other.privateKey.d } },
      ],
    },
  ])
    await assert.rejects(validateRuntime(invalid), {
      code: "INTEGRITY_FAILED",
    });
  await assert.rejects(
    validateRuntime({
      ...runtime,
      activeKeyId: other.id,
      keys: [{ ...key, id: other.id }],
    }),
    { code: "CONTEXT_MISMATCH" },
  );
  await assert.rejects(
    validateRuntime({
      ...runtime,
      keys: [{ ...key, privateKey: other.privateKey }],
    }),
    { code: "CONTEXT_MISMATCH" },
  );
  await assert.rejects(
    validateAdministration({
      ...admin,
      signingKey: { ...writer.privateKey, d: anotherWriter.privateKey.d },
    }),
    { code: "INTEGRITY_FAILED" },
  );
  await assert.rejects(
    validateAdministration({ ...admin, signingKey: anotherWriter.privateKey }),
    { code: "CONTEXT_MISMATCH" },
  );
  await assert.rejects(signRuntime(runtime, anotherWriter.privateKey), {
    code: "CONTEXT_MISMATCH",
  });
});

await test("pinned writer keyrings authenticate bootstrap and refresh with a generation floor", async () => {
  const { bootstrap, runtime, writer, key } = await vault();
  const nextKey = await generateEncryptionKey(2);
  const prior = await signRuntime(runtime, writer.privateKey);
  const next = {
    ...runtime,
    generation: 2,
    keys: [key, nextKey],
    activeKeyId: nextKey.id,
  };
  const signed = await signRuntime(next, writer.privateKey);
  const install = randomUUID();
  assert.deepEqual(await openRuntime(signed, bootstrap, install), {
    ...next,
    installationId: install,
  });
  assert.deepEqual(await refreshRuntime(signed, runtime), next);
  assert.deepEqual(await refreshRuntime(signed, next), next);
  await assert.rejects(refreshRuntime(prior, next), {
    code: "CONTEXT_MISMATCH",
  });
  await assert.rejects(
    openRuntime(signed, { ...bootstrap, syncId: randomUUID() }, install),
    { code: "CONTEXT_MISMATCH" },
  );
  await assert.rejects(
    openRuntime(signed, { ...bootstrap, epoch: 2 }, install),
    { code: "CONTEXT_MISMATCH" },
  );
  await assert.rejects(
    openRuntime(signed, { ...bootstrap, syncKey: randomSecret() }, install),
    { code: "INTEGRITY_FAILED" },
  );
  const fork = await signRuntime(
    { ...next, activeKeyId: key.id },
    writer.privateKey,
  );
  await assert.rejects(refreshRuntime(fork, next), {
    code: "CONTEXT_MISMATCH",
  });
  const pkg = await inspectRuntimePackage(signed, bootstrap.anchor);
  assert.deepEqual(
    await openBox(pkg.box, bootstrap.syncKey, runtimePackageContext(pkg)),
    { keys: [key, nextKey] },
  );
  const injected = { ...pkg, activeKey: { ...pkg.activeKey, version: 3 } };
  const tamperedBox = await sealBox(
    { keys: [key, nextKey] },
    bootstrap.syncKey,
    runtimePackageContext(injected),
  );
  const attacker = await generateSigningKey();
  const forged = await signObject(
    { ...injected, box: tamperedBox },
    attacker.privateKey,
    "passman-keyring+jws",
  );
  await assert.rejects(refreshRuntime(forged, runtime), {
    code: "SIGNATURE_INVALID",
  });
  const wrongVersion = await signObject(
    { ...injected, box: tamperedBox },
    writer.privateKey,
    "passman-keyring+jws",
  );
  await assert.rejects(refreshRuntime(wrongVersion, runtime), {
    code: "CONTEXT_MISMATCH",
  });
  const substituted = await signObject(
    { ...pkg, anchor: { ...pkg.anchor, writer: attacker.publicKey } },
    writer.privateKey,
    "passman-keyring+jws",
  );
  await assert.rejects(refreshRuntime(substituted, runtime), {
    code: "CONTEXT_MISMATCH",
  });
  const wrongId = await signObject(
    { ...pkg, activeKey: { ...pkg.activeKey, id: key.id } },
    writer.privateKey,
    "passman-keyring+jws",
  );
  await assert.rejects(inspectRuntimePackage(wrongId, bootstrap.anchor), {
    code: "CONTEXT_MISMATCH",
  });
});
