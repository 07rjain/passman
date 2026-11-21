import { randomUUID } from "node:crypto";
import {
  adminSchema,
  anchorSchema,
  bundleSchema,
  bytes32,
  canonicalOrigin,
  digest,
  failure,
  id,
  jws,
  label,
  openValue,
  parseCredential,
  PassmanError,
  randomSecret,
  recordSchema,
  refreshRuntime,
  sameAnchor,
  sealValue,
  secretName,
  signRecord,
  validateAdministration,
  validateRuntime,
  verifyRecord,
  z,
  type AdminMaterial,
  type Anchor,
  type RuntimeMaterial,
  type SecretRecord,
  type VaultBundle,
} from "@passman/protocol";
import { administrativeProof } from "./admin.js";
import {
  storageError,
  type AdminCustody,
  type RuntimeCustody,
} from "./custody.js";
import { checkRuntimeStatus, publicStatusSchema } from "./runtime.js";
import {
  parseResponse,
  transport,
  type TransportOptions,
} from "./transport.js";
import { replaceWriterVault, restoreRuntime } from "./vault.js";

const rootPath = "/writer-replacement";
const batchSize = 4;
const generation = z.number().int().positive();
const details = z
  .object({ label, expiresAt: z.number().int().positive() })
  .strict();
const position = z.object({ projectId: id, name: secretName }).strict();
const report = z.object({ id, generation }).strict();
export const preparedWriterReplacementSchema = z
  .object({
    id,
    previous: anchorSchema,
    expectedGeneration: generation,
    bundle: bundleSchema,
    admin: adminSchema,
    adminKey: z.string(),
    credential: details.extend({ id, hash: bytes32 }).strict(),
  })
  .strict();
export type PreparedWriterReplacement = z.infer<
  typeof preparedWriterReplacementSchema
>;
type Position = z.infer<typeof position>;

function checkedInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const check = schema.safeParse(value);
  if (!check.success) return failure("INVALID_REQUEST");
  return check.data;
}

export async function prepareWriterReplacement(
  current: VaultBundle,
  source: AdminMaterial,
  password: string,
  credentialDetails: z.infer<typeof details>,
): Promise<PreparedWriterReplacement> {
  const credential = checkedInput(details, credentialDetails);
  if (credential.expiresAt <= Date.now()) return failure("INVALID_REQUEST");
  const replacement = await replaceWriterVault(current, source, password);
  const id = randomUUID();
  const adminKey = `pma1.${replacement.bundle.anchor.accountId}.${id}.${randomSecret()}`;
  return {
    id: randomUUID(),
    previous: current.anchor,
    expectedGeneration: current.generation,
    ...replacement,
    adminKey,
    credential: { ...credential, id, hash: await digest(adminKey) },
  };
}

function comparePosition(left: Position, right: Position) {
  if (left.projectId !== right.projectId)
    return left.projectId < right.projectId ? -1 : 1;
  return left.name === right.name ? 0 : left.name < right.name ? -1 : 1;
}

/** Persist this operation's prepared material in protected custody before staging. */
export class WriterReplacementClient {
  readonly #options: TransportOptions & {
    managementToken: string;
    source: AdminMaterial;
    custody: AdminCustody;
  };
  readonly #request: ReturnType<typeof transport>;
  readonly #credential: ReturnType<typeof parseCredential>;

  constructor(
    options: TransportOptions & {
      adminKey: string;
      managementToken: string;
      source: AdminMaterial;
      custody: AdminCustody;
    },
  ) {
    this.#options = options;
    this.#credential = parseCredential(options.adminKey, "admin");
    this.#request = transport(options, options.adminKey);
  }

  async #validated(input: PreparedWriterReplacement) {
    const stage = checkedInput(preparedWriterReplacementSchema, input);
    const [source, admin] = await Promise.all([
      validateAdministration(this.#options.source),
      validateAdministration(stage.admin),
    ]);
    const previous = source.runtime;
    const next = admin.runtime;
    const selected = parseCredential(stage.adminKey, "admin");
    if (
      !sameAnchor(previous.anchor, stage.previous) ||
      previous.anchor.origin !== canonicalOrigin(this.#options.origin) ||
      previous.anchor.accountId !== this.#credential.accountId ||
      selected.accountId !== previous.anchor.accountId ||
      selected.id !== stage.credential.id ||
      stage.credential.hash !== (await digest(stage.adminKey)) ||
      previous.anchor.accountId !== next.anchor.accountId ||
      previous.anchor.vaultId !== next.anchor.vaultId ||
      previous.anchor.origin !== next.anchor.origin ||
      previous.anchor.writer.x === next.anchor.writer.x ||
      previous.epoch + 1 !== next.epoch ||
      previous.generation !== stage.expectedGeneration ||
      next.generation !== stage.expectedGeneration + 1 ||
      stage.bundle.generation !== next.generation ||
      previous.installationId !== next.installationId ||
      previous.syncId === next.syncId ||
      previous.syncKey === next.syncKey ||
      next.keys.length !== 1 ||
      previous.keys.some((key) => key.id === next.activeKeyId)
    ) {
      return failure("CONTEXT_MISMATCH");
    }
    checkRuntimeStatus(next, stage.bundle);
    await refreshRuntime(stage.bundle.keyring, next);
    return { stage, source, admin };
  }

  async #post(path: string, value: unknown, source: AdminMaterial) {
    const body = JSON.stringify(value);
    const proof = await administrativeProof(
      source,
      this.#credential.id,
      path,
      body,
    );
    return this.#request(path, {
      method: "POST",
      body,
      headers: {
        "x-passman-proof": proof,
        "x-passman-management": this.#options.managementToken,
      },
    });
  }

  async #replacement(
    record: SecretRecord,
    source: AdminMaterial,
    stage: PreparedWriterReplacement,
  ) {
    const prior = record.context;
    if (prior.state === "pending")
      return failure("PENDING_VERIFICATION_REQUIRED");
    const verified = await verifyRecord(record, source.runtime.anchor, prior);
    if (prior.epoch > source.runtime.epoch) return failure("CONTEXT_MISMATCH");
    const key = source.runtime.keys.find(
      (candidate) => candidate.id === prior.keyId,
    );
    if (!key && prior.state === "active") return failure("CONTEXT_MISMATCH");
    const value =
      key && prior.state === "active"
        ? await openValue(verified, key.privateKey, prior)
        : "";
    const { bundle } = stage;
    const replacement = await sealValue(value, bundle.activeKey.publicKey, {
      ...prior,
      keyId: bundle.activeKey.id,
      epoch: bundle.epoch,
      revision: prior.revision + 1,
    });
    return {
      expectedRevision: prior.revision,
      record: await signRecord(replacement, stage.admin.signingKey),
    };
  }

  async stage(input: PreparedWriterReplacement): Promise<void> {
    const { stage, source } = await this.#validated(input);
    const created = parseResponse(
      z.object({ id }).strict(),
      await this.#post(
        rootPath,
        {
          id: stage.id,
          expectedGeneration: stage.expectedGeneration,
          bundle: stage.bundle,
        },
        source,
      ),
    );
    if (created.id !== stage.id) return failure("CONTEXT_MISMATCH");
    const path = `${rootPath}/${stage.id}`;
    const schema = z
      .object({
        records: z.array(recordSchema).max(batchSize),
        next: position.nullable(),
      })
      .strict();
    let after: Position | undefined;
    while (true) {
      const page = parseResponse(
        schema,
        await this.#post(`${path}/scan`, { after }, source),
      );
      let prior = after;
      for (const record of page.records) {
        if (prior && comparePosition(prior, record.context) >= 0)
          return failure("CONTEXT_MISMATCH");
        prior = record.context;
      }
      if (
        page.next &&
        (!prior ||
          page.records.length !== batchSize ||
          comparePosition(prior, page.next) !== 0)
      ) {
        return failure("CONTEXT_MISMATCH");
      }
      const records = await Promise.all(
        page.records.map((record) => this.#replacement(record, source, stage)),
      );
      if (records.length) {
        const result = parseResponse(
          z.object({ staged: z.number().int().positive() }).strict(),
          await this.#post(`${path}/stage`, { records }, source),
        );
        if (result.staged !== records.length)
          return failure("CONTEXT_MISMATCH");
      }
      if (!page.next) return;
      after = page.next;
    }
  }

  async commit(
    input: PreparedWriterReplacement,
  ): Promise<{ id: string; generation: number }> {
    const { stage, source, admin } = await this.#validated(input);
    if (!this.#options.custody.replaceAdmin)
      return failure("STORAGE_UNAVAILABLE");
    let result: z.infer<typeof report>;
    try {
      result = parseResponse(
        report,
        await this.#post(
          `${rootPath}/${stage.id}/commit`,
          { credential: stage.credential },
          source,
        ),
      );
    } catch (error) {
      if (
        !(error instanceof PassmanError) ||
        ![
          "UNAVAILABLE",
          "UNAUTHORIZED",
          "CREDENTIAL_REVOKED",
          "INTEGRITY_FAILED",
        ].includes(error.code)
      )
        throw error;
      // The old credential is revoked at cutover. Recover only if the prepared new credential and exact signed keyring are already live.
      const nextRequest = transport(this.#options, stage.adminKey);
      const receipt = await nextRequest("/status").catch(() => {
        throw error;
      });
      const status = parseResponse(
        publicStatusSchema.extend({ credential: z.object({ id }) }),
        receipt,
      );
      checkRuntimeStatus(admin.runtime, status);
      if (
        status.generation !== admin.runtime.generation ||
        status.credential.id !== stage.credential.id
      )
        return failure("CONTEXT_MISMATCH");
      const ring = parseResponse(
        z.object({ keyring: jws }).strict(),
        await nextRequest("/keyring"),
      );
      if (ring.keyring !== stage.bundle.keyring)
        return failure("CONTEXT_MISMATCH");
      result = { id: status.credential.id, generation: status.generation };
    }
    if (
      result.id !== stage.credential.id ||
      result.generation !== admin.runtime.generation
    )
      return failure("CONTEXT_MISMATCH");
    try {
      await this.#options.custody.replaceAdmin(source, admin);
    } catch (error) {
      return storageError(error);
    }
    return result;
  }

  async cancel(input: PreparedWriterReplacement): Promise<void> {
    const { stage, source } = await this.#validated(input);
    parseResponse(
      z.object({ cancelled: z.literal(true) }).strict(),
      await this.#post(`${rootPath}/${stage.id}/cancel`, {}, source),
    );
  }
}

/** The operator supplies the new anchor from a trusted channel before replacing a pinned root. */
export async function installReplacementRuntime(
  input: unknown,
  password: string,
  previous: RuntimeMaterial,
  trustedNewAnchor: Anchor,
  custody: RuntimeCustody,
): Promise<RuntimeMaterial> {
  if (!custody.replaceRuntime) return failure("STORAGE_UNAVAILABLE");
  const prior = await validateRuntime(previous);
  const expected = checkedInput(anchorSchema, trustedNewAnchor);
  if (
    expected.origin !== prior.anchor.origin ||
    expected.accountId !== prior.anchor.accountId ||
    expected.vaultId !== prior.anchor.vaultId ||
    expected.writer.x === prior.anchor.writer.x
  )
    return failure("CONTEXT_MISMATCH");
  const runtime = await restoreRuntime(
    input,
    password,
    prior.installationId,
    expected,
  );
  if (
    !sameAnchor(runtime.anchor, expected) ||
    runtime.generation <= prior.generation ||
    runtime.epoch <= prior.epoch
  )
    return failure("CONTEXT_MISMATCH");
  try {
    await custody.replaceRuntime(prior, runtime);
  } catch (error) {
    return storageError(error);
  }
  return runtime;
}
