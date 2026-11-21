import { randomUUID } from "node:crypto";
import {
  b64,
  boxSchema,
  canonicalOrigin,
  digest,
  failure,
  id,
  jsonBytes,
  openBox,
  openValue,
  parseCredential,
  PassmanError,
  randomSecret,
  refreshRuntime,
  runtimeSchema,
  sameAnchor,
  sealBox,
  sealValue,
  unb64,
  validateAdministration,
  validateRuntime,
  type AdminMaterial,
  type RuntimeMaterial,
  type VaultBundle,
  z,
} from "@passman/protocol";
import { administrativeProof } from "./admin.js";
import { storageError, UnixFileStore, type RuntimeCustody } from "./custody.js";
import {
  parseResponse,
  transport,
  type TransportOptions,
} from "./transport.js";
import { restoreRuntime } from "./vault.js";

const codeSchema = z
  .object({
    version: z.literal(1),
    origin: runtimeSchema.shape.anchor.shape.origin,
    accountId: id,
    vaultId: id,
    transferId: id,
    expiresAt: z.number().int().positive(),
    epoch: z.number().int().positive(),
    encryptionKey: runtimeSchema.shape.syncKey,
    claimSecret: runtimeSchema.shape.syncKey,
  })
  .strict();
type TransferCode = z.infer<typeof codeSchema>;
const sessionSchema = z
  .object({
    version: z.literal(1),
    transferId: id,
    expiresAt: z.number().int().positive(),
    codeHash: runtimeSchema.shape.syncKey,
    sessionSecret: runtimeSchema.shape.syncKey,
    installationId: id,
  })
  .strict();
type TransferSession = z.infer<typeof sessionSchema>;
const completedSession = z.object({ completed: id }).strict();

async function storageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return storageError(error);
  }
}

function storedSession(value: unknown) {
  if (value === undefined || completedSession.safeParse(value).success)
    return undefined;
  const session = sessionSchema.safeParse(value);
  if (!session.success) return failure("STORAGE_UNAVAILABLE");
  return session.data;
}

function transferIdInput(value: unknown) {
  const valid = id.safeParse(value);
  if (!valid.success) return failure("INVALID_REQUEST");
  return valid.data;
}
export interface TransferSessions {
  load(transferId: string): Promise<unknown>;
  save(transferId: string, session: TransferSession): Promise<void>;
  complete(transferId: string, expected?: TransferSession): Promise<void>;
}
export class FileTransferSessions implements TransferSessions {
  #store: Pick<UnixFileStore, "read" | "write">;
  constructor(
    directory: string | Pick<UnixFileStore, "read" | "write">,
    readonly selection: { origin: string; accountId: string },
  ) {
    this.#store =
      typeof directory === "string" ? new UnixFileStore(directory) : directory;
  }
  async load(transferId: string) {
    transferIdInput(transferId);
    const session = storedSession(
      await storageOperation(() =>
        this.#store.read("transfer", this.selection),
      ),
    );
    if (!session || session.transferId === transferId) return session;
    if (session.expiresAt <= Date.now()) return undefined;
    return failure("CONFLICT");
  }
  async save(transferId: string, input: TransferSession) {
    transferIdInput(transferId);
    const parsed = sessionSchema.safeParse(input);
    if (!parsed.success) return failure("INVALID_REQUEST");
    const session = parsed.data;
    if (session.transferId !== transferId) failure("CONTEXT_MISMATCH");
    await storageOperation(() =>
      this.#store.write("transfer", this.selection, session, (current) => {
        const previous = storedSession(current);
        if (!previous) return true;
        if (JSON.stringify(previous) === JSON.stringify(session)) return false;
        if (
          previous.transferId === transferId ||
          previous.expiresAt > Date.now()
        )
          return failure("CONFLICT");
        return true;
      }),
    );
  }
  async complete(transferId: string, expected?: TransferSession) {
    transferIdInput(transferId);
    await storageOperation(() =>
      this.#store.write(
        "transfer",
        this.selection,
        { completed: transferId },
        (current) => {
          const session = storedSession(current);
          if (!session) return false;
          if (
            session.transferId !== transferId ||
            (expected && JSON.stringify(session) !== JSON.stringify(expected))
          ) {
            return failure("CONFLICT");
          }
          return true;
        },
      ),
    );
  }
  /** Erases this recipient's local resumption proof without contacting the relay. */
  async abandon(transferId: string) {
    await this.complete(transferId);
  }
}
function context(c: TransferCode) {
  return [
    "passman/transfer",
    c.version,
    c.origin,
    c.accountId,
    c.vaultId,
    c.transferId,
    c.expiresAt,
    c.epoch,
  ];
}
export async function createTransfer(
  options: TransportOptions & {
    adminKey: string;
    managementToken: string;
    material: AdminMaterial;
    bundle: VaultBundle;
    password: string;
    lifetimeMs?: number;
  },
): Promise<{ code: string; expiresAt: number; transferId: string }> {
  const admin = await validateAdministration(options.material),
    r = admin.runtime;
  const origin = canonicalOrigin(options.origin),
    credential = parseCredential(options.adminKey, "admin");
  if (origin !== r.anchor.origin || credential.accountId !== r.anchor.accountId)
    failure("CONTEXT_MISMATCH");
  // A custody action explicitly verifies the current password locally. Runtime material cannot initiate transfers.
  const unlocked = await restoreRuntime(
    options.bundle,
    options.password,
    r.installationId,
    r.anchor,
  );
  if (
    !sameAnchor(unlocked.anchor, r.anchor) ||
    unlocked.epoch !== r.epoch ||
    unlocked.syncId !== r.syncId ||
    unlocked.syncKey !== r.syncKey ||
    unlocked.generation !== r.generation
  )
    failure("CONTEXT_MISMATCH");
  const lifetime = options.lifetimeMs ?? 570_000;
  if (!Number.isInteger(lifetime) || lifetime < 1000 || lifetime > 600_000)
    failure("INVALID_REQUEST");
  const c: TransferCode = {
    version: 1,
    origin,
    accountId: r.anchor.accountId,
    vaultId: r.anchor.vaultId,
    transferId: randomUUID(),
    expiresAt: Date.now() + lifetime,
    epoch: r.epoch,
    claimSecret: randomSecret(),
    encryptionKey: randomSecret(),
  };
  const { installationId: _source, ...material } = r;
  void _source;
  const payload = await sealBox(material, c.encryptionKey, context(c));
  const path = "/transfers",
    body = JSON.stringify({
      id: c.transferId,
      claimHash: await digest(c.claimSecret),
      expiresAt: c.expiresAt,
      epoch: c.epoch,
      expectedGeneration: r.generation,
      payload,
    });
  const proof = await administrativeProof(admin, credential.id, path, body);
  const result = parseResponse(
    z.object({ id, expiresAt: z.number().int().positive() }).strict(),
    await transport(options, options.adminKey)(path, {
      method: "POST",
      body,
      headers: {
        "x-passman-proof": proof,
        "x-passman-management": options.managementToken,
      },
    }),
  );
  if (result.id !== c.transferId || result.expiresAt !== c.expiresAt)
    failure("CONTEXT_MISMATCH");
  return {
    code: `pmt1.${b64(jsonBytes(c))}`,
    expiresAt: c.expiresAt,
    transferId: c.transferId,
  };
}
export async function receiveTransfer(
  options: TransportOptions & {
    serviceKey: string;
    code: string;
    custody: RuntimeCustody;
    sessions: TransferSessions;
  },
): Promise<RuntimeMaterial> {
  const origin = canonicalOrigin(options.origin),
    credential = parseCredential(options.serviceKey, "read");
  let c: TransferCode;
  try {
    if (!options.code.startsWith("pmt1.") || options.code.length > 3000)
      failure("INVALID_REQUEST");
    c = codeSchema.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          unb64(options.code.slice(5)),
        ),
      ),
    );
  } catch {
    return failure("INVALID_REQUEST");
  }
  // Never send a credential to an origin supplied solely by a pasted code.
  if (c.origin !== origin || c.accountId !== credential.accountId)
    failure("CONTEXT_MISMATCH");
  const saveRuntime = options.custody.saveRuntime?.bind(options.custody);
  if (!saveRuntime) return failure("STORAGE_UNAVAILABLE");
  const codeHash = await digest(options.code);
  const previous = storedSession(
    await storageOperation(() => options.sessions.load(c.transferId)),
  );
  if (!previous && c.expiresAt <= Date.now())
    return failure("TRANSFER_EXPIRED");
  const session = previous ?? {
    version: 1 as const,
    transferId: c.transferId,
    expiresAt: c.expiresAt,
    codeHash,
    sessionSecret: randomSecret(),
    installationId: randomUUID(),
  };
  if (
    session.codeHash !== codeHash ||
    session.transferId !== c.transferId ||
    session.expiresAt !== c.expiresAt
  ) {
    return failure("CONTEXT_MISMATCH");
  }
  const selection = { origin, accountId: c.accountId };
  const existing = await storageOperation(() =>
    options.custody.loadRuntime(selection),
  );
  const local =
    existing === undefined ? undefined : await validateRuntime(existing);
  if (!local && c.expiresAt <= Date.now()) return failure("TRANSFER_EXPIRED");
  if (local && local.installationId !== session.installationId)
    return failure("CONFLICT");
  // A new claim requires a durable recipient proof. An installed recipient already has its matching session.
  if (!previous)
    await storageOperation(() => options.sessions.save(c.transferId, session));
  const request = transport(options, options.serviceKey);
  const complete = () =>
    storageOperation(() => options.sessions.complete(c.transferId, session));
  const transferPath = `/transfers/${c.transferId}`;

  async function claim() {
    const path = `${transferPath}/claim`;
    const body = JSON.stringify({
      claimSecret: c.claimSecret,
      sessionSecret: session.sessionSecret,
    });
    const payload = await request(path, { method: "POST", body }).catch(
      async (error: unknown) => {
        if (
          error instanceof PassmanError &&
          [
            "TRANSFER_EXPIRED",
            "TRANSFER_CLAIMED",
            "NOT_FOUND",
            "FORBIDDEN",
          ].includes(error.code)
        )
          await complete();
        throw error;
      },
    );
    const claimed = parseResponse(
      z
        .object({
          id,
          epoch: z.number().int().positive(),
          expiresAt: z.number().int().positive(),
          payload: boxSchema,
        })
        .strict(),
      payload,
    );
    if (
      claimed.id !== c.transferId ||
      claimed.epoch !== c.epoch ||
      claimed.expiresAt !== c.expiresAt
    )
      return failure("CONTEXT_MISMATCH");
    const transferred = await openBox(
      claimed.payload,
      c.encryptionKey,
      context(c),
    );
    const { installationId: omitted, ...runtimeShape } = runtimeSchema.shape;
    void omitted;
    const material = parseResponse(
      z.object(runtimeShape).strict(),
      transferred,
    );
    return validateRuntime({
      ...material,
      installationId: session.installationId,
    });
  }

  if (!local && c.expiresAt <= Date.now()) return failure("TRANSFER_EXPIRED");
  const base = local ?? (await claim());
  if (
    base.anchor.vaultId !== c.vaultId ||
    base.anchor.origin !== origin ||
    base.anchor.accountId !== c.accountId ||
    base.epoch !== c.epoch
  ) {
    return failure("CONTEXT_MISMATCH");
  }
  const { keyring } = parseResponse(
    z.object({ keyring: z.string() }).strict(),
    await request("/keyring"),
  );
  const refreshed = await refreshRuntime(keyring, base);
  if (!local && c.expiresAt <= Date.now()) return failure("TRANSFER_EXPIRED");
  await storageOperation(() => saveRuntime(refreshed));
  // Erase relay ciphertext only after reading back the exact saved profile.
  const stored = await storageOperation(() =>
    options.custody.loadRuntime(selection),
  );
  const installed = await validateRuntime(stored).catch(() =>
    failure("STORAGE_UNAVAILABLE"),
  );
  if (JSON.stringify(installed) !== JSON.stringify(refreshed))
    return failure("STORAGE_UNAVAILABLE");
  await roundTrip(installed);
  const acknowledgement = await request(`${transferPath}/ack`, {
    method: "POST",
    body: JSON.stringify({ sessionSecret: session.sessionSecret }),
  }).catch(async (error: unknown) => {
    if (error instanceof PassmanError && error.code === "NOT_FOUND")
      await complete();
    throw error;
  });
  parseResponse(
    z.object({ acknowledged: z.literal(true) }).strict(),
    acknowledgement,
  );
  await complete();
  return installed;
}
async function roundTrip(r: RuntimeMaterial) {
  const key = r.keys.find((k) => k.id === r.activeKeyId);
  if (!key) failure("CONTEXT_MISMATCH");
  const value = randomSecret(),
    a = r.anchor;
  const ctx = {
    version: 1 as const,
    origin: a.origin,
    accountId: a.accountId,
    vaultId: a.vaultId,
    projectId: randomUUID(),
    project: "transfer-check",
    secretId: randomUUID(),
    name: "CHECK",
    keyId: key.id,
    epoch: r.epoch,
    revision: 1,
    state: "active" as const,
  };
  if (
    (await openValue(
      await sealValue(value, key.publicKey, ctx),
      key.privateKey,
      ctx,
    )) !== value
  )
    failure("INTEGRITY_FAILED");
}
export async function cancelTransfer(
  options: TransportOptions & {
    adminKey: string;
    managementToken: string;
    material: AdminMaterial;
    transferId: string;
  },
) {
  const a = await validateAdministration(options.material),
    credential = parseCredential(options.adminKey, "admin");
  if (
    canonicalOrigin(options.origin) !== a.runtime.anchor.origin ||
    credential.accountId !== a.runtime.anchor.accountId
  )
    failure("CONTEXT_MISMATCH");
  const path = `/transfers/${transferIdInput(options.transferId)}/cancel`,
    body = "{}";
  return parseResponse(
    z.object({ cancelled: z.literal(true) }).strict(),
    await transport(options, options.adminKey)(path, {
      method: "POST",
      body,
      headers: {
        "x-passman-proof": await administrativeProof(
          a,
          credential.id,
          path,
          body,
        ),
        "x-passman-management": options.managementToken,
      },
    }),
  );
}
