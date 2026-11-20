import { hkdfSync, randomBytes, randomUUID, scrypt } from "node:crypto";
import {
  adminRecoverySchema,
  anchorSchema,
  anchorTuple,
  b64,
  bootstrapMaterialSchema,
  bundleSchema,
  failure,
  generateEncryptionKey,
  generateSigningKey,
  id,
  openBox,
  openRuntime,
  randomSecret,
  sameAnchor,
  sealBox,
  signRuntime,
  unb64,
  validateAdministration,
  type AdminMaterial,
  type Anchor,
  type PasswordBox,
  type RuntimeMaterial,
  type VaultBundle,
  type z,
} from "@passman/protocol";

const scryptProfile = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const passwordProfile = "scrypt-131072-8-1";
export const bootstrapBundleSchema = bundleSchema.omit({
  administration: true,
});
const restorableBundleSchema = bootstrapBundleSchema.extend({
  administration: bundleSchema.shape.administration.optional(),
});
type BootstrapMaterial = z.infer<typeof bootstrapMaterialSchema>;
export type BootstrapBundle = z.infer<typeof bootstrapBundleSchema>;

function validatePassword(password: string, creating = false): void {
  if (typeof password !== "string" || password.length > 1024)
    failure("PASSWORD_INVALID");
  const length = Buffer.byteLength(password, "utf8");
  if (
    length < (creating ? 12 : 1) ||
    length > 1024 ||
    /\p{Surrogate}/u.test(password)
  )
    failure("PASSWORD_INVALID");
}

async function passwordKey(
  password: string,
  salt: string,
  purpose: PasswordBox["purpose"],
): Promise<string> {
  const saltBytes = unb64(salt, 16);
  const input = Buffer.from(password, "utf8");
  let master: Buffer | undefined;
  try {
    master = await new Promise<Buffer>((resolve, reject) => {
      scrypt(input, saltBytes, 32, scryptProfile, (error, result) =>
        error ? reject(error) : resolve(result),
      );
    });
    const key = new Uint8Array(
      hkdfSync(
        "sha256",
        master,
        saltBytes,
        `passman/password/1/${purpose}`,
        32,
      ),
    );
    try {
      return b64(key);
    } finally {
      key.fill(0);
    }
  } finally {
    input.fill(0);
    master?.fill(0);
  }
}

function passwordBoxContext(header: Omit<PasswordBox, "box">) {
  return [
    "passman/password",
    header.version,
    header.profile,
    header.purpose,
    header.salt,
    anchorTuple(header.anchor),
    header.epoch,
    header.syncId,
    header.revision,
  ];
}

function runtimeBootstrap(runtime: RuntimeMaterial): BootstrapMaterial {
  const { anchor, epoch, generation, syncId, syncKey } = runtime;
  return { version: 1, anchor, epoch, generation, syncId, syncKey };
}

async function wrapPassword(
  value: unknown,
  bundle: Pick<BootstrapBundle, "anchor" | "epoch" | "syncId">,
  purpose: PasswordBox["purpose"],
  revision: number,
  password: string,
): Promise<PasswordBox> {
  const header: Omit<PasswordBox, "box"> = {
    version: 1,
    profile: passwordProfile,
    salt: b64(randomBytes(16)),
    purpose,
    anchor: bundle.anchor,
    epoch: bundle.epoch,
    revision,
    syncId: bundle.syncId,
  };
  return {
    ...header,
    box: await sealBox(
      value,
      await passwordKey(password, header.salt, purpose),
      passwordBoxContext(header),
    ),
  };
}

async function unwrapPassword(
  wrapper: PasswordBox,
  password: string,
): Promise<unknown> {
  const key = await passwordKey(password, wrapper.salt, wrapper.purpose);
  try {
    return await openBox(wrapper.box, key, passwordBoxContext(wrapper));
  } catch {
    return failure("PASSWORD_INVALID");
  }
}

function checkWrapper(
  wrapper: PasswordBox,
  bundle: BootstrapBundle,
  purpose: PasswordBox["purpose"],
): void {
  if (
    !sameAnchor(wrapper.anchor, bundle.anchor) ||
    wrapper.epoch !== bundle.epoch ||
    wrapper.syncId !== bundle.syncId ||
    wrapper.purpose !== purpose
  )
    failure("CONTEXT_MISMATCH");
  unb64(wrapper.salt, 16);
}

function validateBundle(
  input: unknown,
  expected?: Pick<Anchor, "origin" | "accountId">,
): BootstrapBundle & { administration?: PasswordBox } {
  const parsed = restorableBundleSchema.safeParse(input);
  if (!parsed.success) return failure("INTEGRITY_FAILED");
  const bundle = parsed.data;
  if (
    expected &&
    (bundle.anchor.origin !== expected.origin ||
      bundle.anchor.accountId !== expected.accountId)
  ) {
    return failure("CONTEXT_MISMATCH");
  }
  checkWrapper(bundle.bootstrap, bundle, "bootstrap");
  if (bundle.administration)
    checkWrapper(bundle.administration, bundle, "administration");
  return bundle;
}

async function restoreRuntimeFromBundle(
  bundle: BootstrapBundle,
  password: string,
  installationId: string,
): Promise<RuntimeMaterial> {
  const parsed = bootstrapMaterialSchema.safeParse(
    await unwrapPassword(bundle.bootstrap, password),
  );
  if (!parsed.success) return failure("INTEGRITY_FAILED");
  const bootstrap = parsed.data;
  if (
    !sameAnchor(bootstrap.anchor, bundle.anchor) ||
    bootstrap.epoch !== bundle.epoch ||
    bootstrap.syncId !== bundle.syncId ||
    bootstrap.generation > bundle.generation
  )
    failure("CONTEXT_MISMATCH");
  const runtime = await openRuntime(bundle.keyring, bootstrap, installationId);
  requireCurrentRuntime(runtime, bundle);
  return runtime;
}

function requireCurrentRuntime(
  runtime: RuntimeMaterial,
  bundle: Pick<
    BootstrapBundle,
    "anchor" | "epoch" | "syncId" | "generation" | "activeKey"
  >,
): void {
  const active = runtime.keys.find((key) => key.id === runtime.activeKeyId);
  if (
    !sameAnchor(runtime.anchor, bundle.anchor) ||
    runtime.epoch !== bundle.epoch ||
    runtime.syncId !== bundle.syncId ||
    runtime.generation !== bundle.generation ||
    active?.id !== bundle.activeKey.id ||
    active.version !== bundle.activeKey.version ||
    active.publicKey.x !== bundle.activeKey.publicKey.x
  )
    failure("CONTEXT_MISMATCH");
}

type RuntimeBundleHeader = Omit<BootstrapBundle, "bootstrap">;

async function withPasswordWrappers(
  admin: AdminMaterial,
  header: RuntimeBundleHeader,
  password: string,
  revisions: { bootstrap: number; administration: number },
): Promise<VaultBundle> {
  const bootstrap = await wrapPassword(
    runtimeBootstrap(admin.runtime),
    header,
    "bootstrap",
    revisions.bootstrap,
    password,
  );
  const recovery = {
    version: 1,
    anchor: header.anchor,
    epoch: header.epoch,
    signingKey: admin.signingKey,
  };
  const administration = await wrapPassword(
    recovery,
    header,
    "administration",
    revisions.administration,
    password,
  );
  return { ...header, bootstrap, administration };
}

async function runtimeHeader(
  admin: AdminMaterial,
): Promise<RuntimeBundleHeader> {
  const { anchor, epoch, generation, syncId, keys, activeKeyId } =
    admin.runtime;
  const activeKey = keys.find((key) => key.id === activeKeyId);
  if (!activeKey) return failure("CONTEXT_MISMATCH");
  const { id: keyId, version, publicKey } = activeKey;
  return {
    version: 1,
    anchor,
    epoch,
    generation,
    syncId,
    activeKey: { id: keyId, version, publicKey },
    keyring: await signRuntime(admin.runtime, admin.signingKey),
  };
}

export async function initializeVault(
  origin: string,
  accountId: string,
  password: string,
): Promise<{ admin: AdminMaterial; bundle: VaultBundle }> {
  validatePassword(password, true);
  const signing = await generateSigningKey();
  const anchor = anchorSchema.safeParse({
    version: 1,
    origin,
    accountId,
    vaultId: randomUUID(),
    writer: signing.publicKey,
  });
  if (!anchor.success) return failure("INVALID_REQUEST");
  const initial = await generateEncryptionKey();
  const admin: AdminMaterial = {
    version: 1,
    signingKey: signing.privateKey,
    runtime: {
      version: 1,
      anchor: anchor.data,
      epoch: 1,
      generation: 1,
      syncId: randomUUID(),
      syncKey: randomSecret(),
      activeKeyId: initial.id,
      keys: [initial],
      installationId: randomUUID(),
    },
  };
  const bundle = await withPasswordWrappers(
    admin,
    await runtimeHeader(admin),
    password,
    { bootstrap: 1, administration: 1 },
  );
  return { admin, bundle };
}

export async function restoreRuntime(
  input: unknown,
  password: string,
  installationId: string = randomUUID(),
  expected?: Pick<Anchor, "origin" | "accountId">,
): Promise<RuntimeMaterial> {
  validatePassword(password);
  if (!id.safeParse(installationId).success) return failure("INVALID_REQUEST");
  return restoreRuntimeFromBundle(
    validateBundle(input, expected),
    password,
    installationId,
  );
}

export async function restoreAdmin(
  input: unknown,
  password: string,
  installationId: string = randomUUID(),
  expected?: Pick<Anchor, "origin" | "accountId">,
): Promise<AdminMaterial> {
  validatePassword(password);
  if (!id.safeParse(installationId).success) return failure("INVALID_REQUEST");
  const bundle = validateBundle(input, expected);
  if (!bundle.administration) return failure("FORBIDDEN");
  const runtime = await restoreRuntimeFromBundle(
    bundle,
    password,
    installationId,
  );
  const recovery = adminRecoverySchema.safeParse(
    await unwrapPassword(bundle.administration, password),
  );
  if (
    !recovery.success ||
    !sameAnchor(recovery.data.anchor, bundle.anchor) ||
    recovery.data.epoch !== bundle.epoch
  ) {
    return failure("INTEGRITY_FAILED");
  }
  return validateAdministration({
    version: 1,
    runtime,
    signingKey: recovery.data.signingKey,
  });
}

// The caller must obtain administrative owner verification from its custody provider before reset.
export async function rewrapVaultPassword(
  current: VaultBundle,
  localAdmin: AdminMaterial,
  newPassword: string,
): Promise<VaultBundle> {
  validatePassword(newPassword, true);
  const bundle = validateBundle(current);
  if (!bundle.administration) return failure("FORBIDDEN");
  const admin = await validateAdministration(localAdmin);
  const runtime = await openRuntime(
    bundle.keyring,
    runtimeBootstrap(admin.runtime),
    admin.runtime.installationId,
  );
  requireCurrentRuntime(runtime, bundle);
  const updated = {
    ...admin,
    runtime: { ...runtime, generation: runtime.generation + 1 },
  };
  return withPasswordWrappers(
    updated,
    await runtimeHeader(updated),
    newPassword,
    {
      bootstrap: bundle.bootstrap.revision + 1,
      administration: bundle.administration.revision + 1,
    },
  );
}

export async function changeVaultPassword(
  current: VaultBundle,
  oldPassword: string,
  newPassword: string,
): Promise<VaultBundle> {
  return rewrapVaultPassword(
    current,
    await restoreAdmin(current, oldPassword),
    newPassword,
  );
}

export async function rotateVaultKey(
  current: VaultBundle,
  localAdmin: AdminMaterial,
  replacementPassword?: string,
): Promise<{ admin: AdminMaterial; bundle: VaultBundle }> {
  const bundle = validateBundle(current);
  if (!bundle.administration) return failure("FORBIDDEN");
  const local = await validateAdministration(localAdmin);
  const runtime = await openRuntime(
    bundle.keyring,
    runtimeBootstrap(local.runtime),
    local.runtime.installationId,
  );
  requireCurrentRuntime(runtime, bundle);
  if (runtime.keys.length >= 64) return failure("CONFLICT");
  if (replacementPassword !== undefined)
    validatePassword(replacementPassword, true);
  const next = await generateEncryptionKey(bundle.activeKey.version + 1);
  const admin: AdminMaterial = {
    ...local,
    runtime: {
      ...runtime,
      generation: runtime.generation + 1,
      activeKeyId: next.id,
      keys: [...runtime.keys, next],
    },
  };
  if (replacementPassword !== undefined) {
    admin.runtime = {
      ...admin.runtime,
      epoch: runtime.epoch + 1,
      syncId: randomUUID(),
      syncKey: randomSecret(),
    };
  }
  const header = await runtimeHeader(admin);
  const updatedBundle =
    replacementPassword === undefined
      ? {
          ...header,
          bootstrap: bundle.bootstrap,
          administration: bundle.administration,
        }
      : await withPasswordWrappers(admin, header, replacementPassword, {
          bootstrap: bundle.bootstrap.revision + 1,
          administration: bundle.administration.revision + 1,
        });
  return { admin, bundle: updatedBundle };
}

export async function replaceWriterVault(
  current: VaultBundle,
  localAdmin: AdminMaterial,
  newPassword: string,
): Promise<{ admin: AdminMaterial; bundle: VaultBundle }> {
  validatePassword(newPassword, true);
  const bundle = validateBundle(current);
  if (!bundle.administration) return failure("FORBIDDEN");
  const local = await validateAdministration(localAdmin);
  const runtime = await openRuntime(
    bundle.keyring,
    runtimeBootstrap(local.runtime),
    local.runtime.installationId,
  );
  requireCurrentRuntime(runtime, bundle);
  const writer = await generateSigningKey();
  const active = await generateEncryptionKey(bundle.activeKey.version + 1);
  const admin: AdminMaterial = {
    version: 1,
    signingKey: writer.privateKey,
    runtime: {
      ...runtime,
      anchor: { ...runtime.anchor, writer: writer.publicKey },
      epoch: runtime.epoch + 1,
      generation: runtime.generation + 1,
      syncId: randomUUID(),
      syncKey: randomSecret(),
      activeKeyId: active.id,
      keys: [active],
    },
  };
  const changed = await withPasswordWrappers(
    admin,
    await runtimeHeader(admin),
    newPassword,
    {
      bootstrap: bundle.bootstrap.revision + 1,
      administration: bundle.administration.revision + 1,
    },
  );
  return { admin, bundle: changed };
}
