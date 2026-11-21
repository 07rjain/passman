import {
  ENV_FILE_MAX,
  importContextSchema,
  importResultSchema,
  projectNameSchema,
  encryptValue,
  type ErrorCode,
} from "@keyman-mvp/core";
import { request, KeymanError, type Transport } from "./index.js";
import {
  hasUploadAuthorization,
  readPrivateBytes,
  LocalVaultError,
  type Identity,
} from "./vault.js";
import { parseEnv, EnvImportError } from "./env.js";

export type ImportConflictPolicy = "error" | "skip" | "replace";
export type EnvImportPreview = {
  project: string;
  entries: {
    name: string;
    line: number;
    action: "create" | "replace" | "skip" | "conflict";
    empty: boolean;
    literalReferences: boolean;
  }[];
  create: number;
  replace: number;
  skip: number;
  conflicts: number;
  empty: number;
  ready: boolean;
};
export type EnvImportResult = {
  imported: { name: string; revision: number }[];
  skipped: string[];
};
export type PreparedEnvImport = {
  preview: EnvImportPreview;
  commit: () => Promise<EnvImportResult>;
};
export class ImportCommitError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly outcome: "unknown" | "not-applied",
  ) {
    super(
      outcome === "unknown"
        ? "Import outcome unknown. The batch may have committed; inspect project metadata before deliberately retrying. No automatic retry was made."
        : `Import was not applied (${code}). ${code === "EXPIRED" || code === "UNAUTHORIZED" ? "Run passman login with the same vault, then refresh the preview." : "Refresh the preview before retrying."}`,
    );
    this.name = "ImportCommitError";
  }
}
/** Read protected input without sending plaintext through a transport. */
export async function readEnvFile(file: string): Promise<Uint8Array> {
  try {
    return await readPrivateBytes(file, ENV_FILE_MAX);
  } catch {
    throw new LocalVaultError();
  }
}

/** Administrative only. Preview is metadata; parsed values stay inside the commit closure. */
export async function prepareEnvImport(options: {
  identity: Identity;
  project: string;
  source: string | Uint8Array;
  conflicts?: ImportConflictPolicy;
  allowEmpty?: boolean;
  transport?: Transport;
}): Promise<PreparedEnvImport> {
  try {
    const identity = structuredClone(options.identity);
    if (!hasUploadAuthorization(identity)) throw new KeymanError("EXPIRED");
    const project = projectNameSchema.safeParse(options.project);
    const policy = options.conflicts ?? "error";
    if (
      !project.success ||
      !["error", "skip", "replace"].includes(policy) ||
      (options.allowEmpty !== undefined &&
        typeof options.allowEmpty !== "boolean")
    )
      throw new KeymanError("INVALID_REQUEST");
    const entries = parseEnv(options.source);
    const headers = {
      authorization: `Bearer ${identity.upload.token}`,
      "content-type": "application/json",
    };
    const info = importContextSchema.parse(
      await request(
        identity.origin,
        "/api/upload/import-context",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            project: project.data,
            names: entries.map((e) => e.name),
          }),
        },
        options.transport,
      ),
    );
    if (
      info.project.name !== project.data ||
      info.vault.id !== identity.vault.id ||
      info.vault.accountId !== identity.vault.accountId ||
      info.vault.keyId !== identity.keyId ||
      JSON.stringify(info.vault.publicKey) !==
        JSON.stringify(identity.publicKey)
    )
      throw new KeymanError("KEY_MISMATCH");
    if (
      info.entries.length !== entries.length ||
      info.entries.some((entry, n) => entry.name !== entries[n]!.name)
    )
      throw new KeymanError("UNAVAILABLE");
    const planned = entries.map((entry, n) => ({
      ...entry,
      expectedRevision: info.entries[n]!.revision,
      action:
        info.entries[n]!.revision === 0
          ? ("create" as const)
          : policy === "error"
            ? ("conflict" as const)
            : policy,
    }));
    const preview: EnvImportPreview = {
      project: project.data,
      entries: planned.map(
        ({ name, line, action, value, literalReferences }) => ({
          name,
          line,
          action,
          empty: value === "",
          literalReferences,
        }),
      ),
      create: planned.filter((e) => e.action === "create").length,
      replace: planned.filter((e) => e.action === "replace").length,
      skip: planned.filter((e) => e.action === "skip").length,
      conflicts: planned.filter((e) => e.action === "conflict").length,
      empty: planned.filter((e) => e.value === "" && e.action !== "skip")
        .length,
      ready: false,
    };
    const ready =
      preview.conflicts === 0 &&
      (preview.empty === 0 || options.allowEmpty === true);
    preview.ready = ready;
    const selected = planned.filter(
      (e) => e.action === "create" || e.action === "replace",
    );
    const skipped = planned
      .filter((e) => e.action === "skip")
      .map((e) => e.name);
    let attempted = false;
    return {
      preview,
      async commit() {
        if (!ready || attempted)
          throw new KeymanError(
            preview.conflicts ? "CONFLICT" : "INVALID_REQUEST",
          );
        attempted = true;
        if (!hasUploadAuthorization(identity)) throw new KeymanError("EXPIRED");
        if (!selected.length) return { imported: [], skipped };
        let sent = false;
        try {
          const encrypted = await Promise.all(
            selected.map(async (entry) => ({
              name: entry.name,
              expectedRevision: entry.expectedRevision,
              envelope: await encryptValue(entry.value, identity.publicKey, {
                version: 1,
                accountId: info.vault.accountId,
                vaultId: info.vault.id,
                projectId: info.project.id,
                project: info.project.name,
                name: entry.name,
                revision: entry.expectedRevision + 1,
              }),
            })),
          );
          const body = JSON.stringify({
            projectId: info.project.id,
            entries: encrypted,
          });
          if (Buffer.byteLength(body) > 120000)
            throw new KeymanError("INVALID_REQUEST");
          if (!hasUploadAuthorization(identity))
            throw new KeymanError("EXPIRED");
          sent = true;
          const result = importResultSchema.parse(
            await request(
              identity.origin,
              "/api/upload/import",
              { method: "POST", headers, body },
              options.transport,
            ),
          );
          if (
            result.imported.length !== selected.length ||
            result.imported.some(
              (entry, n) =>
                entry.name !== selected[n]!.name ||
                entry.revision !== selected[n]!.expectedRevision + 1,
            )
          )
            throw new KeymanError("UNAVAILABLE");
          return { ...result, skipped };
        } catch (error) {
          const code =
            error instanceof KeymanError ? error.code : "UNAVAILABLE";
          throw new ImportCommitError(
            code,
            sent && code === "UNAVAILABLE" ? "unknown" : "not-applied",
          );
        }
      },
    };
  } catch (error) {
    if (error instanceof KeymanError || error instanceof EnvImportError)
      throw error;
    throw new KeymanError("UNAVAILABLE");
  }
}
