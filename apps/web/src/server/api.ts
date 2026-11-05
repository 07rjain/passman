import { reverificationError } from "@clerk/shared/authorization-errors";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  z,
  publicKeySchema,
  keyFingerprint,
  vaultSchema,
  projectNameSchema,
  idSchema,
  nameSchema,
  envelopeSchema,
  type ErrorCode,
  type Vault,
} from "@keyman-mvp/core";
import type { Human } from "./auth";
import { transaction as databaseTransaction } from "./database";
import {
  actionFor,
  actionSchema,
  auditContext,
  auditFailure,
  identify,
  recordAudit,
  type AuditContext,
} from "./audit";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const time = () => Math.floor(Date.now() / 1000);
export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    public status: number,
  ) {
    super(code);
  }
}
export function failure(code: ErrorCode, status: number) {
  return Response.json(
    {
      error: {
        code,
        message:
          code === "NOT_FOUND"
            ? "Requested item was not found"
            : code === "KEY_MISMATCH"
              ? "This account uses another vault key; account login cannot recover it"
              : "Request could not be completed",
      },
    },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
class RecentRequired extends Error {}
type Account = {
  id: string;
  vault_id: string;
  public_key: unknown;
  key_id: string;
};
type Credential = {
  accountId: string;
  kind: "read" | "upload";
  projectId: string | null;
};
export function createApi(options: {
  pool: Pool;
  origin: string;
  authenticate: (req: Request) => Promise<Human>;
}) {
  const { pool, origin } = options;
  if (
    new URL(origin).origin !== origin ||
    (!origin.startsWith("https:") &&
      !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
  )
    throw new Error("Invalid configured origin");
  async function transaction<T>(
    db: Pool,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return databaseTransaction(db, async (client) => {
      const result = await fn(client);
      const context = auditContext.getStore();
      if (
        result instanceof Response &&
        result.ok &&
        context &&
        !context.recorded
      ) {
        await recordAudit(
          client,
          context,
          "success",
          result.status === 202 ? "PENDING" : "OK",
        );
        // Mark only after COMMIT succeeds in the caller below.
      }
      return result;
    }).then((result) => {
      const context = auditContext.getStore();
      if (result instanceof Response && result.ok && context)
        context.recorded = true;
      return result;
    });
  }
  async function mutation(sql: string, values: unknown[]) {
    return transaction(pool, async (client) => {
      const result = await client.query(sql, values);
      if (!result.rowCount)
        throw new ApiError(
          auditContext.getStore()?.action === "credential.revoke"
            ? "NOT_FOUND"
            : "CONFLICT",
          auditContext.getStore()?.action === "credential.revoke" ? 404 : 409,
        );
      const context = auditContext.getStore()!;
      await recordAudit(client, context, "success", "OK");
      return result;
    }).then((result) => {
      auditContext.getStore()!.recorded = true;
      return result;
    });
  }
  async function body(req: Request): Promise<unknown> {
    if (
      req.headers.get("content-type")?.split(";")[0] !== "application/json" ||
      Number(req.headers.get("content-length") ?? 0) > 120000
    )
      throw new ApiError("INVALID_REQUEST", 400);
    const reader = req.body?.getReader();
    if (!reader) throw new ApiError("INVALID_REQUEST", 400);
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 120000) {
          await reader.cancel();
          throw new ApiError("INVALID_REQUEST", 400);
        }
        parts.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  }
  async function limit(client: PoolClient, subject: string, max = 120) {
    const window = Math.floor(time() / 60),
      key = hash(subject);
    await client.query("DELETE FROM keyman_mvp.limits WHERE bucket<$1", [
      window - 2,
    ]);
    const row = (
      await client.query<{ count: number }>(
        "INSERT INTO keyman_mvp.limits(subject,bucket,count) VALUES($1,$2,1) ON CONFLICT(subject,bucket) DO UPDATE SET count=keyman_mvp.limits.count+1 RETURNING count",
        [key, window],
      )
    ).rows[0];
    if (!row || row.count > max) throw new ApiError("RATE_LIMITED", 429);
  }
  async function human(req: Request, recent = false) {
    const suppliedOrigin = req.headers.get("origin");
    if (suppliedOrigin && suppliedOrigin !== origin)
      throw new ApiError("FORBIDDEN", 403);
    let user: Human;
    try {
      user = await options.authenticate(req);
    } catch {
      throw new ApiError("UNAUTHORIZED", 401);
    }
    identify({ actorId: user.id });
    if (recent && !user.recent) throw new RecentRequired();
    return user;
  }
  async function account(client: PoolClient, user: Human): Promise<Account> {
    const row = (
      await client.query<Account>(
        "SELECT * FROM keyman_mvp.accounts WHERE clerk_id=$1",
        [user.id],
      )
    ).rows[0];
    if (!row) throw new ApiError("NOT_FOUND", 404);
    identify({ accountId: row.id });
    return row;
  }
  function vault(row: Account): Vault {
    return vaultSchema.parse({
      id: row.vault_id,
      accountId: row.id,
      publicKey: row.public_key,
      keyId: row.key_id,
    });
  }
  async function credential(
    req: Request,
    kind: "read" | "upload",
  ): Promise<Credential> {
    const header = req.headers.get("authorization") ?? "",
      prefix = kind === "read" ? "kmr_" : "kmu_";
    if (!new RegExp(`^Bearer ${prefix}[A-Za-z0-9_-]{43}$`).test(header))
      throw new ApiError("UNAUTHORIZED", 401);
    return await transaction(pool, async (client) => {
      const digest = hash(header.slice(7));
      // Valid credential counters commit separately from route work across instances.
      // Failed authentication rolls back this counter; edge/IP abuse limits are required.
      await limit(client, "credential:" + digest);
      const row = (
        await client.query<{
          id: string;
          account_id: string;
          project_id: string | null;
          expires_at: string;
          revoked: boolean;
        }>(
          "SELECT id,account_id,project_id,expires_at,revoked FROM keyman_mvp.credentials WHERE hash=$1 AND kind=$2",
          [digest, kind],
        )
      ).rows[0];
      if (!row) throw new ApiError("UNAUTHORIZED", 401);
      identify({ accountId: row.account_id, credentialId: row.id });
      if (row.revoked || Number(row.expires_at) <= time()) {
        const context = auditContext.getStore();
        if (context)
          context.denialReason = row.revoked
            ? "CREDENTIAL_REVOKED"
            : "CREDENTIAL_EXPIRED";
        throw new ApiError("UNAUTHORIZED", 401);
      }
      return { accountId: row.account_id, kind, projectId: row.project_id };
    });
  }
  async function project(
    client: PoolClient,
    accountId: string,
    name: string,
    allowed?: string | null,
  ) {
    const row = (
      await client.query<{ id: string; name: string }>(
        "SELECT id,name FROM keyman_mvp.projects WHERE account_id=$1 AND name=$2",
        [accountId, name],
      )
    ).rows[0];
    if (!row || (allowed && row.id !== allowed))
      throw new ApiError("NOT_FOUND", 404);
    identify({ resourceId: row.id });
    return row;
  }
  async function dispatch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url),
        path = url.pathname,
        method = req.method;
      if (url.origin !== origin) throw new ApiError("INVALID_REQUEST", 400);
      if (path === "/api/health" && method === "GET") {
        const result = await pool.query(
          "SELECT version FROM keyman_mvp.migrations WHERE version=2",
        );
        if (!result.rowCount) throw new ApiError("UNAVAILABLE", 503);
        return Response.json({ status: "ready" });
      }
      if (path === "/api/device/start" && method === "POST") {
        const input = z
          .object({ publicKey: publicKeySchema })
          .strict()
          .parse(await body(req));
        // The global public-start bucket is a baseline; deploy an edge/IP limit as well.
        await transaction(pool, (c) => limit(c, "public-device-start", 30));
        const deviceCode = randomBytes(32).toString("base64url"),
          userCode = randomBytes(6).toString("hex"),
          id = randomUUID(),
          keyId = await keyFingerprint(input.publicKey);
        await pool.query("DELETE FROM keyman_mvp.devices WHERE expires_at<$1", [
          time() - 600,
        ]);
        identify({ resourceId: id });
        await mutation(
          "INSERT INTO keyman_mvp.devices(id,public_key,key_id,device_hash,code_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id,
            input.publicKey,
            keyId,
            hash(deviceCode),
            hash(userCode),
            time() + 600,
          ],
        );
        return Response.json({
          id,
          deviceCode,
          userCode,
          keyId,
          verificationUrl: origin + "/?device=" + id,
          expiresIn: 600,
          interval: 3,
        });
      }
      if (path === "/api/device/poll" && method === "POST") {
        // A fixed shared bucket accounts for all attempts, including rotating
        // unknown codes. Never allocate durable per-code state before lookup.
        await transaction(pool, (c) => limit(c, "public-device-poll", 1200));
        const input = z
          .object({ deviceCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
          .strict()
          .parse(await body(req));
        return await transaction(pool, async (client) => {
          const row = (
            await client.query<{
              id: string;
              account_id: string | null;
              approved: boolean;
              expires_at: string;
              consumed: boolean;
            }>(
              "SELECT * FROM keyman_mvp.devices WHERE device_hash=$1 FOR UPDATE",
              [hash(input.deviceCode)],
            )
          ).rows[0];
          if (!row || row.consumed) throw new ApiError("UNAUTHORIZED", 401);
          if (Number(row.expires_at) <= time())
            throw new ApiError("EXPIRED", 410);
          await limit(client, "poll:" + row.id, 30);
          if (!row.approved || !row.account_id)
            return Response.json({ status: "pending" }, { status: 202 });
          identify({ accountId: row.account_id, resourceId: row.id });
          const token = "kmu_" + randomBytes(32).toString("base64url"),
            expiresAt = time() + 1200;
          await client.query(
            "INSERT INTO keyman_mvp.credentials(id,account_id,hash,label,kind,expires_at) VALUES($1,$2,$3,'Local administrative upload','upload',$4)",
            [randomUUID(), row.account_id, hash(token), expiresAt],
          );
          await client.query(
            "UPDATE keyman_mvp.devices SET consumed=true WHERE id=$1",
            [row.id],
          );
          const owner = (
            await client.query<Account>(
              "SELECT * FROM keyman_mvp.accounts WHERE id=$1",
              [row.account_id],
            )
          ).rows[0]!;
          return Response.json({
            status: "approved",
            vault: vault(owner),
            uploadToken: token,
            expiresAt,
          });
        });
      }
      if (path.startsWith("/api/device/") && method === "GET") {
        const user = await human(req),
          id = idSchema.parse(path.slice("/api/device/".length));
        await transaction(pool, (c) => limit(c, "human:" + user.id));
        const row = (
          await pool.query<{ key_id: string; expires_at: string }>(
            "SELECT key_id,expires_at FROM keyman_mvp.devices WHERE id=$1 AND consumed=false AND expires_at>$2",
            [id, time()],
          )
        ).rows[0];
        if (!row) throw new ApiError("NOT_FOUND", 404);
        return Response.json({
          id,
          keyId: row.key_id,
          expiresAt: Number(row.expires_at),
        });
      }
      if (path === "/api/device/approve" && method === "POST") {
        const user = await human(req, true);
        const input = z
          .object({
            id: idSchema,
            userCode: z.string().regex(/^[a-f0-9]{12}$/),
            keyId: z.string().length(43),
            acknowledgeLoss: z.literal(true),
          })
          .strict()
          .parse(await body(req));
        await transaction(pool, (c) => limit(c, "approve:" + user.id, 20));
        return await transaction(pool, async (client) => {
          const row = (
            await client.query<{
              public_key: unknown;
              key_id: string;
              account_id: string | null;
              approved: boolean;
              code_hash: string;
            }>(
              "SELECT * FROM keyman_mvp.devices WHERE id=$1 AND consumed=false AND expires_at>$2 FOR UPDATE",
              [input.id, time()],
            )
          ).rows[0];
          if (
            !row ||
            row.approved ||
            row.code_hash !== hash(input.userCode) ||
            row.key_id !== input.keyId
          )
            throw new ApiError("FORBIDDEN", 403);
          await client.query(
            "INSERT INTO keyman_mvp.accounts(id,clerk_id,vault_id,public_key,key_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(clerk_id) DO NOTHING",
            [randomUUID(), user.id, randomUUID(), row.public_key, row.key_id],
          );
          const owner = (
            await client.query<Account>(
              "SELECT * FROM keyman_mvp.accounts WHERE clerk_id=$1 FOR UPDATE",
              [user.id],
            )
          ).rows[0]!;
          identify({ accountId: owner.id, resourceId: input.id });
          if (
            owner.key_id !== row.key_id ||
            JSON.stringify(publicKeySchema.parse(owner.public_key)) !==
              JSON.stringify(publicKeySchema.parse(row.public_key))
          )
            throw new ApiError("KEY_MISMATCH", 409);
          await client.query(
            "UPDATE keyman_mvp.devices SET approved=true,account_id=$2 WHERE id=$1",
            [input.id, owner.id],
          );
          return Response.json({ approved: true });
        });
      }
      if (path === "/api/upload/context" && method === "POST") {
        const actor = await credential(req, "upload");
        const input = z
          .object({ project: projectNameSchema, name: nameSchema })
          .strict()
          .parse(await body(req));
        return await transaction(pool, async (client) => {
          const p = await project(client, actor.accountId, input.project);
          const owner = (
            await client.query<Account>(
              "SELECT * FROM keyman_mvp.accounts WHERE id=$1",
              [actor.accountId],
            )
          ).rows[0]!;
          const existing = (
            await client.query<{ revision: number }>(
              "SELECT revision FROM keyman_mvp.secrets WHERE project_id=$1 AND name=$2",
              [p.id, input.name],
            )
          ).rows[0];
          return Response.json({
            vault: vault(owner),
            project: p,
            revision: existing?.revision ?? 0,
          });
        });
      }
      if (path === "/api/upload" && method === "POST") {
        const actor = await credential(req, "upload");
        return await upload(req, actor.accountId);
      }
      if (
        (path === "/api/v1/secret" ||
          path === "/api/v1/search" ||
          path === "/api/v1/exists") &&
        method === "GET"
      ) {
        const actor = await credential(req, "read");
        const projectName = projectNameSchema.parse(
          url.searchParams.get("project"),
        );
        return await transaction(pool, async (client) => {
          const p = await project(
            client,
            actor.accountId,
            projectName,
            actor.projectId,
          );
          if (path.endsWith("/exists")) {
            const name = nameSchema.parse(url.searchParams.get("name"));
            const result = await client.query(
              "SELECT 1 FROM keyman_mvp.secrets WHERE project_id=$1 AND name=$2",
              [p.id, name],
            );
            return Response.json({ exists: result.rowCount === 1 });
          }
          if (path.endsWith("/search")) {
            const q = z
                .string()
                .max(256)
                .parse(url.searchParams.get("q") ?? ""),
              after = z
                .string()
                .max(256)
                .parse(url.searchParams.get("after") ?? "");
            const rows = (
              await client.query<{ name: string; revision: number }>(
                "SELECT name,revision FROM keyman_mvp.secrets WHERE project_id=$1 AND name>$2 AND strpos(name,$3)>0 ORDER BY name LIMIT 51",
                [p.id, after, q],
              )
            ).rows;
            return Response.json({
              items: rows.slice(0, 50),
              nextCursor: rows.length > 50 ? rows[49]!.name : null,
            });
          }
          const name = nameSchema.parse(url.searchParams.get("name"));
          const row = (
            await client.query<{ revision: number; envelope: unknown }>(
              "SELECT revision,envelope FROM keyman_mvp.secrets WHERE project_id=$1 AND name=$2",
              [p.id, name],
            )
          ).rows[0];
          if (!row) throw new ApiError("NOT_FOUND", 404);
          const owner = (
            await client.query<Account>(
              "SELECT * FROM keyman_mvp.accounts WHERE id=$1",
              [actor.accountId],
            )
          ).rows[0]!;
          return Response.json({
            context: {
              version: 1,
              accountId: actor.accountId,
              vaultId: owner.vault_id,
              projectId: p.id,
              project: p.name,
              name,
              revision: row.revision,
            },
            envelope: envelopeSchema.parse(row.envelope),
          });
        });
      }
      if (path.startsWith("/api/console")) {
        const user = await human(req, method !== "GET");
        await transaction(pool, (c) => limit(c, "human:" + user.id));
        if (path === "/api/console/state" && method === "GET") {
          return await transaction(pool, async (client) => {
            const owner = (
              await client.query<Account>(
                "SELECT * FROM keyman_mvp.accounts WHERE clerk_id=$1",
                [user.id],
              )
            ).rows[0];
            if (!owner)
              return Response.json({
                vault: null,
                projects: [],
                entries: [],
                credentials: [],
              });
            identify({ accountId: owner.id });
            const projects = (
              await client.query(
                "SELECT id,name FROM keyman_mvp.projects WHERE account_id=$1 ORDER BY name",
                [owner.id],
              )
            ).rows;
            const entries = (
              await client.query(
                "SELECT project_id,name,revision FROM keyman_mvp.secrets WHERE account_id=$1 ORDER BY name LIMIT 1001",
                [owner.id],
              )
            ).rows;
            const credentials = (
              await client.query(
                "SELECT id,label,kind,project_id,expires_at,revoked FROM keyman_mvp.credentials WHERE account_id=$1 ORDER BY expires_at DESC LIMIT 100",
                [owner.id],
              )
            ).rows;
            return Response.json({
              vault: vault(owner),
              projects,
              entries: entries.slice(0, 1000),
              truncated: entries.length > 1000,
              credentials,
            });
          });
        }
        const owner = await transaction(pool, (c) => account(c, user));
        if (path === "/api/console/activity" && method === "GET") {
          const before = z
            .string()
            .regex(/^[1-9][0-9]{0,18}$/)
            .refine((value) => BigInt(value) <= 9223372036854775807n)
            .optional()
            .parse(url.searchParams.get("before") ?? undefined);
          const action = actionSchema
            .optional()
            .parse(url.searchParams.get("action") ?? undefined);
          const outcome = z
            .enum(["success", "denied", "error"])
            .optional()
            .parse(url.searchParams.get("outcome") ?? undefined);
          const rows = (
            await pool.query(
              "SELECT sequence::text,event_id,request_id,occurred_at,action,outcome,reason,credential_id,resource_id FROM keyman_mvp.audit_events WHERE (account_id=$1 OR (account_id IS NULL AND actor_id=$2)) AND ($3::bigint IS NULL OR sequence<$3) AND ($4::text IS NULL OR action=$4) AND ($5::text IS NULL OR outcome=$5) ORDER BY keyman_mvp.audit_events.sequence DESC LIMIT 51",
              [
                owner.id,
                user.id,
                before ?? null,
                action ?? null,
                outcome ?? null,
              ],
            )
          ).rows;
          return Response.json({
            items: rows.slice(0, 50),
            nextCursor: rows.length > 50 ? rows[49]!.sequence : null,
          });
        }
        if (path === "/api/console/projects" && method === "POST") {
          const input = z
            .object({ name: projectNameSchema })
            .strict()
            .parse(await body(req));
          const id = randomUUID();
          identify({ resourceId: id });
          try {
            await mutation(
              "INSERT INTO keyman_mvp.projects(id,account_id,name) VALUES($1,$2,$3)",
              [id, owner.id, input.name],
            );
          } catch (e) {
            if ((e as { code?: string }).code === "23505")
              throw new ApiError("CONFLICT", 409);
            throw e;
          }
          return Response.json({ id, name: input.name }, { status: 201 });
        }
        if (path === "/api/console/credentials" && method === "POST") {
          const input = z
            .object({
              label: z.string().trim().min(1).max(80),
              projectId: idSchema.nullable(),
              days: z.number().int().min(1).max(90),
            })
            .strict()
            .parse(await body(req));
          if (
            input.projectId &&
            !(
              await pool.query(
                "SELECT 1 FROM keyman_mvp.projects WHERE id=$1 AND account_id=$2",
                [input.projectId, owner.id],
              )
            ).rowCount
          )
            throw new ApiError("NOT_FOUND", 404);
          const token = "kmr_" + randomBytes(32).toString("base64url"),
            id = randomUUID(),
            expiresAt = time() + input.days * 86400;
          identify({ resourceId: id });
          await mutation(
            "INSERT INTO keyman_mvp.credentials(id,account_id,hash,label,kind,project_id,expires_at) VALUES($1,$2,$3,$4,'read',$5,$6)",
            [
              id,
              owner.id,
              hash(token),
              input.label,
              input.projectId,
              expiresAt,
            ],
          );
          return Response.json({ id, token, expiresAt }, { status: 201 });
        }
        if (path === "/api/console/revoke" && method === "POST") {
          const input = z
            .object({ id: idSchema })
            .strict()
            .parse(await body(req));
          identify({ resourceId: input.id });
          const r = await mutation(
            "UPDATE keyman_mvp.credentials SET revoked=true WHERE id=$1 AND account_id=$2 RETURNING id",
            [input.id, owner.id],
          );
          if (!r.rowCount) throw new ApiError("NOT_FOUND", 404);
          return Response.json({ revoked: true });
        }
        if (path === "/api/console/upload" && method === "POST")
          return await upload(req, owner.id);
        if (path === "/api/console/delete" && method === "POST") {
          const input = z
            .object({
              projectId: idSchema,
              name: nameSchema,
              expectedRevision: z.number().int().positive(),
            })
            .strict()
            .parse(await body(req));
          identify({ resourceId: input.projectId });
          const r = await mutation(
            "DELETE FROM keyman_mvp.secrets WHERE account_id=$1 AND project_id=$2 AND name=$3 AND revision=$4 RETURNING name",
            [owner.id, input.projectId, input.name, input.expectedRevision],
          );
          if (!r.rowCount) throw new ApiError("CONFLICT", 409);
          return Response.json({ deleted: true });
        }
      }
      throw new ApiError("NOT_FOUND", 404);
    } catch (error) {
      if (error instanceof RecentRequired)
        return Response.json(
          reverificationError({ level: "first_factor", afterMinutes: 10 }),
          { status: 403 },
        );
      if (error instanceof ApiError) return failure(error.code, error.status);
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return failure("INVALID_REQUEST", 400);
      return failure("UNAVAILABLE", 503);
    }
  }
  return async (request: Request) => {
    const context: AuditContext = {
      requestId: randomUUID(),
      action: actionFor(request.method, new URL(request.url).pathname),
    };
    return auditContext.run(context, async () => {
      let response = await dispatch(request);
      if (
        new URL(request.url).pathname !== "/api/health" &&
        !context.recorded
      ) {
        try {
          if (context.actorId && !context.accountId) {
            const row = (
              await pool.query<{ id: string }>(
                "SELECT id FROM keyman_mvp.accounts WHERE clerk_id=$1",
                [context.actorId],
              )
            ).rows[0];
            context.accountId = row?.id;
          }
          const result = response.ok
            ? undefined
            : await response
                .clone()
                .json()
                .catch(() => undefined);
          const reason = response.ok
            ? "OK"
            : (context.denialReason ??
              result?.error?.code ??
              (response.status === 403
                ? "REVERIFICATION_REQUIRED"
                : "UNAVAILABLE"));
          await recordAudit(
            pool,
            context,
            response.ok
              ? "success"
              : response.status >= 500
                ? "error"
                : "denied",
            reason,
          );
        } catch {
          auditFailure(context.requestId);
          response = failure("UNAVAILABLE", 503);
        }
      }
      response.headers.set("x-request-id", context.requestId);
      response.headers.set("cache-control", "private, no-store");
      response.headers.set("x-content-type-options", "nosniff");
      return response;
    });
  };
  async function upload(req: Request, accountId: string) {
    const input = z
      .object({
        projectId: idSchema,
        name: nameSchema,
        expectedRevision: z.number().int().min(0).max(2147483646),
        envelope: envelopeSchema,
      })
      .strict()
      .parse(await body(req));
    identify({ accountId, resourceId: input.projectId });
    return await transaction(pool, async (client) => {
      const owner = (
        await client.query<Account>(
          "SELECT * FROM keyman_mvp.accounts WHERE id=$1 FOR UPDATE",
          [accountId],
        )
      ).rows[0];
      if (!owner || input.envelope.keyId !== owner.key_id)
        throw new ApiError("KEY_MISMATCH", 409);
      if (
        !(
          await client.query(
            "SELECT 1 FROM keyman_mvp.projects WHERE id=$1 AND account_id=$2",
            [input.projectId, accountId],
          )
        ).rowCount
      )
        throw new ApiError("NOT_FOUND", 404);
      const prior = (
        await client.query<{ revision: number }>(
          "SELECT revision FROM keyman_mvp.secrets WHERE project_id=$1 AND name=$2 FOR UPDATE",
          [input.projectId, input.name],
        )
      ).rows[0];
      if ((prior?.revision ?? 0) !== input.expectedRevision)
        throw new ApiError("CONFLICT", 409);
      const revision = input.expectedRevision + 1;
      await client.query(
        "INSERT INTO keyman_mvp.secrets(account_id,project_id,name,revision,envelope) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,name) DO UPDATE SET revision=EXCLUDED.revision,envelope=EXCLUDED.envelope",
        [accountId, input.projectId, input.name, revision, input.envelope],
      );
      return Response.json({ name: input.name, revision });
    });
  }
}
