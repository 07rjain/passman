import {
  z,
  recordSchema,
  projectSchema,
  vaultSchema,
  contextSchema,
  publicKeySchema,
  decryptValue,
  encryptValue,
  errorSchema,
  type ErrorCode,
} from "@keyman-mvp/core";
import { apiOrigin, type Identity } from "./vault.js";
export {
  initializeIdentity,
  unlockIdentity,
  saveIdentity,
  readPrivateFile,
  LocalVaultError,
  type Identity,
} from "./vault.js";
export class KeymanError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(`Keyman operation failed (${code})`);
    this.name = "KeymanError";
  }
}
export type Transport = typeof fetch;
async function redacted<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof KeymanError) throw error;
    throw new KeymanError("UNAVAILABLE");
  }
}
export async function request(
  origin: string,
  path: string,
  init: RequestInit = {},
  transport: Transport = fetch,
): Promise<unknown> {
  try {
    apiOrigin(origin);
    if (!path.startsWith("/api/") || path.startsWith("//"))
      throw new KeymanError("INVALID_REQUEST");
    const response = await transport(origin + path, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new KeymanError("UNAVAILABLE");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > 150000) {
          await reader.cancel();
          throw new KeymanError("UNAVAILABLE");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!response.ok) {
      const error = errorSchema.safeParse(data);
      throw new KeymanError(
        error.success ? error.data.error.code : "UNAVAILABLE",
      );
    }
    return data;
  } catch (error) {
    if (error instanceof KeymanError) throw error;
    throw new KeymanError("UNAVAILABLE");
  }
}
export const startedSchema = z
  .object({
    id: z.string().uuid(),
    deviceCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    userCode: z.string().regex(/^[a-f0-9]{12}$/),
    keyId: z.string().length(43),
    verificationUrl: z.string().url(),
    expiresIn: z.number().int().positive(),
    interval: z.number().int().min(1),
  })
  .strict();
export async function startLogin(identity: Identity, transport?: Transport) {
  return redacted(async () => {
    const started = startedSchema.parse(
      await request(
        identity.origin,
        "/api/device/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publicKey: identity.publicKey }),
        },
        transport,
      ),
    );
    if (
      started.keyId !== identity.keyId ||
      started.verificationUrl !== identity.origin + "/?device=" + started.id
    )
      throw new KeymanError("KEY_MISMATCH");
    return started;
  });
}
export async function pollLogin(
  identity: Identity,
  deviceCode: string,
  transport?: Transport,
): Promise<Identity | undefined> {
  return redacted(async () => {
    const result = z
      .discriminatedUnion("status", [
        z.object({ status: z.literal("pending") }).strict(),
        z
          .object({
            status: z.literal("approved"),
            vault: vaultSchema,
            uploadToken: z.string().regex(/^kmu_[A-Za-z0-9_-]{43}$/),
            expiresAt: z.number().int().positive(),
          })
          .strict(),
      ])
      .parse(
        await request(
          identity.origin,
          "/api/device/poll",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ deviceCode }),
          },
          transport,
        ),
      );
    if (result.status === "pending") return undefined;
    if (
      result.vault.keyId !== identity.keyId ||
      JSON.stringify(result.vault.publicKey) !==
        JSON.stringify(identity.publicKey) ||
      (identity.vault &&
        (result.vault.id !== identity.vault.id ||
          result.vault.accountId !== identity.vault.accountId))
    )
      throw new KeymanError("KEY_MISMATCH");
    return {
      ...identity,
      vault: result.vault,
      upload: { token: result.uploadToken, expiresAt: result.expiresAt },
    };
  });
}
/** Administrative CLI operation. The runtime SDK exposes no write method. */
export async function uploadValue(
  identity: Identity,
  project: string,
  name: string,
  value: string,
  replace = false,
  transport?: Transport,
) {
  return redacted(async () => {
    if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 65536)
      throw new KeymanError("INVALID_REQUEST");
    if (
      !identity.vault ||
      !identity.upload ||
      identity.upload.expiresAt <= Date.now() / 1000
    )
      throw new KeymanError("EXPIRED");
    const headers = {
      authorization: `Bearer ${identity.upload.token}`,
      "content-type": "application/json",
    };
    const info = z
      .object({
        vault: vaultSchema,
        project: projectSchema,
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(
        await request(
          identity.origin,
          "/api/upload/context",
          { method: "POST", headers, body: JSON.stringify({ project, name }) },
          transport,
        ),
      );
    if (
      info.project.name !== project ||
      info.vault.id !== identity.vault.id ||
      info.vault.accountId !== identity.vault.accountId ||
      info.vault.keyId !== identity.keyId ||
      JSON.stringify(publicKeySchema.parse(info.vault.publicKey)) !==
        JSON.stringify(identity.publicKey)
    )
      throw new KeymanError("KEY_MISMATCH");
    if (info.revision > 0 && !replace) throw new KeymanError("CONFLICT");
    const context = contextSchema.parse({
      version: 1,
      accountId: info.vault.accountId,
      vaultId: info.vault.id,
      projectId: info.project.id,
      project,
      name,
      revision: info.revision + 1,
    });
    const envelope = await encryptValue(value, identity.publicKey, context);
    return z
      .object({ name: z.string(), revision: z.number().int() })
      .strict()
      .parse(
        await request(
          identity.origin,
          "/api/upload",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              projectId: info.project.id,
              name,
              expectedRevision: info.revision,
              envelope,
            }),
          },
          transport,
        ),
      );
  });
}
export class KeymanClient {
  constructor(
    private readonly options: {
      identity: Identity;
      serviceKey: string;
      project: string;
      transport?: Transport;
    },
  ) {
    apiOrigin(options.identity.origin);
    if (
      !options.identity.vault ||
      !/^kmr_[A-Za-z0-9_-]{43}$/.test(options.serviceKey)
    )
      throw new KeymanError("UNAUTHORIZED");
  }
  private get(path: string) {
    return request(
      this.options.identity.origin,
      path,
      { headers: { authorization: `Bearer ${this.options.serviceKey}` } },
      this.options.transport,
    );
  }
  async getSecret(input: { name: string }): Promise<string> {
    try {
      const record = recordSchema.parse(
        await this.get(
          "/api/v1/secret?" +
            new URLSearchParams({
              project: this.options.project,
              name: input.name,
            }),
        ),
      );
      const vault = this.options.identity.vault!;
      if (
        record.context.accountId !== vault.accountId ||
        record.context.vaultId !== vault.id ||
        record.context.name !== input.name ||
        record.context.project !== this.options.project ||
        record.envelope.keyId !== this.options.identity.keyId
      )
        throw new KeymanError("KEY_MISMATCH");
      return await decryptValue(
        record.envelope,
        this.options.identity.privateKey,
        record.context,
      );
    } catch (error) {
      if (error instanceof KeymanError) throw error;
      throw new KeymanError("KEY_MISMATCH");
    }
  }
  async search(input: { query?: string; after?: string } = {}) {
    return redacted(async () => {
      return z
        .object({
          items: z
            .array(
              z
                .object({
                  name: z.string(),
                  revision: z.number().int().positive(),
                })
                .strict(),
            )
            .max(50),
          nextCursor: z.string().nullable(),
        })
        .strict()
        .parse(
          await this.get(
            "/api/v1/search?" +
              new URLSearchParams({
                project: this.options.project,
                q: input.query ?? "",
                after: input.after ?? "",
              }),
          ),
        );
    });
  }
  async hasSecret(input: { name: string }): Promise<boolean> {
    return redacted(async () => {
      return z
        .object({ exists: z.boolean() })
        .strict()
        .parse(
          await this.get(
            "/api/v1/exists?" +
              new URLSearchParams({
                project: this.options.project,
                name: input.name,
              }),
          ),
        ).exists;
    });
  }
}
