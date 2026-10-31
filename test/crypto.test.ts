import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  CipherSuite,
  Aes256Gcm,
  DhkemX25519HkdfSha256,
  HkdfSha256,
} from "@hpke/core";
import {
  generateIdentity,
  encryptValue,
  decryptValue,
  base64url,
  unbase64url,
  CryptoError,
  publicKeySchema,
  type SecretContext,
} from "@keyman-mvp/core";
const context: SecretContext = {
  version: 1,
  accountId: randomUUID(),
  vaultId: randomUUID(),
  projectId: randomUUID(),
  project: "production",
  name: "PROVIDER_API_KEY",
  revision: 1,
};
await test("HPKE records transport UTF-8 and empty values; each seal is independent", async () => {
  const identity = await generateIdentity();
  for (const value of [
    "",
    "synthetic-value",
    '🔒 arbitrary JSON: {"hello":true}',
  ]) {
    const a = await encryptValue(value, identity.publicKey, context),
      b = await encryptValue(value, identity.publicKey, context);
    assert.notEqual(a.enc, b.enc);
    assert.equal(
      await decryptValue(
        JSON.parse(JSON.stringify(a)),
        identity.privateKey,
        context,
      ),
      value,
    );
  }
});
await test("independent HPKE receiver consumes the documented envelope/context profile", async () => {
  const identity = await generateIdentity(),
    record = await encryptValue(
      "synthetic-wire-value",
      identity.publicKey,
      context,
    );
  const pair = {
    privateKey: await crypto.subtle.importKey(
      "jwk",
      identity.privateKey,
      { name: "X25519" },
      false,
      ["deriveBits"],
    ),
    publicKey: await crypto.subtle.importKey(
      "jwk",
      identity.publicKey,
      { name: "X25519" },
      true,
      [],
    ),
  };
  const info = new TextEncoder().encode(
    JSON.stringify([
      "keyman-mvp-value",
      1,
      context.accountId,
      context.vaultId,
      context.projectId,
      context.project,
      context.name,
      context.revision,
    ]),
  );
  const suite = new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
  const plain = await suite.open(
    { recipientKey: pair, enc: unbase64url(record.enc), info },
    unbase64url(record.ciphertext),
    info,
  );
  assert.equal(new TextDecoder().decode(plain), "synthetic-wire-value");
});
await test("wrong keys, altered ciphertext, and every account/project/name/revision context fail", async () => {
  const identity = await generateIdentity(),
    other = await generateIdentity(),
    record = await encryptValue("synthetic-value", identity.publicKey, context);
  await assert.rejects(
    decryptValue(record, other.privateKey, context),
    CryptoError,
  );
  for (const change of [
    { accountId: randomUUID() },
    { vaultId: randomUUID() },
    { projectId: randomUUID() },
    { project: "different" },
    { name: "OTHER" },
    { revision: 2 },
  ])
    await assert.rejects(
      decryptValue(record, identity.privateKey, { ...context, ...change }),
      CryptoError,
    );
  const tampered = unbase64url(record.ciphertext);
  tampered[0] = (tampered[0] ?? 0) ^ 1;
  await assert.rejects(
    decryptValue(
      { ...record, ciphertext: base64url(tampered) },
      identity.privateKey,
      context,
    ),
    CryptoError,
  );
  await assert.rejects(
    decryptValue(
      { ...record, enc: record.enc + "=" },
      identity.privateKey,
      context,
    ),
    CryptoError,
  );
  await assert.rejects(
    encryptValue("x".repeat(65537), identity.publicKey, context),
    CryptoError,
  );
  assert.throws(() => publicKeySchema.parse(identity.privateKey));
});
