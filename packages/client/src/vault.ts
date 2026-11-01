import { constants } from "node:fs";
import { open, mkdir, stat, lstat, rename, unlink } from "node:fs/promises";
import {
  createCipheriv,
  createDecipheriv,
  scryptSync,
  randomBytes,
  createSecretKey,
} from "node:crypto";
import path from "node:path";
import { windowsPrivatePath } from "./windows.js";
import {
  generateIdentity,
  publicKeySchema,
  privateKeySchema,
  keyFingerprint,
  z,
  vaultSchema,
} from "@keyman-mvp/core";
const profileSchema = z
  .object({
    version: z.literal(1),
    origin: z.string(),
    publicKey: publicKeySchema,
    privateKey: privateKeySchema,
    keyId: z.string().length(43),
    vault: vaultSchema.optional(),
    upload: z
      .object({
        token: z.string().regex(/^kmu_[A-Za-z0-9_-]{43}$/),
        expiresAt: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Identity = z.infer<typeof profileSchema>;
const diskSchema = z
  .object({
    version: z.literal(1),
    salt: z.string().length(22),
    nonce: z.string().length(16),
    tag: z.string().length(22),
    ciphertext: z.string().max(64000),
  })
  .strict();
export class LocalVaultError extends Error {
  constructor() {
    super(
      "Local vault unavailable: check its passphrase, ownership and permissions; no recovery override exists",
    );
  }
}
export function apiOrigin(value: string) {
  const url = new URL(value);
  if (
    value !== url.origin ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new LocalVaultError();
  return url.origin;
}
async function directory(pathname: string) {
  const created = await mkdir(pathname, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    try {
      await windowsPrivatePath(pathname, created !== undefined);
    } catch {
      throw new LocalVaultError();
    }
    return;
  }
  const info = await stat(pathname);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  )
    throw new LocalVaultError();
}
export async function readPrivateFile(
  file: string,
  max = 100000,
): Promise<string> {
  if (process.platform === "win32") {
    try {
      await windowsPrivatePath(file);
    } catch {
      throw new LocalVaultError();
    }
  }
  const before = await lstat(file);
  if (before.isSymbolicLink()) throw new LocalVaultError();
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      (process.platform !== "win32" &&
        (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)) ||
      info.ino !== before.ino ||
      info.dev !== before.dev ||
      info.size > max
    )
      throw new LocalVaultError();
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
function key(password: string, salt: Buffer) {
  if (password.length < 12 || Buffer.byteLength(password) > 1024)
    throw new LocalVaultError();
  const raw = scryptSync(password, salt, 32, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
  const result = createSecretKey(raw);
  raw.fill(0);
  return result;
}
function bytes(value: string, length?: number) {
  const result = Buffer.from(value, "base64url");
  if (
    result.toString("base64url") !== value ||
    (length !== undefined && result.length !== length)
  )
    throw new LocalVaultError();
  return result;
}
export async function saveIdentity(
  location: string,
  password: string,
  profile: Identity,
  create = false,
) {
  await directory(location);
  const salt = randomBytes(16),
    nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(password, salt), nonce);
  cipher.setAAD(Buffer.from("keyman-mvp-local-vault-v1"));
  const plain = Buffer.from(JSON.stringify(profileSchema.parse(profile)));
  let encrypted: Buffer;
  try {
    encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  } finally {
    plain.fill(0);
  }
  const file = path.join(location, "vault.json"),
    temp = path.join(location, "vault-" + crypto.randomUUID() + ".tmp"),
    target = create ? file : temp;
  const handle = await open(target, "wx", 0o600);
  try {
    // Elevated Windows tokens can give new files an Administrators owner even
    // inside a private directory. Secure this exclusively created file before writing.
    if (process.platform === "win32") await windowsPrivatePath(target, true);
    await handle.writeFile(
      JSON.stringify({
        version: 1,
        salt: salt.toString("base64url"),
        nonce: nonce.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        ciphertext: encrypted.toString("base64url"),
      }),
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (!create) {
    try {
      await rename(temp, file);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }
}
export async function initializeIdentity(
  location: string,
  password: string,
  origin: string,
): Promise<Identity> {
  const generated = await generateIdentity();
  const profile = profileSchema.parse({
    version: 1,
    origin: apiOrigin(origin),
    ...generated,
  });
  await saveIdentity(location, password, profile, true);
  return profile;
}
export async function unlockIdentity(
  location: string,
  password: string,
  options: { administrative?: boolean } = {},
): Promise<Identity> {
  try {
    await directory(location);
    const disk = diskSchema.parse(
      JSON.parse(await readPrivateFile(path.join(location, "vault.json"))),
    );
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(password, bytes(disk.salt, 16)),
      bytes(disk.nonce, 12),
    );
    decipher.setAAD(Buffer.from("keyman-mvp-local-vault-v1"));
    decipher.setAuthTag(bytes(disk.tag, 16));
    const plain = Buffer.concat([
      decipher.update(bytes(disk.ciphertext)),
      decipher.final(),
    ]);
    try {
      const profile = profileSchema.parse(JSON.parse(plain.toString("utf8")));
      apiOrigin(profile.origin);
      if (
        (await keyFingerprint(profile.publicKey)) !== profile.keyId ||
        profile.privateKey.x !== profile.publicKey.x ||
        (profile.vault && profile.vault.keyId !== profile.keyId)
      )
        throw new LocalVaultError();
      // Ordinary runtime callers do not need the short-lived upload credential.
      // This reduces accidental exposure; equivalent OS access is not isolated.
      if (!options.administrative) delete profile.upload;
      return profile;
    } finally {
      plain.fill(0);
    }
  } catch {
    throw new LocalVaultError();
  }
}
