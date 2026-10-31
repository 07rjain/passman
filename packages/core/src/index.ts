import {
  Aes256Gcm,
  CipherSuite,
  DhkemX25519HkdfSha256,
  HkdfSha256,
} from "@hpke/core";
import { z } from "zod";
export { z };

export const idSchema = z.string().uuid();
export const projectNameSchema = z.string().trim().min(1).max(80);
export const nameSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => new TextEncoder().encode(s).length <= 256);
const encoded = z.string().regex(/^[A-Za-z0-9_-]*$/);
export const publicKeySchema = z
  .object({
    kty: z.literal("OKP"),
    crv: z.literal("X25519"),
    x: encoded.length(43),
  })
  .strict();
export const privateKeySchema = publicKeySchema
  .extend({ d: encoded.length(43) })
  .strict();
export type PublicKey = z.infer<typeof publicKeySchema>;
export type PrivateKey = z.infer<typeof privateKeySchema>;
export const contextSchema = z
  .object({
    version: z.literal(1),
    accountId: idSchema,
    vaultId: idSchema,
    projectId: idSchema,
    project: projectNameSchema,
    name: nameSchema,
    revision: z.number().int().positive(),
  })
  .strict();
export type SecretContext = z.infer<typeof contextSchema>;
export const envelopeSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal("HPKE-X25519-HKDF-SHA256-AES256GCM"),
    keyId: encoded.length(43),
    enc: encoded.length(43),
    ciphertext: encoded.min(22).max(87403),
  })
  .strict();
export type Envelope = z.infer<typeof envelopeSchema>;
export const vaultSchema = z
  .object({
    id: idSchema,
    accountId: idSchema,
    publicKey: publicKeySchema,
    keyId: encoded.length(43),
  })
  .strict();
export type Vault = z.infer<typeof vaultSchema>;
export const projectSchema = z
  .object({ id: idSchema, name: projectNameSchema })
  .strict();
export const recordSchema = z
  .object({ context: contextSchema, envelope: envelopeSchema })
  .strict();
export const codes = [
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "KEY_MISMATCH",
  "EXPIRED",
  "RATE_LIMITED",
  "UNAVAILABLE",
] as const;
export type ErrorCode = (typeof codes)[number];
export const errorSchema = z
  .object({
    error: z.object({ code: z.enum(codes), message: z.string() }).strict(),
  })
  .strict();
const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});
const encoder = new TextEncoder();
export class CryptoError extends Error {
  constructor() {
    super("Encrypted value, key, or context is invalid");
  }
}
export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function unbase64url(
  value: string,
  length?: number,
): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length > 100000)
    throw new CryptoError();
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (
    base64url(bytes) !== value ||
    (length !== undefined && bytes.length !== length)
  )
    throw new CryptoError();
  return bytes;
}
export async function keyFingerprint(input: PublicKey): Promise<string> {
  const key = publicKeySchema.parse(input);
  const material = encoder.encode(
    JSON.stringify(["keyman-mvp-vault-key", 1, key.kty, key.crv, key.x]),
  );
  unbase64url(key.x, 32);
  return base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", material)),
  );
}
export async function generateIdentity(): Promise<{
  publicKey: PublicKey;
  privateKey: PrivateKey;
  keyId: string;
}> {
  const pair = await suite.kem.generateKeyPair();
  const rawPublic = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicKey = publicKeySchema.parse({
    kty: rawPublic.kty,
    crv: rawPublic.crv,
    x: rawPublic.x,
  });
  const raw = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const privateKey = privateKeySchema.parse({
    kty: raw.kty,
    crv: raw.crv,
    x: raw.x,
    d: raw.d,
  });
  return { publicKey, privateKey, keyId: await keyFingerprint(publicKey) };
}
function binding(input: SecretContext): Uint8Array<ArrayBuffer> {
  const c = contextSchema.parse(input);
  return encoder.encode(
    JSON.stringify([
      "keyman-mvp-value",
      c.version,
      c.accountId,
      c.vaultId,
      c.projectId,
      c.project,
      c.name,
      c.revision,
    ]),
  );
}
export async function encryptValue(
  value: string,
  publicInput: PublicKey,
  context: SecretContext,
): Promise<Envelope> {
  try {
    const bytes = encoder.encode(value);
    if (
      typeof value !== "string" ||
      bytes.length > 65536 ||
      new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== value
    )
      throw new CryptoError();
    const key = publicKeySchema.parse(publicInput);
    const recipientPublicKey = await crypto.subtle.importKey(
      "jwk",
      key,
      { name: "X25519" },
      true,
      [],
    );
    const aad = binding(context);
    const sealed = await suite.seal(
      { recipientPublicKey, info: aad },
      bytes,
      aad,
    );
    bytes.fill(0);
    return envelopeSchema.parse({
      version: 1,
      suite: "HPKE-X25519-HKDF-SHA256-AES256GCM",
      keyId: await keyFingerprint(key),
      enc: base64url(new Uint8Array(sealed.enc)),
      ciphertext: base64url(new Uint8Array(sealed.ct)),
    });
  } catch {
    throw new CryptoError();
  }
}
export async function decryptValue(
  input: unknown,
  privateInput: PrivateKey,
  context: SecretContext,
): Promise<string> {
  try {
    const envelope = envelopeSchema.parse(input),
      key = privateKeySchema.parse(privateInput);
    if (
      (await keyFingerprint(
        publicKeySchema.parse({ kty: key.kty, crv: key.crv, x: key.x }),
      )) !== envelope.keyId
    )
      throw new CryptoError();
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      key,
      { name: "X25519" },
      false,
      ["deriveBits"],
    );
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      { kty: key.kty, crv: key.crv, x: key.x },
      { name: "X25519" },
      true,
      [],
    );
    const aad = binding(context);
    const opened = new Uint8Array(
      await suite.open(
        {
          recipientKey: { privateKey, publicKey },
          enc: unbase64url(envelope.enc, 32),
          info: aad,
        },
        unbase64url(envelope.ciphertext),
        aad,
      ),
    );
    try {
      if (opened.length > 65536) throw new CryptoError();
      return new TextDecoder("utf-8", { fatal: true }).decode(opened);
    } finally {
      opened.fill(0);
    }
  } catch {
    throw new CryptoError();
  }
}
