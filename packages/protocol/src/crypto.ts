import {
  CipherSuite,
  DhkemX25519HkdfSha256,
  HkdfSha256,
  Aes256Gcm,
} from "@hpke/core";
import { CompactSign, compactVerify, importJWK } from "jose";
import {
  adminSchema,
  anchorSchema,
  bootstrapMaterialSchema,
  boxSchema,
  contextSchema,
  encryptionPrivateSchema,
  encryptionPublicSchema,
  envelopeSchema,
  failure,
  jws,
  keyringSchema,
  keySchema,
  maxValueBytes,
  PassmanError,
  recordSchema,
  runtimePackageSchema,
  runtimeSchema,
  signingPrivateSchema,
  signingPublicSchema,
  type AdminMaterial,
  type Anchor,
  type BootstrapMaterial,
  type Box,
  type EncryptionPrivate,
  type EncryptionPublic,
  type ErrorCode,
  type RecordContext,
  type RuntimeMaterial,
  type RuntimePackage,
  type SecretRecord,
  type SigningPrivate,
  type SigningPublic,
  type VaultKey,
  type z,
} from "./schemas.js";
import {
  anchorTuple,
  b64,
  contextTuple,
  decoder,
  digest,
  encoder,
  jsonBytes,
  sameAnchor,
  unb64,
} from "./encoding.js";

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown, code: ErrorCode): T {
  const result = schema.safeParse(value);
  if (!result.success) return failure(code);
  return result.data;
}

function encryptionKeyId(x: string) {
  return digest(jsonBytes(["passman/encryption", 1, x]));
}

export async function generateEncryptionKey(version = 1): Promise<VaultKey> {
  const keys = await suite.kem.generateKeyPair();
  const pub = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const priv = await crypto.subtle.exportKey("jwk", keys.privateKey);
  const publicKey = parse(
    encryptionPublicSchema,
    { kty: pub.kty, crv: pub.crv, x: pub.x },
    "INTEGRITY_FAILED",
  );
  return parse(
    keySchema,
    {
      version,
      id: await encryptionKeyId(publicKey.x),
      publicKey,
      privateKey: { kty: priv.kty, crv: priv.crv, x: priv.x, d: priv.d },
    },
    "INTEGRITY_FAILED",
  );
}

export async function generateSigningKey() {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  const pub = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const priv = await crypto.subtle.exportKey("jwk", keys.privateKey);
  return {
    publicKey: parse(
      signingPublicSchema,
      { kty: pub.kty, crv: pub.crv, x: pub.x },
      "INTEGRITY_FAILED",
    ),
    privateKey: parse(
      signingPrivateSchema,
      { kty: priv.kty, crv: priv.crv, x: priv.x, d: priv.d },
      "INTEGRITY_FAILED",
    ),
  };
}

export async function signObject(
  value: unknown,
  privateKey: SigningPrivate,
  purpose: string,
): Promise<string> {
  try {
    const key = await importJWK(
      signingPrivateSchema.parse(privateKey),
      "Ed25519",
    );
    const signed = await new CompactSign(jsonBytes(value))
      .setProtectedHeader({ alg: "Ed25519", typ: purpose })
      .sign(key);
    return jws.parse(signed);
  } catch {
    return failure("SIGNATURE_INVALID");
  }
}

export async function verifyObject(
  input: string,
  publicKey: SigningPublic,
  purpose: string,
): Promise<unknown> {
  try {
    const compact = jws.parse(input);
    const key = await importJWK(
      signingPublicSchema.parse(publicKey),
      "Ed25519",
    );
    const result = await compactVerify(compact, key, {
      algorithms: ["Ed25519"],
    });
    if (
      result.protectedHeader.typ !== purpose ||
      Object.keys(result.protectedHeader).length !== 2
    )
      return failure("SIGNATURE_INVALID");
    return JSON.parse(decoder.decode(result.payload));
  } catch {
    return failure("SIGNATURE_INVALID");
  }
}

export async function sealValue(
  value: string,
  publicKey: EncryptionPublic,
  input: RecordContext,
): Promise<SecretRecord> {
  if (typeof value !== "string" || value.length > maxValueBytes)
    return failure("INVALID_REQUEST");
  const context = parse(contextSchema, input, "INVALID_REQUEST");
  const key = parse(encryptionPublicSchema, publicKey, "INVALID_REQUEST");
  if ((await encryptionKeyId(key.x)) !== context.keyId)
    return failure("CONTEXT_MISMATCH");
  const bytes = encoder.encode(value);
  try {
    if (bytes.length > maxValueBytes || decoder.decode(bytes) !== value)
      return failure("INVALID_REQUEST");
    const recipientPublicKey = await crypto.subtle.importKey(
      "jwk",
      key,
      "X25519",
      true,
      [],
    );
    const result = await suite.seal(
      { recipientPublicKey, info: encoder.encode("passman/value/1") },
      bytes,
      jsonBytes(contextTuple(context)),
    );
    const envelope = parse(
      envelopeSchema,
      {
        version: 1,
        suite: "HPKE-X25519-HKDF-SHA256-AES256GCM",
        enc: b64(new Uint8Array(result.enc)),
        ciphertext: b64(new Uint8Array(result.ct)),
      },
      "INTEGRITY_FAILED",
    );
    return { context, envelope, signature: null };
  } catch (error) {
    if (error instanceof PassmanError) throw error;
    return failure("INTEGRITY_FAILED");
  } finally {
    bytes.fill(0);
  }
}

export async function openValue(
  input: unknown,
  privateInput: EncryptionPrivate,
  expected: RecordContext,
): Promise<string> {
  const record = parse(recordSchema, input, "INTEGRITY_FAILED");
  const key = parse(encryptionPrivateSchema, privateInput, "INTEGRITY_FAILED");
  const expectedTuple = contextTuple(
    parse(contextSchema, expected, "INVALID_REQUEST"),
  );
  if (
    JSON.stringify(contextTuple(record.context)) !==
      JSON.stringify(expectedTuple) ||
    (await encryptionKeyId(key.x)) !== record.context.keyId
  ) {
    return failure("CONTEXT_MISMATCH");
  }
  try {
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      key,
      "X25519",
      false,
      ["deriveBits"],
    );
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      { kty: key.kty, crv: key.crv, x: key.x },
      "X25519",
      true,
      [],
    );
    const result = new Uint8Array(
      await suite.open(
        {
          recipientKey: { publicKey, privateKey },
          enc: unb64(record.envelope.enc, 32),
          info: encoder.encode("passman/value/1"),
        },
        unb64(record.envelope.ciphertext),
        jsonBytes(expectedTuple),
      ),
    );
    try {
      return decoder.decode(result);
    } finally {
      result.fill(0);
    }
  } catch {
    return failure("INTEGRITY_FAILED");
  }
}

function recordPayload(record: SecretRecord) {
  return [
    contextTuple(record.context),
    record.envelope.enc,
    record.envelope.ciphertext,
  ];
}

export async function signRecord(
  input: SecretRecord,
  key: SigningPrivate,
): Promise<SecretRecord> {
  const record = parse(recordSchema, input, "INVALID_REQUEST");
  if (record.context.state === "pending") return failure("INVALID_REQUEST");
  return {
    ...record,
    signature: await signObject(
      recordPayload(record),
      key,
      "passman-record+jws",
    ),
  };
}

export async function verifyRecord(
  input: unknown,
  anchorInput: Anchor,
  requested: { project: string; name: string },
): Promise<SecretRecord> {
  const record = parse(recordSchema, input, "INTEGRITY_FAILED");
  const anchor = parse(anchorSchema, anchorInput, "INTEGRITY_FAILED");
  const context = record.context;
  if (
    context.origin !== anchor.origin ||
    context.accountId !== anchor.accountId ||
    context.vaultId !== anchor.vaultId ||
    context.project !== requested.project ||
    context.name !== requested.name
  )
    return failure("CONTEXT_MISMATCH");
  if (context.state === "pending")
    return failure("PENDING_VERIFICATION_REQUIRED");
  if (!record.signature) return failure("SIGNATURE_INVALID");
  const verified = await verifyObject(
    record.signature,
    anchor.writer,
    "passman-record+jws",
  );
  if (JSON.stringify(verified) !== JSON.stringify(recordPayload(record)))
    return failure("SIGNATURE_INVALID");
  return record;
}

export async function sealBox(
  value: unknown,
  rawKey: string,
  context: unknown,
): Promise<Box> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const bytes = jsonBytes(value);
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      unb64(rawKey, 32),
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    );
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: jsonBytes(context) },
      key,
      bytes,
    );
    return parse(
      boxSchema,
      { nonce: b64(nonce), ciphertext: b64(new Uint8Array(encrypted)) },
      "INVALID_REQUEST",
    );
  } finally {
    bytes.fill(0);
  }
}

export async function openBox(
  input: unknown,
  rawKey: string,
  context: unknown,
): Promise<unknown> {
  try {
    const box = boxSchema.parse(input);
    const key = await crypto.subtle.importKey(
      "raw",
      unb64(rawKey, 32),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: unb64(box.nonce, 12),
          additionalData: jsonBytes(context),
        },
        key,
        unb64(box.ciphertext),
      ),
    );
    try {
      return JSON.parse(decoder.decode(plain));
    } finally {
      plain.fill(0);
    }
  } catch {
    return failure("INTEGRITY_FAILED");
  }
}

export async function validateRuntime(
  input: unknown,
): Promise<RuntimeMaterial> {
  const runtime = parse(runtimeSchema, input, "INTEGRITY_FAILED");
  await Promise.all(
    runtime.keys.map(async ({ id, publicKey, privateKey }) => {
      if (
        publicKey.x !== privateKey.x ||
        (await encryptionKeyId(publicKey.x)) !== id
      )
        return failure("CONTEXT_MISMATCH");
      try {
        // Node's X25519 JWK import checks that d derives the supplied x.
        await crypto.subtle.importKey("jwk", privateKey, "X25519", false, [
          "deriveBits",
        ]);
      } catch {
        return failure("INTEGRITY_FAILED");
      }
    }),
  );
  return runtime;
}

export async function validateAdministration(
  input: unknown,
): Promise<AdminMaterial> {
  const admin = parse(adminSchema, input, "INTEGRITY_FAILED");
  if (admin.signingKey.x !== admin.runtime.anchor.writer.x)
    return failure("CONTEXT_MISMATCH");
  try {
    await importJWK(admin.signingKey, "Ed25519");
  } catch {
    return failure("INTEGRITY_FAILED");
  }
  await validateRuntime(admin.runtime);
  return admin;
}

export function runtimePackageContext(p: Omit<RuntimePackage, "box">) {
  return [
    "passman/runtime",
    anchorTuple(p.anchor),
    p.epoch,
    p.generation,
    p.syncId,
    p.activeKey.id,
    p.activeKey.version,
    p.activeKey.publicKey.x,
  ];
}

export async function signRuntime(
  runtimeInput: RuntimeMaterial,
  signer: SigningPrivate,
) {
  const runtime = await validateRuntime(runtimeInput);
  const key = parse(signingPrivateSchema, signer, "SIGNATURE_INVALID");
  if (key.x !== runtime.anchor.writer.x) return failure("CONTEXT_MISMATCH");
  const active = runtime.keys.find(
    (candidate) => candidate.id === runtime.activeKeyId,
  );
  if (!active) return failure("CONTEXT_MISMATCH");
  const metadata = {
    version: 1 as const,
    anchor: runtime.anchor,
    epoch: runtime.epoch,
    generation: runtime.generation,
    syncId: runtime.syncId,
    activeKey: {
      id: active.id,
      version: active.version,
      publicKey: active.publicKey,
    },
  };
  const box = await sealBox(
    { keys: runtime.keys },
    runtime.syncKey,
    runtimePackageContext(metadata),
  );
  return signObject({ ...metadata, box }, key, "passman-keyring+jws");
}

export async function inspectRuntimePackage(
  input: string,
  anchorInput: Anchor,
): Promise<RuntimePackage> {
  const anchor = parse(anchorSchema, anchorInput, "INTEGRITY_FAILED");
  const response = await verifyObject(
    input,
    anchor.writer,
    "passman-keyring+jws",
  );
  const runtime = parse(runtimePackageSchema, response, "INTEGRITY_FAILED");
  if (
    !sameAnchor(runtime.anchor, anchor) ||
    (await encryptionKeyId(runtime.activeKey.publicKey.x)) !==
      runtime.activeKey.id
  )
    return failure("CONTEXT_MISMATCH");
  return runtime;
}

export async function openRuntime(
  input: string,
  bootstrapInput: BootstrapMaterial,
  installationId: string,
): Promise<RuntimeMaterial> {
  const bootstrap = parse(
    bootstrapMaterialSchema,
    bootstrapInput,
    "INTEGRITY_FAILED",
  );
  return unpackRuntime(input, bootstrap, installationId);
}

async function unpackRuntime(
  input: string,
  bootstrap: BootstrapMaterial,
  installationId: string,
): Promise<RuntimeMaterial> {
  const runtime = await inspectRuntimePackage(input, bootstrap.anchor);
  if (
    runtime.syncId !== bootstrap.syncId ||
    runtime.epoch !== bootstrap.epoch ||
    runtime.generation < bootstrap.generation
  )
    return failure("CONTEXT_MISMATCH");
  const content = await openBox(
    runtime.box,
    bootstrap.syncKey,
    runtimePackageContext(runtime),
  );
  const { keys } = parse(keyringSchema, content, "INTEGRITY_FAILED");
  const active = keys.find(
    (candidate) => candidate.id === runtime.activeKey.id,
  );
  if (
    !active ||
    active.version !== runtime.activeKey.version ||
    active.publicKey.x !== runtime.activeKey.publicKey.x
  )
    return failure("CONTEXT_MISMATCH");
  return validateRuntime({
    version: 1,
    anchor: bootstrap.anchor,
    epoch: bootstrap.epoch,
    generation: runtime.generation,
    syncId: bootstrap.syncId,
    syncKey: bootstrap.syncKey,
    activeKeyId: active.id,
    keys,
    installationId,
  });
}

export async function refreshRuntime(
  input: string,
  currentInput: RuntimeMaterial,
): Promise<RuntimeMaterial> {
  const current = await validateRuntime(currentInput);
  const next = await unpackRuntime(input, current, current.installationId);
  if (next.generation !== current.generation) return next;
  const known = new Map(current.keys.map((key) => [key.id, key]));
  if (
    next.activeKeyId !== current.activeKeyId ||
    next.keys.length !== current.keys.length ||
    next.keys.some(({ id, version, privateKey }) => {
      const prior = known.get(id);
      return prior?.version !== version || prior.privateKey.d !== privateKey.d;
    })
  ) {
    return failure("CONTEXT_MISMATCH");
  }
  return next;
}
