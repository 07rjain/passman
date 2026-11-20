import {
  canonicalOrigin,
  contextTuple,
  failure,
  id,
  jws,
  label,
  openValue,
  parseCredential,
  PassmanError,
  projectName,
  recordSchema,
  refreshRuntime,
  runtimePackageSchema,
  sameAnchor,
  secretName,
  validateRuntime,
  verifyRecord,
  type RuntimeMaterial,
  type SecretRecord,
  z,
} from "@passman/protocol";
import {
  checkSelection,
  storageError,
  type RuntimeCustody,
  type VaultSelection,
} from "./custody.js";
import { NativeRuntimeCustody } from "./native-custody.js";
import {
  parseResponse,
  transport,
  type TransportOptions,
} from "./transport.js";
import { bootstrapBundleSchema, restoreRuntime } from "./vault.js";

export const publicStatusSchema = runtimePackageSchema.omit({
  version: true,
  box: true,
});
const readStatusSchema = publicStatusSchema
  .extend({
    credential: z
      .object({
        id,
        projects: z.array(id).max(100).nullable(),
        expiresAt: z.number().int().positive().nullable(),
        bootstrap: z.boolean(),
      })
      .strict(),
  })
  .strict();
const projectsSchema = z
  .object({
    projects: z
      .array(
        z
          .object({
            id,
            name: projectName,
            createdAt: z.iso.datetime(),
            secretCount: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
const secretsSchema = z
  .object({
    secrets: z
      .array(
        recordSchema.shape.context.pick({
          name: true,
          state: true,
          revision: true,
          keyId: true,
        }),
      )
      .max(1000),
  })
  .strict();
const installationSchema = z
  .object({
    label,
    kind: z.enum(["desktop", "server", "container", "function"]),
  })
  .strict();
export type PublicStatus = z.infer<typeof publicStatusSchema>;
export type RuntimeOptions = TransportOptions & {
  serviceKey: string;
  custody?: RuntimeCustody | null;
  installation?: z.infer<typeof installationSchema>;
};
export type SecretAddress = { project: string; name: string };

export function checkedName(
  schema: typeof projectName | typeof secretName,
  value: string,
): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data === "." || parsed.data === "..")
    return failure("INVALID_REQUEST");
  return parsed.data;
}

export function secretPath(address: SecretAddress): string {
  return `/projects/${checkedName(projectName, address.project)}/secrets/${checkedName(secretName, address.name)}`;
}

export function checkRecordAddress(
  record: SecretRecord,
  selection: VaultSelection,
  expected: SecretAddress,
): SecretRecord {
  const context = record.context;
  if (
    context.origin !== selection.origin ||
    context.accountId !== selection.accountId ||
    context.project !== expected.project ||
    context.name !== expected.name
  )
    return failure("CONTEXT_MISMATCH");
  return record;
}

export function checkRuntimeStatus(
  runtime: RuntimeMaterial,
  status: PublicStatus,
): void {
  if (
    !sameAnchor(runtime.anchor, status.anchor) ||
    runtime.epoch !== status.epoch ||
    runtime.syncId !== status.syncId ||
    status.generation < runtime.generation
  ) {
    failure("CONTEXT_MISMATCH");
  }
  if (
    status.generation === runtime.generation &&
    !matchesActiveKey(runtime, status)
  )
    failure("CONTEXT_MISMATCH");
}

function matchesActiveKey(
  runtime: RuntimeMaterial,
  status: PublicStatus,
): boolean {
  const active = runtime.keys.find((key) => key.id === runtime.activeKeyId);
  return (
    active?.id === status.activeKey.id &&
    active.version === status.activeKey.version &&
    active.publicKey.x === status.activeKey.publicKey.x
  );
}

export class RuntimeClient {
  readonly #selection: VaultSelection;
  readonly #credentialId: string;
  readonly #request: ReturnType<typeof transport>;
  readonly #custody: RuntimeCustody | undefined;
  readonly #installation: RuntimeOptions["installation"];
  #lastObservation = 0;
  #cachedRuntime: RuntimeMaterial | undefined;
  #refreshing: Promise<RuntimeMaterial> | undefined;
  #observed = new Map<
    string,
    { revision: number; fingerprint: string; slot: string }
  >();

  constructor(options: RuntimeOptions) {
    const selected = parseCredential(options.serviceKey, "read");
    if (
      options.installation &&
      !installationSchema.safeParse(options.installation).success
    )
      failure("INVALID_REQUEST");
    this.#selection = {
      origin: canonicalOrigin(options.origin),
      accountId: selected.accountId,
    };
    this.#credentialId = selected.id;
    this.#request = transport(options, options.serviceKey);
    this.#custody =
      options.custody === null
        ? undefined
        : (options.custody ?? new NativeRuntimeCustody());
    this.#installation = options.installation;
  }

  static connect(options: RuntimeOptions): RuntimeClient {
    return new RuntimeClient(options);
  }

  get account(): VaultSelection {
    return { ...this.#selection };
  }

  async #status() {
    const result = parseResponse(
      readStatusSchema,
      await this.#request("/status"),
    );
    checkSelection(result.anchor, this.#selection);
    if (this.#credentialId !== result.credential.id)
      return failure("CONTEXT_MISMATCH");
    return result;
  }

  async authorization() {
    return this.#status();
  }

  async status() {
    const status = await this.#status();
    try {
      const runtime = await this.#localRuntime();
      if (runtime) checkRuntimeStatus(runtime, status);
      return {
        ...status,
        custody: runtime ? ("ready" as const) : ("missing" as const),
      };
    } catch (error) {
      if (
        !(error instanceof PassmanError) ||
        error.code !== "STORAGE_UNAVAILABLE"
      )
        throw error;
      return { ...status, custody: "unavailable" as const };
    }
  }

  async listProjects() {
    return parseResponse(projectsSchema, await this.#request("/projects"))
      .projects;
  }

  async listSecrets(input: { project: string }) {
    const project = checkedName(projectName, input.project);
    return parseResponse(
      secretsSchema,
      await this.#request(`/projects/${project}/secrets`),
    ).secrets;
  }

  async getEncryptedSecret(input: SecretAddress): Promise<SecretRecord> {
    const record = parseResponse(
      recordSchema,
      await this.#request(secretPath(input)),
    );
    return checkRecordAddress(record, this.#selection, input);
  }

  async hasSecret(input: SecretAddress): Promise<boolean> {
    try {
      return (await this.getEncryptedSecret(input)).context.state !== "deleted";
    } catch (error) {
      if (error instanceof PassmanError && error.code === "NOT_FOUND")
        return false;
      throw error;
    }
  }

  async #localRuntime(): Promise<RuntimeMaterial | undefined> {
    if (this.#cachedRuntime) return this.#cachedRuntime;
    if (!this.#custody) return undefined;
    let value: unknown;
    try {
      value = await this.#custody.loadRuntime({ ...this.#selection });
    } catch (error) {
      return storageError(error);
    }
    if (value === undefined || value === null) return undefined;
    const runtime = await validateRuntime(value);
    checkSelection(runtime.anchor, this.#selection);
    this.#cachedRuntime ??= runtime;
    return this.#cachedRuntime;
  }

  async #refresh(
    runtime: RuntimeMaterial,
    status: PublicStatus,
  ): Promise<RuntimeMaterial> {
    checkRuntimeStatus(runtime, status);
    this.#refreshing ??= (async () => {
      const { keyring } = parseResponse(
        z.object({ keyring: jws }).strict(),
        await this.#request("/keyring"),
      );
      const next = await refreshRuntime(keyring, runtime);
      if (
        next.generation < status.generation ||
        (next.generation === status.generation &&
          !matchesActiveKey(next, status))
      ) {
        return failure("CONTEXT_MISMATCH");
      }
      if (next.generation > runtime.generation) {
        try {
          await this.#custody?.saveRuntime?.(next);
        } catch (error) {
          return storageError(error);
        }
      }
      return (this.#cachedRuntime = next);
    })().finally(() => {
      this.#refreshing = undefined;
    });
    const next = await this.#refreshing;
    if (
      next.generation < status.generation ||
      (next.generation === status.generation && !matchesActiveKey(next, status))
    ) {
      return failure("CONTEXT_MISMATCH");
    }
    return next;
  }

  #observe(runtime: RuntimeMaterial): void {
    if (!this.#installation || this.#lastObservation + 120_000 > Date.now())
      return;
    this.#lastObservation = Date.now();
    const body = JSON.stringify({
      ...this.#installation,
      id: runtime.installationId,
    });
    void this.#request("/installations", { method: "POST", body }).catch(
      () => undefined,
    );
  }

  async sync(): Promise<{ generation: number; epoch: number }> {
    const status = await this.#status();
    const runtime = await this.#localRuntime();
    if (!runtime) return failure("VAULT_NOT_PROVISIONED");
    const refreshed = await this.#refresh(runtime, status);
    this.#observe(refreshed);
    return { generation: refreshed.generation, epoch: refreshed.epoch };
  }

  async unlock(
    password: string,
  ): Promise<{ generation: number; epoch: number }> {
    if (!this.#custody?.saveRuntime) return failure("STORAGE_UNAVAILABLE");
    const bundle = await this.downloadBootstrap();
    const previous = await this.#localRuntime();
    const runtime = await restoreRuntime(
      bundle,
      password,
      previous?.installationId,
      this.#selection,
    );
    if (
      previous &&
      (!sameAnchor(previous.anchor, runtime.anchor) ||
        previous.generation > runtime.generation ||
        previous.epoch > runtime.epoch)
    )
      return failure("CONTEXT_MISMATCH");
    try {
      await this.#custody.saveRuntime(runtime);
    } catch (error) {
      return storageError(error);
    }
    this.#cachedRuntime = runtime;
    this.#observe(runtime);
    return { generation: runtime.generation, epoch: runtime.epoch };
  }

  async downloadBootstrap() {
    const bundle = parseResponse(
      bootstrapBundleSchema,
      await this.#request("/bootstrap"),
    );
    checkSelection(bundle.anchor, this.#selection);
    return bundle;
  }

  async getSecret(input: SecretAddress): Promise<string> {
    const record = await this.getEncryptedSecret(input);
    if (record.context.state === "pending")
      return failure("PENDING_VERIFICATION_REQUIRED");
    const initial = await this.#localRuntime();
    if (!initial) return failure("VAULT_NOT_PROVISIONED");
    const status = await this.#status();
    checkRuntimeStatus(initial, status);
    const verified = await verifyRecord(record, initial.anchor, input);
    const context = verified.context;
    if (
      status.credential.projects &&
      !status.credential.projects.includes(context.projectId)
    )
      return failure("FORBIDDEN");
    let runtime = initial;
    if (
      status.generation > initial.generation ||
      !initial.keys.some((key) => key.id === context.keyId)
    ) {
      runtime = await this.#refresh(initial, status);
    }
    if (context.epoch > runtime.epoch) return failure("CONTEXT_MISMATCH");
    const key = runtime.keys.find((key) => key.id === context.keyId);
    if (!key) return failure("CONTEXT_MISMATCH");
    const fingerprint = JSON.stringify([
      contextTuple(context),
      verified.signature,
    ]);
    const address = JSON.stringify([input.project, input.name]);
    const slot = `${context.projectId}/${context.secretId}`;
    const value =
      context.state === "active"
        ? await openValue(verified, key.privateKey, context)
        : undefined;
    const observed = this.#observed.get(address);
    if (
      observed &&
      (observed.slot !== slot ||
        observed.revision > context.revision ||
        (observed.revision === context.revision &&
          observed.fingerprint !== fingerprint))
    )
      return failure("CONTEXT_MISMATCH");
    this.#observed.delete(address);
    this.#observed.set(address, {
      slot,
      revision: context.revision,
      fingerprint,
    });
    if (this.#observed.size > 1024)
      this.#observed.delete(this.#observed.keys().next().value!);
    this.#observe(runtime);
    if (value === undefined) return failure("NOT_FOUND");
    return value;
  }
}
