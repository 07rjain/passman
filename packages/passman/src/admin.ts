import { randomUUID } from "node:crypto";
import {
  adminSchema,
  adminScopeSchema,
  API_PATH,
  anchorSchema,
  bundleSchema,
  bytes32,
  canonicalOrigin,
  credentialScopeSchema,
  digest,
  failure,
  id,
  jws,
  label,
  openValue,
  parseCredential,
  PassmanError,
  projectName,
  randomSecret,
  recordSchema,
  refreshRuntime,
  requestProofSchema,
  sameAnchor,
  sealValue,
  signObject,
  signRecord,
  validateAdministration,
  validateRuntime,
  verifyRecord,
  type AdminMaterial,
  type RecordContext,
  type RuntimeMaterial,
  type SecretRecord,
  type VaultBundle,
  z,
} from "@passman/protocol";
import {
  checkSelection,
  storageError,
  type AdminCustody,
  type RuntimeCustody,
  type VaultSelection,
} from "./custody.js";
import {
  checkRecordAddress,
  checkRuntimeStatus,
  checkedName,
  publicStatusSchema,
  secretPath,
  type PublicStatus,
  type SecretAddress,
} from "./runtime.js";
import {
  parseResponse,
  transport,
  type TransportOptions,
} from "./transport.js";
import {
  bootstrapBundleSchema,
  initializeVault,
  restoreAdmin,
  restoreRuntime,
  rewrapVaultPassword,
  rotateVaultKey,
  type BootstrapBundle,
} from "./vault.js";

export { UnixAdminCustody, type AdminCustody } from "./custody.js";
export { NativeAdminCustody } from "./native-custody.js";
export { login } from "./login.js";
export { createTransfer, cancelTransfer } from "./transfers.js";
export {
  WriterReplacementClient,
  prepareWriterReplacement,
  installReplacementRuntime,
  type PreparedWriterReplacement,
} from "./writer-replacement.js";
export {
  changeVaultPassword,
  initializeVault,
  restoreAdmin,
  restoreRuntime,
  rewrapVaultPassword,
  rotateVaultKey,
} from "./vault.js";
export type { AdminMaterial, VaultBundle } from "@passman/protocol";

const credentialReceipt = z.object({ id }).strict();
const credentialDetails = z
  .object({ label, expiresAt: z.number().int().positive() })
  .strict();
const accountSchema = z
  .object({
    account: z
      .object({ accountId: id, vaultId: id, anchor: anchorSchema })
      .strict()
      .nullable(),
    operatorId: bytes32.optional(),
  })
  .strict();
const project = z.object({ id, name: projectName });
const mutationReceipt = z
  .object({
    state: z.enum(["active", "deleted"]),
    revision: z.number().int().positive(),
  })
  .strict();
type CredentialDetails = z.infer<typeof credentialDetails>;
type ReadScope = z.input<typeof credentialScopeSchema>;
type AdminScope = z.input<typeof adminScopeSchema>;

function checkedInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failure("INVALID_REQUEST");
  return parsed.data;
}

function issueKey(accountId: string, kind: "read" | "admin") {
  const id = randomUUID();
  const key = `${kind === "read" ? "pmr1" : "pma1"}.${accountId}.${id}.${randomSecret()}`;
  return { id, key };
}

export async function administrativeProof(
  admin: AdminMaterial,
  credential: string,
  path: string,
  body: string,
  method: "GET" | "POST" = "POST",
): Promise<string> {
  const { origin, accountId, vaultId } = admin.runtime.anchor;
  const issuedAt = Math.floor(Date.now() / 1000);
  const proof = checkedInput(requestProofSchema, {
    version: 1,
    origin,
    accountId,
    vaultId,
    credential,
    method,
    target: `${API_PATH}${path}`,
    bodyHash: await digest(body),
    nonce: randomSecret(),
    issuedAt,
    expiresAt: issuedAt + 45,
  });
  return signObject(proof, admin.signingKey, "passman-adminreq+jws");
}

export type PreparedInitialization = {
  bundle: VaultBundle;
  admin: AdminMaterial;
  adminKey: string;
  credential: { id: string; hash: string; label: string; expiresAt: number };
};
export type PreparedRotation = {
  expectedGeneration: number;
  fromEpoch: number;
  bundle: VaultBundle;
  admin: AdminMaterial;
};

export const preparedInitializationSchema = z
  .object({
    bundle: bundleSchema,
    admin: adminSchema,
    adminKey: z.string().min(1).max(200),
    credential: credentialDetails.extend({ id, hash: bytes32 }).strict(),
  })
  .strict();
export const preparedRotationSchema = z
  .object({
    expectedGeneration: z.number().int().positive(),
    fromEpoch: z.number().int().positive(),
    bundle: bundleSchema,
    admin: adminSchema,
  })
  .strict();

export class ManagementClient {
  readonly #origin: string;
  readonly #request: ReturnType<typeof transport>;
  readonly #expectedAccount: string | undefined;

  constructor(
    options: TransportOptions & { managementToken: string; accountId?: string },
  ) {
    this.#origin = canonicalOrigin(options.origin);
    this.#request = transport(options, options.managementToken);
    this.#transportOptions = {
      origin: this.#origin,
      fetch: options.fetch,
      signal: options.signal,
    };
    this.#expectedAccount = options.accountId
      ? checkedInput(id, options.accountId)
      : undefined;
  }

  readonly #transportOptions: TransportOptions;

  async identity() {
    const result = parseResponse(
      accountSchema,
      await this.#request("/account"),
    );
    const { account } = result;
    if (this.#expectedAccount && account?.accountId !== this.#expectedAccount)
      return failure("CONTEXT_MISMATCH");
    if (
      account &&
      (account.anchor.origin !== this.#origin ||
        account.accountId !== account.anchor.accountId ||
        account.vaultId !== account.anchor.vaultId)
    )
      return failure("CONTEXT_MISMATCH");
    return result;
  }

  async account() {
    return (await this.identity()).account;
  }

  async prepareInitialization(
    password: string,
    details: CredentialDetails,
  ): Promise<PreparedInitialization> {
    const validated = checkedInput(credentialDetails, details);
    if (await this.account()) return failure("VAULT_ALREADY_EXISTS");
    const { admin, bundle } = await initializeVault(
      this.#origin,
      randomUUID(),
      password,
    );
    const { id, key: adminKey } = issueKey(bundle.anchor.accountId, "admin");
    return {
      admin,
      bundle,
      adminKey,
      credential: { ...validated, id, hash: await digest(adminKey) },
    };
  }

  async initialize(input: PreparedInitialization): Promise<void> {
    const stage = checkedInput(preparedInitializationSchema, input);
    const admin = await validateAdministration(stage.admin);
    const bundle = stage.bundle;
    const selected = parseCredential(stage.adminKey, "admin");
    if (
      this.#origin !== bundle.anchor.origin ||
      !sameAnchor(bundle.anchor, admin.runtime.anchor) ||
      selected.accountId !== bundle.anchor.accountId ||
      selected.id !== stage.credential.id ||
      (await digest(stage.adminKey)) !== stage.credential.hash
    )
      return failure("CONTEXT_MISMATCH");
    checkRuntimeStatus(admin.runtime, bundle);
    if (bundle.generation !== admin.runtime.generation)
      return failure("CONTEXT_MISMATCH");
    await refreshRuntime(bundle.keyring, admin.runtime);
    const body = JSON.stringify({ bundle, credential: stage.credential });
    try {
      const result = parseResponse(
        credentialReceipt,
        await this.#request("/initialize", { method: "POST", body }),
      );
      if (result.id !== selected.id) return failure("CONTEXT_MISMATCH");
    } catch (error) {
      if (
        !(error instanceof PassmanError) ||
        !["VAULT_ALREADY_EXISTS", "UNAVAILABLE"].includes(error.code)
      )
        throw error;
      const account = await this.account();
      if (!account || !sameAnchor(account.anchor, bundle.anchor)) throw error;
      const verifier = new AdminClient({
        ...this.#transportOptions,
        adminKey: input.adminKey,
        custody: { loadAdmin: async () => admin },
      });
      await verifier.status();
    }
  }

  async download(): Promise<VaultBundle> {
    const bundle = parseResponse(
      bundleSchema,
      await this.#request("/administration"),
    );
    const account = await this.account();
    if (!account || !sameAnchor(account.anchor, bundle.anchor))
      return failure("CONTEXT_MISMATCH");
    return bundle;
  }

  async restoreAdministration(
    password: string,
    custody: AdminCustody,
  ): Promise<AdminMaterial> {
    if (!custody.saveAdmin) return failure("STORAGE_UNAVAILABLE");
    const bundle = await this.download();
    let previous: unknown;
    try {
      previous = await custody.loadAdmin({
        origin: bundle.anchor.origin,
        accountId: bundle.anchor.accountId,
      });
    } catch (error) {
      return storageError(error);
    }
    const current =
      previous === undefined
        ? undefined
        : await validateAdministration(previous);
    if (
      current &&
      (!sameAnchor(current.runtime.anchor, bundle.anchor) ||
        current.runtime.generation > bundle.generation)
    ) {
      return failure("CONTEXT_MISMATCH");
    }
    const admin = await restoreAdmin(
      bundle,
      password,
      current?.runtime.installationId,
      bundle.anchor,
    );
    try {
      await custody.saveAdmin(admin);
    } catch (error) {
      return storageError(error);
    }
    return admin;
  }

  async downloadRuntime(): Promise<BootstrapBundle> {
    const bundle = parseResponse(
      bootstrapBundleSchema,
      await this.#request("/console/bootstrap"),
    );
    const account = await this.account();
    if (!account || !sameAnchor(account.anchor, bundle.anchor))
      return failure("CONTEXT_MISMATCH");
    return bundle;
  }

  async restoreRuntime(
    password: string,
    custody: RuntimeCustody,
  ): Promise<RuntimeMaterial> {
    if (!custody.saveRuntime) return failure("STORAGE_UNAVAILABLE");
    const bundle = await this.downloadRuntime();
    try {
      const previous = await custody.loadRuntime({
        origin: bundle.anchor.origin,
        accountId: bundle.anchor.accountId,
      });
      const current =
        previous == null ? undefined : await validateRuntime(previous);
      if (
        current &&
        (!sameAnchor(current.anchor, bundle.anchor) ||
          current.generation > bundle.generation ||
          current.epoch > bundle.epoch)
      ) {
        return failure("CONTEXT_MISMATCH");
      }
      const runtime = await restoreRuntime(
        bundle,
        password,
        current?.installationId,
        bundle.anchor,
      );
      await custody.saveRuntime(runtime);
      return runtime;
    } catch (error) {
      return storageError(error);
    }
  }

  async enroll(
    input: AdminMaterial,
    details: CredentialDetails,
  ): Promise<string> {
    const admin = await validateAdministration(input);
    const { account, operatorId } = await this.identity();
    if (
      !account ||
      !operatorId ||
      !sameAnchor(account.anchor, admin.runtime.anchor)
    )
      return failure("CONTEXT_MISMATCH");
    const { id, key } = issueKey(account.accountId, "admin");
    const path = "/admin/enroll";
    const body = JSON.stringify({
      ...checkedInput(credentialDetails, details),
      id,
      hash: await digest(key),
    });
    const proof = await administrativeProof(
      admin,
      `management:${operatorId}`,
      path,
      body,
    );
    const result = parseResponse(
      credentialReceipt,
      await this.#request(path, {
        method: "POST",
        body,
        headers: { "x-passman-proof": proof },
      }),
    );
    if (result.id !== id) return failure("CONTEXT_MISMATCH");
    return key;
  }
}

export type AdminOptions = TransportOptions & {
  adminKey: string;
  custody: AdminCustody;
};

export class AdminClient {
  readonly #request: ReturnType<typeof transport>;
  readonly #selection: VaultSelection;
  readonly #credentialId: string;
  readonly #custody: AdminCustody;

  constructor(options: AdminOptions) {
    const selected = parseCredential(options.adminKey, "admin");
    this.#request = transport(options, options.adminKey);
    this.#selection = {
      origin: canonicalOrigin(options.origin),
      accountId: selected.accountId,
    };
    this.#credentialId = selected.id;
    this.#custody = options.custody;
  }

  async #local(): Promise<AdminMaterial> {
    let input: unknown;
    try {
      input = await this.#custody.loadAdmin({ ...this.#selection });
    } catch (error) {
      return storageError(error);
    }
    if (input === undefined) return failure("VAULT_NOT_PROVISIONED");
    const admin = await validateAdministration(input);
    checkSelection(admin.runtime.anchor, this.#selection);
    return admin;
  }

  async #status(): Promise<PublicStatus> {
    const schema = publicStatusSchema
      .extend({
        credential: credentialReceipt.extend({
          projects: z.array(id).nullable(),
          expiresAt: z.number().int().positive().nullable(),
          bootstrap: z.boolean(),
        }),
      })
      .strict();
    const status = parseResponse(schema, await this.#request("/status"));
    if (status.credential.id !== this.#credentialId)
      return failure("CONTEXT_MISMATCH");
    return status;
  }

  async #current(): Promise<AdminMaterial> {
    const admin = await this.#local();
    const status = await this.#status();
    checkRuntimeStatus(admin.runtime, status);
    if (status.generation === admin.runtime.generation) return admin;
    const { keyring } = parseResponse(
      z.object({ keyring: jws }).strict(),
      await this.#request("/keyring"),
    );
    const runtime = await refreshRuntime(keyring, admin.runtime);
    if (runtime.generation !== status.generation)
      return failure("CONTEXT_MISMATCH");
    checkRuntimeStatus(runtime, status);
    return { ...admin, runtime };
  }

  async status(): Promise<{
    accountId: string;
    epoch: number;
    generation: number;
  }> {
    const { runtime } = await this.#current();
    return {
      accountId: runtime.anchor.accountId,
      epoch: runtime.epoch,
      generation: runtime.generation,
    };
  }

  async sync(): Promise<void> {
    if (!this.#custody.saveAdmin) return failure("STORAGE_UNAVAILABLE");
    try {
      await this.#custody.saveAdmin(await this.#current());
    } catch (error) {
      return storageError(error);
    }
  }

  async #post(
    path: string,
    value: unknown,
    admin: AdminMaterial,
    managementToken?: string,
  ): Promise<unknown> {
    const body = JSON.stringify(value);
    const proof = await administrativeProof(
      admin,
      this.#credentialId,
      path,
      body,
    );
    const headers: Record<string, string> = { "x-passman-proof": proof };
    if (managementToken) headers["x-passman-management"] = managementToken;
    return this.#request(path, { method: "POST", body, headers });
  }

  async createProject(name: string) {
    return parseResponse(
      project.strict(),
      await this.#post(
        "/projects",
        { name: checkedName(projectName, name) },
        await this.#current(),
      ),
    );
  }

  async #activeProject(name: string) {
    const { projects } = parseResponse(
      z.object({ projects: z.array(project).max(1000) }).strict(),
      await this.#request("/projects"),
    );
    const matches = projects.filter((item) => item.name === name);
    if (matches.length !== 1)
      return failure(matches.length === 0 ? "NOT_FOUND" : "CONTEXT_MISMATCH");
    return matches[0]!;
  }

  async #existing(
    address: SecretAddress,
    runtime: RuntimeMaterial,
    projectId: string,
  ): Promise<SecretRecord> {
    const record = checkRecordAddress(
      parseResponse(recordSchema, await this.#request(secretPath(address))),
      this.#selection,
      address,
    );
    if (
      record.context.vaultId !== runtime.anchor.vaultId ||
      record.context.projectId !== projectId ||
      record.context.epoch > runtime.epoch
    )
      return failure("CONTEXT_MISMATCH");
    if (record.context.state !== "pending")
      return verifyRecord(record, runtime.anchor, address);
    if (record.signature !== null) return failure("SIGNATURE_INVALID");
    return record;
  }

  async #record(
    address: SecretAddress,
    value: string,
    mode: "create" | "update" | "activate" | "delete" | "reject" | "recreate",
  ) {
    secretPath(address);
    const admin = await this.#current();
    const { runtime } = admin;
    const { anchor } = runtime;
    const project = await this.#activeProject(address.project);
    const existing =
      mode === "create"
        ? undefined
        : await this.#existing(address, runtime, project.id);
    let expectedDigest: string | undefined;
    if (mode === "activate" || mode === "reject") {
      if (existing?.context.state !== "pending") return failure("CONFLICT");
      if (mode === "activate") {
        if (
          existing.context.epoch !== runtime.epoch ||
          existing.context.keyId !== runtime.activeKeyId
        )
          return failure("CONTEXT_MISMATCH");
        const key = runtime.keys.find(
          (key) => key.id === existing.context.keyId,
        );
        if (!key) return failure("CONTEXT_MISMATCH");
        if (
          value !==
          (await openValue(existing, key.privateKey, existing.context))
        )
          return failure("PENDING_VERIFICATION_REQUIRED");
      }
      expectedDigest = await digest(JSON.stringify(existing));
    } else if (existing?.context.state === "pending") {
      return failure("PENDING_VERIFICATION_REQUIRED");
    } else if (
      mode === "recreate"
        ? existing?.context.state !== "deleted"
        : existing?.context.state === "deleted"
    ) {
      return failure(mode === "recreate" ? "CONFLICT" : "NOT_FOUND");
    }
    const active = runtime.keys.find((key) => key.id === runtime.activeKeyId);
    if (!active) return failure("CONTEXT_MISMATCH");
    const expectedRevision = existing?.context.revision ?? 0;
    const context: RecordContext = {
      version: 1,
      origin: anchor.origin,
      accountId: anchor.accountId,
      vaultId: anchor.vaultId,
      project: address.project,
      projectId: project.id,
      name: address.name,
      secretId: existing?.context.secretId ?? randomUUID(),
      epoch: runtime.epoch,
      keyId: active.id,
      revision: expectedRevision + 1,
      state: mode === "delete" || mode === "reject" ? "deleted" : "active",
    };
    const record = await signRecord(
      await sealValue(value, active.publicKey, context),
      admin.signingKey,
    );
    const receipt = parseResponse(
      mutationReceipt,
      await this.#post(
        `/projects/${address.project}/secrets`,
        { record, expectedRevision, expectedDigest },
        admin,
      ),
    );
    if (
      receipt.state !== context.state ||
      receipt.revision !== context.revision
    )
      return failure("CONTEXT_MISMATCH");
    return receipt;
  }

  createSecret(address: SecretAddress, value: string) {
    return this.#record(address, value, "create");
  }
  updateSecret(address: SecretAddress, value: string) {
    return this.#record(address, value, "update");
  }
  activatePending(address: SecretAddress, expectedValue: string) {
    return this.#record(address, expectedValue, "activate");
  }
  rejectPending(address: SecretAddress) {
    return this.#record(address, "", "reject");
  }
  deleteSecret(address: SecretAddress) {
    return this.#record(address, "", "delete");
  }
  recreateSecret(address: SecretAddress, value: string) {
    return this.#record(address, value, "recreate");
  }

  async #issue(kind: "read" | "admin", scope: unknown): Promise<string> {
    const admin = await this.#current();
    const { id, key } = issueKey(admin.runtime.anchor.accountId, kind);
    const result = parseResponse(
      credentialReceipt,
      await this.#post(
        "/credentials",
        { id, hash: await digest(key), kind, scope },
        admin,
      ),
    );
    if (result.id !== id) return failure("CONTEXT_MISMATCH");
    return key;
  }

  issueServiceKey(scope: ReadScope) {
    return this.#issue("read", checkedInput(credentialScopeSchema, scope));
  }

  issueAdminKey(scope: AdminScope) {
    return this.#issue("admin", {
      ...checkedInput(adminScopeSchema, scope),
      bootstrap: false,
    });
  }

  async revokeCredential(credentialId: string): Promise<void> {
    parseResponse(
      z.object({ revoked: z.literal(true) }).strict(),
      await this.#post(
        `/credentials/${checkedInput(id, credentialId)}/revoke`,
        {},
        await this.#current(),
      ),
    );
  }

  async #publishVault(
    expectedGeneration: number,
    updated: VaultBundle,
    admin: AdminMaterial,
    managementToken?: string,
  ): Promise<void> {
    const result = parseResponse(
      z.object({ generation: z.number().int().positive() }).strict(),
      await this.#post(
        "/vault",
        { bundle: updated, expectedGeneration },
        admin,
        managementToken,
      ),
    );
    if (result.generation !== updated.generation)
      return failure("CONTEXT_MISMATCH");
  }

  async changePassword(
    current: VaultBundle,
    oldPassword: string,
    newPassword: string,
    managementToken: string,
  ): Promise<void> {
    const admin = await this.#current();
    this.#requireCurrentBundle(current, admin);
    await restoreAdmin(
      current,
      oldPassword,
      admin.runtime.installationId,
      admin.runtime.anchor,
    );
    await this.#rewrapPassword(current, admin, newPassword, managementToken);
  }

  #requireCurrentBundle(bundle: VaultBundle, admin: AdminMaterial): void {
    checkRuntimeStatus(admin.runtime, bundle);
    if (admin.runtime.generation !== bundle.generation)
      failure("CONTEXT_MISMATCH");
  }

  async #rewrapPassword(
    current: VaultBundle,
    admin: AdminMaterial,
    newPassword: string,
    managementToken: string,
  ): Promise<void> {
    if (!this.#custody.saveAdmin) return failure("STORAGE_UNAVAILABLE");
    const updated = await rewrapVaultPassword(current, admin, newPassword);
    await this.#publishVault(
      current.generation,
      updated,
      admin,
      managementToken,
    );
    const runtime = await refreshRuntime(updated.keyring, admin.runtime);
    try {
      await this.#custody.saveAdmin({ ...admin, runtime });
    } catch (error) {
      return storageError(error);
    }
  }

  async resetPassword(
    current: VaultBundle,
    newPassword: string,
    managementToken: string,
    verifyLocalOwner: (selection: VaultSelection) => Promise<void>,
  ): Promise<void> {
    try {
      await verifyLocalOwner({ ...this.#selection });
    } catch {
      return failure("FORBIDDEN");
    }
    const admin = await this.#current();
    this.#requireCurrentBundle(current, admin);
    await this.#rewrapPassword(current, admin, newPassword, managementToken);
  }

  async prepareRotation(
    current: VaultBundle,
    replacementPassword?: string,
  ): Promise<PreparedRotation> {
    const original = await this.#current();
    this.#requireCurrentBundle(current, original);
    const { bundle, admin } = await rotateVaultKey(
      current,
      original,
      replacementPassword,
    );
    return {
      expectedGeneration: current.generation,
      fromEpoch: current.epoch,
      bundle,
      admin,
    };
  }

  async commitRotation(
    input: PreparedRotation,
    managementToken?: string,
  ): Promise<{ epoch: number; generation: number }> {
    if (!this.#custody.saveAdmin) return failure("STORAGE_UNAVAILABLE");
    const stage = checkedInput(preparedRotationSchema, input);
    const original = await this.#local();
    const admin = await validateAdministration(stage.admin);
    const bundle = stage.bundle;
    await refreshRuntime(bundle.keyring, admin.runtime);
    checkRuntimeStatus(admin.runtime, bundle);
    if (
      !sameAnchor(original.runtime.anchor, bundle.anchor) ||
      bundle.generation !== stage.expectedGeneration + 1 ||
      admin.runtime.generation !== bundle.generation ||
      (bundle.epoch !== stage.fromEpoch && bundle.epoch !== stage.fromEpoch + 1)
    ) {
      return failure("CONTEXT_MISMATCH");
    }
    const status = await this.#status();
    if (
      status.generation === stage.expectedGeneration &&
      status.epoch === stage.fromEpoch
    ) {
      checkRuntimeStatus(original.runtime, status);
      await this.#publishVault(
        stage.expectedGeneration,
        bundle,
        original,
        managementToken,
      );
    } else if (status.generation === bundle.generation) {
      checkRuntimeStatus(admin.runtime, status);
      const result = parseResponse(
        z.object({ keyring: jws }).strict(),
        await this.#request("/keyring"),
      );
      if (result.keyring !== bundle.keyring) return failure("CONFLICT");
    } else {
      return failure("CONFLICT");
    }
    try {
      await this.#custody.saveAdmin(admin);
    } catch (error) {
      return storageError(error);
    }
    return { epoch: bundle.epoch, generation: bundle.generation };
  }

  async rotate(
    current: VaultBundle,
    persist: (stage: PreparedRotation) => Promise<void>,
    replacement?: { password: string; managementToken: string },
  ): Promise<{ epoch: number; generation: number }> {
    const stage = await this.prepareRotation(current, replacement?.password);
    await persist(stage);
    return this.commitRotation(stage, replacement?.managementToken);
  }
}
