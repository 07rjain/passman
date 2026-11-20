import { z } from "zod";
export { z };
export const API_PATH = "/api/passman/v1";
export const id = z
  .string()
  .uuid()
  .regex(/^[0-9a-f-]{36}$/);
export const bytes32 = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);
function canonicalBase64url(value: string) {
  switch (value.length % 4) {
    case 0:
      return true;
    case 2:
      return /[AQgw]$/.test(value);
    case 3:
      return /[AEIMQUYcgkosw048]$/.test(value);
    default:
      return false;
  }
}
export const maxValueBytes = 65_536;
export const projectName = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/);
export const secretName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/);
export const label = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => !/\p{Cc}/u.test(value));
export const originSchema = z.string().refine((value) => {
  try {
    const u = new URL(value);
    return (
      u.origin === value &&
      !u.username &&
      !u.password &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
    );
  } catch {
    return false;
  }
});
export const encryptionPublicSchema = z
  .object({ kty: z.literal("OKP"), crv: z.literal("X25519"), x: bytes32 })
  .strict();
export const encryptionPrivateSchema = encryptionPublicSchema
  .extend({ d: bytes32 })
  .strict();
export const signingPublicSchema = z
  .object({ kty: z.literal("OKP"), crv: z.literal("Ed25519"), x: bytes32 })
  .strict();
export const signingPrivateSchema = signingPublicSchema
  .extend({ d: bytes32 })
  .strict();
export type EncryptionPublic = z.infer<typeof encryptionPublicSchema>;
export type EncryptionPrivate = z.infer<typeof encryptionPrivateSchema>;
export type SigningPublic = z.infer<typeof signingPublicSchema>;
export type SigningPrivate = z.infer<typeof signingPrivateSchema>;
export const anchorSchema = z
  .object({
    version: z.literal(1),
    origin: originSchema,
    accountId: id,
    vaultId: id,
    writer: signingPublicSchema,
  })
  .strict();
export type Anchor = z.infer<typeof anchorSchema>;
export const keySchema = z
  .object({
    id: bytes32,
    version: z.number().int().positive(),
    publicKey: encryptionPublicSchema,
    privateKey: encryptionPrivateSchema,
  })
  .strict();
export type VaultKey = z.infer<typeof keySchema>;
export const keyringSchema = z
  .object({
    keys: z
      .array(keySchema)
      .min(1)
      .max(64)
      .refine(
        (keys) =>
          new Set(keys.map((key) => key.id)).size === keys.length &&
          new Set(keys.map((key) => key.version)).size === keys.length,
      ),
  })
  .strict();
export const runtimeSchema = z
  .object({
    version: z.literal(1),
    anchor: anchorSchema,
    epoch: z.number().int().positive(),
    generation: z.number().int().positive(),
    syncId: id,
    syncKey: bytes32,
    activeKeyId: bytes32,
    keys: keyringSchema.shape.keys,
    installationId: id,
  })
  .strict()
  .refine((runtime) =>
    runtime.keys.some((key) => key.id === runtime.activeKeyId),
  );
export type RuntimeMaterial = z.infer<typeof runtimeSchema>;
export const adminSchema = z
  .object({
    version: z.literal(1),
    runtime: runtimeSchema,
    signingKey: signingPrivateSchema,
  })
  .strict();
export type AdminMaterial = z.infer<typeof adminSchema>;
export const contextSchema = z
  .object({
    version: z.literal(1),
    origin: originSchema,
    accountId: id,
    vaultId: id,
    projectId: id,
    project: projectName,
    secretId: id,
    name: secretName,
    keyId: bytes32,
    epoch: z.number().int().positive(),
    revision: z.number().int().positive(),
    state: z.enum(["pending", "active", "deleted"]),
  })
  .strict();
export type RecordContext = z.infer<typeof contextSchema>;
export const envelopeSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal("HPKE-X25519-HKDF-SHA256-AES256GCM"),
    enc: bytes32,
    ciphertext: base64url
      .min(22)
      .max(Math.ceil(((maxValueBytes + 16) * 4) / 3))
      .refine(canonicalBase64url),
  })
  .strict();
export type Envelope = z.infer<typeof envelopeSchema>;
export const jws = z
  .string()
  .min(80)
  .max(1_000_000)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/)
  .refine((value) => value.split(".").every(canonicalBase64url));
export const recordSchema = z
  .object({
    context: contextSchema,
    envelope: envelopeSchema,
    signature: jws.nullable(),
  })
  .strict();
export type SecretRecord = z.infer<typeof recordSchema>;
export const boxSchema = z
  .object({
    nonce: base64url.length(16),
    ciphertext: base64url.min(22).max(700_000).refine(canonicalBase64url),
  })
  .strict();
export type Box = z.infer<typeof boxSchema>;
export const runtimePackageSchema = z
  .object({
    version: z.literal(1),
    anchor: anchorSchema,
    epoch: z.number().int().positive(),
    generation: z.number().int().positive(),
    syncId: id,
    activeKey: z
      .object({
        id: bytes32,
        version: z.number().int().positive(),
        publicKey: encryptionPublicSchema,
      })
      .strict(),
    box: boxSchema,
  })
  .strict();
export type RuntimePackage = z.infer<typeof runtimePackageSchema>;
export const passwordBoxSchema = z
  .object({
    version: z.literal(1),
    profile: z.literal("scrypt-131072-8-1"),
    salt: z.string().regex(/^[A-Za-z0-9_-]{21}[AQgw]$/),
    purpose: z.enum(["bootstrap", "administration"]),
    anchor: anchorSchema,
    epoch: z.number().int().positive(),
    revision: z.number().int().positive(),
    syncId: id,
    box: boxSchema,
  })
  .strict();
export type PasswordBox = z.infer<typeof passwordBoxSchema>;
export const bundleSchema = z
  .object({
    version: z.literal(1),
    anchor: anchorSchema,
    epoch: z.number().int().positive(),
    generation: z.number().int().positive(),
    syncId: id,
    activeKey: runtimePackageSchema.shape.activeKey,
    keyring: jws,
    bootstrap: passwordBoxSchema,
    administration: passwordBoxSchema,
  })
  .strict();
export type VaultBundle = z.infer<typeof bundleSchema>;
export const bootstrapMaterialSchema = z
  .object({
    version: z.literal(1),
    anchor: anchorSchema,
    epoch: z.number().int().positive(),
    generation: z.number().int().positive(),
    syncId: id,
    syncKey: bytes32,
  })
  .strict();
export type BootstrapMaterial = z.infer<typeof bootstrapMaterialSchema>;
export const adminRecoverySchema = z
  .object({
    version: z.literal(1),
    anchor: anchorSchema,
    epoch: z.number().int().positive(),
    signingKey: signingPrivateSchema,
  })
  .strict();
export const requestProofSchema = z
  .object({
    version: z.literal(1),
    origin: originSchema,
    accountId: id,
    vaultId: id,
    credential: z.string().min(1).max(100),
    method: z.enum(["GET", "POST", "PUT", "DELETE"]),
    target: z.string().min(1).max(1000),
    bodyHash: bytes32,
    nonce: bytes32,
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
  })
  .strict();
export type RequestProof = z.infer<typeof requestProofSchema>;
export const credentialScopeSchema = z
  .object({
    projects: z.array(id).min(1).max(100).nullable(),
    expiresAt: z.number().int().positive().nullable(),
    bootstrap: z.boolean().default(false),
    label,
  })
  .strict();
export const adminScopeSchema = z
  .object({
    projects: z.array(id).min(1).max(100).nullable(),
    expiresAt: z.number().int().positive(),
    operations: z
      .array(
        z.enum([
          "write",
          "delete",
          "transfer",
          "credentials",
          "vault",
          "projects",
        ]),
      )
      .min(1)
      .max(6),
    label,
  })
  .strict();
export const errorCodes = [
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VAULT_ALREADY_EXISTS",
  "CREDENTIAL_EXPIRED",
  "CREDENTIAL_REVOKED",
  "VAULT_NOT_PROVISIONED",
  "VAULT_LOCKED",
  "STORAGE_UNAVAILABLE",
  "PROFILE_REQUIRED",
  "CONTEXT_MISMATCH",
  "SIGNATURE_INVALID",
  "INTEGRITY_FAILED",
  "PASSWORD_INVALID",
  "PENDING_VERIFICATION_REQUIRED",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "TRANSFER_EXPIRED",
  "TRANSFER_CLAIMED",
] as const;
export type ErrorCode = (typeof errorCodes)[number];
export class PassmanError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(`Passman operation failed (${code})`);
    this.name = "PassmanError";
  }
}
export function failure(code: ErrorCode): never {
  throw new PassmanError(code);
}
