import { randomUUID, timingSafeEqual } from "node:crypto";
import { reverificationError } from "@clerk/shared/authorization-errors";
import type { Pool, PoolClient } from "pg";
import {
  API_PATH,
  PassmanError,
  anchorSchema,
  boxSchema,
  bundleSchema,
  bytes32,
  credentialScopeSchema,
  digest,
  failure,
  id,
  inspectRuntimePackage,
  label,
  parseCredential,
  projectName,
  recordSchema,
  requestProofSchema,
  sameAnchor,
  verifyObject,
  verifyRecord,
  z,
  type Anchor,
  type ErrorCode,
  type VaultBundle,
} from "@passman/protocol";
import { transaction } from "../database";
import {
  actionSchema,
  auditFailure,
  recordAudit,
  type AuditContext,
} from "../audit";
import type { Human } from "../auth";
import { writerReplacementRoute } from "./writer-replacement";
import { loginRoute, nativeManagement } from "./login";

type Vault = {
  account_id: string;
  human_id: string;
  vault_id: string;
  epoch: number;
  generation: number;
  bundle: VaultBundle;
};
const operation = z.enum([
  "write",
  "delete",
  "transfer",
  "credentials",
  "vault",
  "projects",
]);
const scopeSchema = credentialScopeSchema
  .extend({ operations: z.array(operation).max(6).optional() })
  .strict();
type Scope = z.infer<typeof scopeSchema>;
type Credential = {
  id: string;
  account_id: string;
  hash: string;
  kind: "read" | "admin";
  scope: Scope;
  expires_at: string | null;
  revoked: boolean;
};
type Actor = { vault: Vault; credential?: Credential; human?: Human };
class RecentVerificationRequired extends PassmanError {
  constructor() {
    super("FORBIDDEN");
  }
}
const statusCodes: Partial<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CREDENTIAL_EXPIRED: 401,
  CREDENTIAL_REVOKED: 401,
  CONFLICT: 409,
  VAULT_ALREADY_EXISTS: 409,
  TRANSFER_CLAIMED: 409,
  TRANSFER_EXPIRED: 410,
  CONTEXT_MISMATCH: 409,
  SIGNATURE_INVALID: 422,
  INTEGRITY_FAILED: 422,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
};
const response = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function actionFor(path: string, method: string): AuditContext["action"] {
  if (path.startsWith("/writer-replacement")) {
    const action = path.split("/")[3] ?? "begin";
    const names = {
      begin: "fresh.writer.begin",
      scan: "fresh.writer.scan",
      stage: "fresh.writer.stage",
      commit: "fresh.writer.commit",
      cancel: "fresh.writer.cancel",
    } as const;
    return names[action as keyof typeof names] ?? "fresh.writer.begin";
  }
  if (path === "/transfers") return "fresh.transfer.create";
  if (path.endsWith("/claim")) return "fresh.transfer.claim";
  if (path.endsWith("/ack")) return "fresh.transfer.ack";
  if (path.endsWith("/cancel")) return "fresh.transfer.cancel";
  if (path.endsWith("/installations"))
    return method === "GET" ? "fresh.inventory.list" : "fresh.inventory.report";
  if (path.endsWith("/pending")) return "fresh.pending.create";
  if (path.endsWith("/service-keys") || path === "/credentials")
    return "fresh.credential.issue";
  if (path.endsWith("/credentials")) return "fresh.credential.list";
  if (path.endsWith("/revoke")) return "fresh.credential.revoke";
  if (path.endsWith("/enroll")) return "fresh.admin.enroll";
  if (path.endsWith("/secrets"))
    return method === "GET" ? "fresh.secret.list" : "fresh.secret.create";
  if (path.includes("/secrets/")) return "fresh.secret.retrieve";
  if (path.endsWith("/projects"))
    return method === "GET" ? "fresh.project.list" : "fresh.project.create";
  if (path === "/keyring") return "fresh.vault.keyring";
  if (path.endsWith("/bootstrap")) return "fresh.vault.bootstrap";
  if (path === "/administration") return "fresh.vault.restore";
  if (path.startsWith("/transfers")) return "fresh.transfer";
  if (path.includes("installations")) return "fresh.inventory";
  if (path.includes("pending")) return "fresh.pending";
  if (
    path.includes("credentials") ||
    path.includes("service-keys") ||
    path.includes("enroll")
  )
    return "fresh.credential";
  if (path.includes("secrets")) return "fresh.secret";
  if (path.includes("projects")) return "fresh.project";
  if (path === "/initialize") return "fresh.initialize";
  if (path === "/account") return "fresh.account";
  if (path === "/console/activity") return "fresh.activity";
  if (["/vault", "/keyring", "/bootstrap", "/administration"].includes(path))
    return "fresh.vault";
  return "fresh.status";
}
async function readBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_800_000) {
        await reader.cancel();
        failure("INVALID_REQUEST");
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } finally {
    reader.releaseLock();
  }
}
export function createFreshApi(config: {
  pool: Pool;
  origin: string;
  authenticate: (request: Request) => Promise<Human>;
}) {
  const origin = anchorSchema.shape.origin.parse(config.origin);
  async function human(
    request: Request,
    context: AuditContext,
    client: PoolClient,
  ): Promise<Human> {
    try {
      const authorization = request.headers.get("authorization");
      if (!authorization?.startsWith("Bearer ")) failure("UNAUTHORIZED");
      const token = authorization.slice(7);
      const h = token?.startsWith("pmm1.")
        ? await nativeManagement(client, token)
        : await config.authenticate(request);
      context.actorId = h.id;
      if (!h.recent) throw new RecentVerificationRequired();
      return h;
    } catch (e) {
      if (e instanceof PassmanError) throw e;
      return failure("UNAUTHORIZED");
    }
  }
  async function byHuman(
    c: PoolClient,
    request: Request,
    context: AuditContext,
  ): Promise<Actor> {
    const h = await human(request, context, c);
    const v = (
      await c.query<Vault>(
        `SELECT * FROM passman_v1.vaults WHERE human_id=$1 FOR ${request.method === "GET" ? "SHARE" : "UPDATE"}`,
        [h.id],
      )
    ).rows[0];
    if (!v) return failure("NOT_FOUND");
    v.bundle = bundleSchema.parse(v.bundle);
    context.accountId = v.account_id;
    return { human: h, vault: v };
  }
  async function byCredential(
    c: PoolClient,
    request: Request,
    context: AuditContext,
  ): Promise<Actor> {
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return failure("UNAUTHORIZED");
    const token = header.slice(7),
      parsed = parseCredential(token);
    const candidate = (
      await c.query<Credential>(
        "SELECT * FROM passman_v1.credentials WHERE id=$1 AND account_id=$2",
        [parsed.id, parsed.accountId],
      )
    ).rows[0];
    if (
      !candidate ||
      !safeEqual(candidate.hash, await digest(token)) ||
      candidate.kind !== parsed.kind
    )
      return failure("UNAUTHORIZED");
    // One lock order for reads, revocations and vault replacements: vault, then credential.
    const vault = (
      await c.query<Vault>(
        `SELECT * FROM passman_v1.vaults WHERE account_id=$1 FOR ${request.method === "GET" ? "SHARE" : "UPDATE"}`,
        [candidate.account_id],
      )
    ).rows[0];
    if (!vault) return failure("UNAUTHORIZED");
    const credential = (
      await c.query<Credential>(
        "SELECT * FROM passman_v1.credentials WHERE id=$1 AND account_id=$2 FOR SHARE",
        [parsed.id, parsed.accountId],
      )
    ).rows[0]!;
    context.accountId = credential.account_id;
    context.credentialId = credential.id;
    credential.scope = scopeSchema.parse(credential.scope);
    if (credential.revoked) return failure("CREDENTIAL_REVOKED");
    if (credential.expires_at && Number(credential.expires_at) <= Date.now())
      return failure("CREDENTIAL_EXPIRED");
    vault.bundle = bundleSchema.parse(vault.bundle);
    return { vault, credential };
  }
  function permitted(actor: Actor, projectId: string) {
    const scope = actor.credential?.scope.projects;
    if (scope && !scope.includes(projectId)) failure("FORBIDDEN");
  }
  async function project(c: PoolClient, actor: Actor, name: string) {
    projectName.parse(name);
    const p = (
      await c.query<{ id: string; name: string; account_id: string }>(
        "SELECT id,name,account_id FROM passman_v1.projects WHERE account_id=$1 AND name=$2",
        [actor.vault.account_id, name],
      )
    ).rows[0];
    if (!p)
      return failure(
        actor.credential?.scope.projects ? "FORBIDDEN" : "NOT_FOUND",
      );
    permitted(actor, p.id);
    return p;
  }
  async function proof(
    c: PoolClient,
    request: Request,
    raw: string,
    actor: Actor,
    required: z.infer<typeof operation>,
    management = false,
  ) {
    if (
      !management &&
      (actor.credential?.kind !== "admin" ||
        !actor.credential.scope.operations?.includes(required))
    )
      failure("FORBIDDEN");
    const signed = request.headers.get("x-passman-proof");
    if (!signed) return failure("FORBIDDEN");
    const p = requestProofSchema.parse(
      await verifyObject(
        signed,
        actor.vault.bundle.anchor.writer,
        "passman-adminreq+jws",
      ),
    );
    const u = new URL(request.url),
      now = Math.floor(Date.now() / 1000);
    const expectedCredential = management
      ? `management:${await digest(JSON.stringify(["passman/management", actor.human!.id]))}`
      : actor.credential!.id;
    if (
      p.origin !== origin ||
      p.accountId !== actor.vault.account_id ||
      p.vaultId !== actor.vault.vault_id ||
      p.credential !== expectedCredential ||
      p.method !== request.method ||
      p.target !== u.pathname ||
      p.bodyHash !== (await digest(raw)) ||
      u.search ||
      p.expiresAt <= now ||
      p.issuedAt > now + 5 ||
      p.issuedAt < now - 60 ||
      p.expiresAt - p.issuedAt > 60 ||
      p.expiresAt <= p.issuedAt
    )
      failure("FORBIDDEN");
    if (management) {
      const inserted = await c.query(
        "INSERT INTO passman_v1.management_nonces(account_id,nonce,expires_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING nonce",
        [actor.vault.account_id, p.nonce, p.expiresAt],
      );
      if (!inserted.rowCount) failure("CONFLICT");
    } else {
      const inserted = await c.query(
        "INSERT INTO passman_v1.nonces(credential_id,nonce,expires_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING nonce",
        [actor.credential!.id, p.nonce, p.expiresAt],
      );
      if (!inserted.rowCount) failure("CONFLICT");
    }
  }
  async function validateBundle(bundle: VaultBundle, anchor?: Anchor) {
    if (
      bundle.anchor.origin !== origin ||
      (anchor && !sameAnchor(bundle.anchor, anchor))
    )
      failure("CONTEXT_MISMATCH");
    const p = await inspectRuntimePackage(bundle.keyring, bundle.anchor);
    if (
      p.epoch !== bundle.epoch ||
      p.generation !== bundle.generation ||
      p.syncId !== bundle.syncId ||
      JSON.stringify(p.activeKey) !== JSON.stringify(bundle.activeKey)
    )
      failure("CONTEXT_MISMATCH");
    for (const [purpose, wrap] of [
      ["bootstrap", bundle.bootstrap],
      ["administration", bundle.administration],
    ] as const) {
      if (
        wrap.purpose !== purpose ||
        !sameAnchor(wrap.anchor, bundle.anchor) ||
        wrap.epoch !== bundle.epoch ||
        wrap.syncId !== bundle.syncId
      )
        failure("CONTEXT_MISMATCH");
    }
  }
  async function issue(c: PoolClient, actor: Actor, input: unknown) {
    const d = z
      .object({
        id,
        hash: bytes32,
        kind: z.enum(["read", "admin"]),
        scope: scopeSchema,
      })
      .strict()
      .parse(input);
    if (
      d.kind === "admin" &&
      (!d.scope.expiresAt || !d.scope.operations?.length || d.scope.bootstrap)
    )
      failure("INVALID_REQUEST");
    if (d.kind === "admin" && d.scope.expiresAt! > Date.now() + 90 * 86400_000)
      failure("INVALID_REQUEST");
    if (d.kind === "read" && d.scope.operations?.length)
      failure("INVALID_REQUEST");
    if (d.scope.expiresAt && d.scope.expiresAt <= Date.now())
      failure("INVALID_REQUEST");
    for (const p of d.scope.projects ?? []) {
      permitted(actor, p);
      if (
        !(
          await c.query(
            "SELECT 1 FROM passman_v1.projects WHERE id=$1 AND account_id=$2",
            [p, actor.vault.account_id],
          )
        ).rowCount
      )
        failure("FORBIDDEN");
    }
    const parent = actor.credential;
    if (parent) {
      if (
        parent.scope.projects &&
        (!d.scope.projects ||
          d.scope.projects.some((p) => !parent.scope.projects!.includes(p)))
      )
        failure("FORBIDDEN");
      const fullAdministrator =
        parent.scope.projects === null &&
        operation.options.every((op) => parent.scope.operations?.includes(op));
      if (
        parent.expires_at &&
        (d.kind === "admin" || !fullAdministrator) &&
        (!d.scope.expiresAt || d.scope.expiresAt > Number(parent.expires_at))
      )
        failure("FORBIDDEN");
      if (
        d.kind === "admin" &&
        d.scope.operations?.some((o) => !parent.scope.operations?.includes(o))
      )
        failure("FORBIDDEN");
      if (d.scope.bootstrap && parent.scope.projects) failure("FORBIDDEN");
    }
    await c.query(
      "INSERT INTO passman_v1.credentials(id,account_id,hash,kind,scope,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        d.id,
        actor.vault.account_id,
        d.hash,
        d.kind,
        d.scope,
        d.scope.expiresAt,
      ],
    );
    return { id: d.id };
  }
  return async (request: Request): Promise<Response> => {
    const u = new URL(request.url),
      path = u.pathname.slice(API_PATH.length);
    const context: AuditContext = {
      requestId: randomUUID(),
      action: actionFor(path, request.method),
    };
    try {
      if (
        u.origin !== origin ||
        !u.pathname.startsWith(API_PATH + "/") ||
        u.search ||
        /%|\/\//.test(path) ||
        request.headers.get("cookie")
      )
        failure("INVALID_REQUEST");
      const browserOrigin = request.headers.get("origin");
      if (browserOrigin && browserOrigin !== origin) failure("FORBIDDEN");
      if (!["GET", "POST"].includes(request.method)) failure("FORBIDDEN");
      // Separate autocommit admission: denials consume quota and no row lock spans crypto/reads.
      const bucket = Math.floor(Date.now() / 60000);
      const limit = (
        await config.pool.query<{ count: number }>(
          "INSERT INTO passman_v1.limits(subject,bucket,count) VALUES('deployment',$1,1) ON CONFLICT(subject,bucket) DO UPDATE SET count=passman_v1.limits.count+1 RETURNING count",
          [bucket],
        )
      ).rows[0]!;
      if (limit.count > 10000) failure("RATE_LIMITED");
      const raw = await readBody(request);
      if (
        (request.method === "GET" && raw) ||
        (raw &&
          !request.headers.get("content-type")?.startsWith("application/json"))
      )
        failure("INVALID_REQUEST");
      const input: unknown = raw ? JSON.parse(raw) : {};
      const data = await transaction(config.pool, async (c) => {
        const method = request.method;
        let result: unknown;
        if (
          ["/auth/start", "/auth/poll", "/console/auth/approve"].includes(path)
        ) {
          if (method !== "POST") failure("FORBIDDEN");
          context.action =
            path === "/auth/start"
              ? "fresh.login.start"
              : path === "/auth/poll"
                ? "fresh.login.poll"
                : "fresh.login.approve";
          let h: Human | undefined;
          if (path === "/console/auth/approve") {
            if (
              request.headers.get("authorization")?.startsWith("Bearer pmm1.")
            )
              failure("FORBIDDEN");
            h = await human(request, context, c);
          }
          result = await loginRoute(c, path, input, h);
        } else if (path === "/account" && method === "GET") {
          const h = await human(request, context, c);
          const row = (
            await c.query<Vault>(
              "SELECT * FROM passman_v1.vaults WHERE human_id=$1",
              [h.id],
            )
          ).rows[0];
          if (row) context.accountId = row.account_id;
          result = {
            operatorId: await digest(
              JSON.stringify(["passman/management", h.id]),
            ),
            account: row
              ? {
                  accountId: row.account_id,
                  vaultId: row.vault_id,
                  anchor: row.bundle.anchor,
                }
              : null,
          };
        } else if (path === "/initialize" && method === "POST") {
          const h = await human(request, context, c);
          const body = z
            .object({
              bundle: bundleSchema,
              credential: z
                .object({
                  id,
                  hash: bytes32,
                  label,
                  expiresAt: z.number().int().positive(),
                })
                .strict(),
            })
            .strict()
            .parse(input);
          await validateBundle(body.bundle);
          if (body.bundle.epoch !== 1 || body.bundle.generation !== 1)
            failure("INVALID_REQUEST");
          const a = body.bundle.anchor;
          const inserted = await c.query(
            "INSERT INTO passman_v1.vaults(account_id,human_id,vault_id,bundle,epoch,generation) VALUES($1,$2,$3,$4,1,1) ON CONFLICT DO NOTHING RETURNING account_id",
            [a.accountId, h.id, a.vaultId, body.bundle],
          );
          if (!inserted.rowCount) {
            const existing = (
              await c.query<Vault>(
                "SELECT * FROM passman_v1.vaults WHERE human_id=$1",
                [h.id],
              )
            ).rows[0];
            const prior = (
              await c.query<Credential>(
                "SELECT * FROM passman_v1.credentials WHERE id=$1 AND account_id=$2",
                [body.credential.id, a.accountId],
              )
            ).rows[0];
            if (
              !existing ||
              !prior ||
              prior.revoked ||
              !safeEqual(prior.hash, body.credential.hash) ||
              JSON.stringify(bundleSchema.parse(existing.bundle)) !==
                JSON.stringify(body.bundle)
            )
              failure("VAULT_ALREADY_EXISTS");
            context.accountId = a.accountId;
            await recordAudit(
              c,
              context,
              "success",
              "OK",
              undefined,
              "passman_v1",
            );
            return { id: body.credential.id };
          }
          context.accountId = a.accountId;
          const actor: Actor = {
            human: h,
            vault: {
              account_id: a.accountId,
              human_id: h.id,
              vault_id: a.vaultId,
              bundle: body.bundle,
              epoch: 1,
              generation: 1,
            },
          };
          result = await issue(c, actor, {
            id: body.credential.id,
            hash: body.credential.hash,
            kind: "admin",
            scope: {
              projects: null,
              expiresAt: body.credential.expiresAt,
              bootstrap: false,
              label: body.credential.label,
              operations: operation.options,
            },
          });
        } else {
          const isHuman =
            path.startsWith("/console/") ||
            path === "/administration" ||
            path === "/admin/enroll";
          const actor = isHuman
            ? await byHuman(c, request, context)
            : await byCredential(c, request, context);
          const { vault, credential } = actor;
          const publicStatus = {
            anchor: vault.bundle.anchor,
            epoch: vault.epoch,
            generation: vault.generation,
            syncId: vault.bundle.syncId,
            activeKey: vault.bundle.activeKey,
          };
          if (
            ["/status", "/console/status"].includes(path) &&
            method === "GET"
          ) {
            result = {
              ...publicStatus,
              ...(credential
                ? {
                    credential: {
                      id: credential.id,
                      projects: credential.scope.projects,
                      expiresAt: credential.expires_at
                        ? Number(credential.expires_at)
                        : null,
                      bootstrap: credential.scope.bootstrap,
                    },
                  }
                : {}),
            };
          } else if (path === "/keyring" && method === "GET") {
            result = { keyring: vault.bundle.keyring };
          } else if (
            ["/bootstrap", "/console/bootstrap"].includes(path) &&
            method === "GET"
          ) {
            if (!isHuman && !credential?.scope.bootstrap) failure("FORBIDDEN");
            const { administration: _private, ...bootstrap } = vault.bundle;
            void _private;
            result = bootstrap;
          } else if (path === "/administration" && method === "GET") {
            result = vault.bundle;
          } else if (path === "/admin/enroll" && method === "POST") {
            await proof(c, request, raw, actor, "credentials", true);
            const d = z
              .object({
                id,
                hash: bytes32,
                label,
                expiresAt: z.number().int().positive(),
              })
              .strict()
              .parse(input);
            context.resourceId = d.id;
            result = await issue(c, actor, {
              id: d.id,
              hash: d.hash,
              kind: "admin",
              scope: {
                projects: null,
                expiresAt: d.expiresAt,
                bootstrap: false,
                label: d.label,
                operations: operation.options,
              },
            });
          } else if (path.startsWith("/writer-replacement")) {
            if (
              method !== "POST" ||
              credential?.scope.projects ||
              operation.options.some(
                (op) => !credential?.scope.operations?.includes(op),
              )
            )
              failure("FORBIDDEN");
            await proof(c, request, raw, actor, "vault");
            const token = request.headers.get("x-passman-management");
            if (!token) failure("FORBIDDEN");
            const h = await human(
              new Request(request.url, {
                headers: { authorization: `Bearer ${token}` },
              }),
              context,
              c,
            );
            if (h.id !== vault.human_id) failure("FORBIDDEN");
            const route = path.split("/")[3] ?? "begin";
            const actions = {
              begin: "fresh.writer.begin",
              scan: "fresh.writer.scan",
              stage: "fresh.writer.stage",
              commit: "fresh.writer.commit",
              cancel: "fresh.writer.cancel",
            } as const;
            context.action =
              actions[route as keyof typeof actions] ?? "fresh.writer.begin";
            context.resourceId = id.safeParse(path.split("/")[2]).success
              ? path.split("/")[2]
              : vault.vault_id;
            result = await writerReplacementRoute(c, path, input, {
              vault,
              issueAdmin: async (d) =>
                issue(
                  c,
                  { vault, human: h },
                  {
                    id: d.id,
                    hash: d.hash,
                    kind: "admin",
                    scope: {
                      projects: null,
                      expiresAt: d.expiresAt,
                      bootstrap: false,
                      label: d.label,
                      operations: operation.options,
                    },
                  },
                ),
              auditRevocation: async (credentialId) =>
                recordAudit(
                  c,
                  {
                    ...context,
                    action: "fresh.credential.revoke",
                    resourceId: credentialId,
                  },
                  "success",
                  "OK",
                  undefined,
                  "passman_v1",
                ),
            });
            if (path.endsWith("/commit")) {
              await c.query(
                "UPDATE passman_v1.native_logins SET expires_at=$2 WHERE human_id=$1",
                [vault.human_id, Date.now()],
              );
              await c.query(
                "DELETE FROM passman_v1.native_management WHERE human_id=$1",
                [vault.human_id],
              );
            }
          } else if (["/projects", "/console/projects"].includes(path)) {
            if (method === "GET") {
              const projects = (
                await c.query(
                  'SELECT p.id,p.name,p.created_at AS "createdAt",count(s.name) FILTER(WHERE s.state=\'active\')::integer AS "secretCount" FROM passman_v1.projects p LEFT JOIN passman_v1.slots s ON s.project_id=p.id WHERE p.account_id=$1 AND ($2::uuid[] IS NULL OR p.id=ANY($2)) GROUP BY p.id ORDER BY p.name COLLATE "C" LIMIT 1000',
                  [vault.account_id, credential?.scope.projects ?? null],
                )
              ).rows;
              result = { projects };
            } else {
              if (!isHuman) {
                await proof(c, request, raw, actor, "projects");
                if (credential?.scope.projects) failure("FORBIDDEN");
              }
              const { name } = z
                  .object({ name: projectName })
                  .strict()
                  .parse(input),
                projectId = randomUUID();
              context.resourceId = projectId;
              await c.query(
                "INSERT INTO passman_v1.projects(id,account_id,name) VALUES($1,$2,$3)",
                [projectId, vault.account_id, name],
              );
              result = { id: projectId, name };
            }
          } else if (path === "/console/pending" && method === "POST") {
            const d = z
                .object({ record: recordSchema, receiptId: id })
                .strict()
                .parse(input),
              r = d.record,
              ctx = r.context;
            context.resourceId = ctx.secretId;
            const p = await project(c, actor, ctx.project);
            if (
              ctx.origin !== origin ||
              ctx.accountId !== vault.account_id ||
              ctx.vaultId !== vault.vault_id ||
              ctx.projectId !== p.id ||
              ctx.revision !== 1 ||
              ctx.state !== "pending" ||
              r.signature
            )
              failure("CONTEXT_MISMATCH");
            const bodyHash = await digest(raw),
              receipt = (
                await c.query<{ body_hash: string; response: unknown }>(
                  "SELECT body_hash,response FROM passman_v1.receipts WHERE account_id=$1 AND actor=$2 AND operation='pending' AND receipt_id=$3",
                  [vault.account_id, actor.human!.id, d.receiptId],
                )
              ).rows[0];
            if (receipt) {
              if (receipt.body_hash !== bodyHash) failure("CONFLICT");
              result = receipt.response;
            } else {
              if (
                ctx.epoch !== vault.epoch ||
                ctx.keyId !== vault.bundle.activeKey.id
              )
                failure("CONTEXT_MISMATCH");
              const count = (
                await c.query<{ count: string }>(
                  "SELECT count(*) FROM passman_v1.slots WHERE account_id=$1 AND state='pending'",
                  [vault.account_id],
                )
              ).rows[0]!;
              if (Number(count.count) >= 500) failure("RATE_LIMITED");
              await c.query(
                "INSERT INTO passman_v1.slots(account_id,project_id,name,secret_id,revision,state,record) VALUES($1,$2,$3,$4,1,'pending',$5)",
                [vault.account_id, p.id, ctx.name, ctx.secretId, r],
              );
              result = { id: ctx.secretId, state: "pending" };
              await c.query(
                "INSERT INTO passman_v1.receipts(account_id,actor,operation,receipt_id,body_hash,response) VALUES($1,$2,'pending',$3,$4,$5)",
                [
                  vault.account_id,
                  actor.human!.id,
                  d.receiptId,
                  bodyHash,
                  result,
                ],
              );
            }
          } else if (path === "/console/service-keys" && method === "POST") {
            const scope = credentialScopeSchema.parse(input),
              credentialId = randomUUID();
            context.resourceId = credentialId;
            // Use 256 random bits and canonical base64url, never a password or UUID as the bearer secret.
            const secret = new Uint8Array(32);
            crypto.getRandomValues(secret);
            const bearer = `pmr1.${vault.account_id}.${credentialId}.${Buffer.from(secret).toString("base64url")}`;
            secret.fill(0);
            await issue(c, actor, {
              id: credentialId,
              hash: await digest(bearer),
              kind: "read",
              scope,
            });
            result = { serviceKey: bearer, id: credentialId };
          } else if (path === "/credentials" && method === "POST") {
            await proof(c, request, raw, actor, "credentials");
            result = await issue(c, actor, input);
            context.resourceId = (result as { id: string }).id;
          } else if (
            /^\/credentials\/[0-9a-f-]{36}\/revoke$/.test(path) &&
            method === "POST"
          ) {
            await proof(c, request, raw, actor, "credentials");
            const credentialId = id.parse(path.split("/")[2]);
            context.resourceId = credentialId;
            if (credential?.scope.projects) failure("FORBIDDEN");
            const changed = await c.query(
              "UPDATE passman_v1.credentials SET revoked=true WHERE account_id=$1 AND id=$2 RETURNING id",
              [vault.account_id, credentialId],
            );
            if (!changed.rowCount) failure("NOT_FOUND");
            result = { revoked: true };
          } else if (
            /^\/console\/credentials\/[0-9a-f-]{36}\/revoke$/.test(path) &&
            method === "POST"
          ) {
            const credentialId = id.parse(path.split("/")[3]);
            context.resourceId = credentialId;
            const revoked = await c.query(
              "UPDATE passman_v1.credentials SET revoked=true WHERE account_id=$1 AND id=$2 RETURNING id",
              [vault.account_id, credentialId],
            );
            if (!revoked.rowCount) failure("FORBIDDEN");
            result = { revoked: true };
          } else if (path === "/console/credentials" && method === "GET") {
            result = {
              credentials: (
                await c.query(
                  'SELECT id,kind,scope,expires_at AS "expiresAt",revoked,created_at AS "createdAt" FROM passman_v1.credentials WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1000',
                  [vault.account_id],
                )
              ).rows,
            };
          } else if (path === "/vault" && method === "POST") {
            await proof(c, request, raw, actor, "vault");
            if (credential?.scope.projects) failure("FORBIDDEN");
            const d = z
              .object({
                bundle: bundleSchema,
                expectedGeneration: z.number().int().positive(),
              })
              .strict()
              .parse(input);
            const epochChanged = d.bundle.epoch !== vault.epoch;
            if (
              d.bundle.anchor.accountId !== vault.account_id ||
              d.bundle.anchor.vaultId !== vault.vault_id
            )
              failure("CONTEXT_MISMATCH");
            await validateBundle(d.bundle, vault.bundle.anchor);
            if (
              d.expectedGeneration !== vault.generation ||
              d.bundle.generation !== vault.generation + 1 ||
              (epochChanged
                ? d.bundle.epoch !== vault.epoch + 1 ||
                  d.bundle.syncId === vault.bundle.syncId ||
                  d.bundle.activeKey.id === vault.bundle.activeKey.id ||
                  d.bundle.activeKey.version !==
                    vault.bundle.activeKey.version + 1
                : d.bundle.syncId !== vault.bundle.syncId)
            )
              failure("CONFLICT");
            const wrappersChanged =
              JSON.stringify(d.bundle.bootstrap) !==
                JSON.stringify(vault.bundle.bootstrap) ||
              JSON.stringify(d.bundle.administration) !==
                JSON.stringify(vault.bundle.administration);
            context.action = epochChanged
              ? "fresh.vault.replace"
              : wrappersChanged
                ? "fresh.vault.password"
                : "fresh.vault.rotate";
            context.resourceId = vault.vault_id;
            if (wrappersChanged || epochChanged) {
              const management = request.headers.get("x-passman-management");
              if (!management) failure("FORBIDDEN");
              const h = await human(
                new Request(request.url, {
                  headers: { authorization: `Bearer ${management}` },
                }),
                context,
                c,
              );
              if (
                h.id !== vault.human_id ||
                d.bundle.bootstrap.revision !==
                  vault.bundle.bootstrap.revision + 1 ||
                d.bundle.administration.revision !==
                  vault.bundle.administration.revision + 1
              )
                failure("FORBIDDEN");
            }
            if (epochChanged) {
              await c.query(
                "UPDATE passman_v1.transfers SET state='cancelled',payload=NULL WHERE account_id=$1 AND epoch<$2 AND state IN('open','claimed')",
                [vault.account_id, d.bundle.epoch],
              );
              const revoked = await c.query<{ id: string }>(
                "UPDATE passman_v1.credentials SET revoked=true WHERE account_id=$1 AND id<>$2 AND revoked=false RETURNING id",
                [vault.account_id, credential!.id],
              );
              for (const row of revoked.rows)
                await recordAudit(
                  c,
                  {
                    ...context,
                    action: "fresh.credential.revoke",
                    resourceId: row.id,
                  },
                  "success",
                  "OK",
                  undefined,
                  "passman_v1",
                );
            }
            await c.query(
              "UPDATE passman_v1.vaults SET bundle=$2,generation=$3,epoch=$4 WHERE account_id=$1",
              [vault.account_id, d.bundle, d.bundle.generation, d.bundle.epoch],
            );
            result = { generation: d.bundle.generation };
          } else if (path === "/installations" && method === "POST") {
            const d = z
              .object({
                id,
                label,
                kind: z.enum(["desktop", "server", "container", "function"]),
              })
              .strict()
              .parse(input);
            context.resourceId = d.id;
            const count = (
              await c.query<{ count: string }>(
                "SELECT count(*) FROM passman_v1.installations WHERE account_id=$1",
                [vault.account_id],
              )
            ).rows[0]!;
            if (
              Number(count.count) >= 1000 &&
              !(
                await c.query(
                  "SELECT 1 FROM passman_v1.installations WHERE account_id=$1 AND id=$2",
                  [vault.account_id, d.id],
                )
              ).rowCount
            )
              failure("RATE_LIMITED");
            await c.query(
              "INSERT INTO passman_v1.installations(id,account_id,label,kind,credential_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,id) DO UPDATE SET last_seen=now() WHERE passman_v1.installations.last_seen < now()-interval '2 minutes'",
              [d.id, vault.account_id, d.label, d.kind, credential!.id],
            );
            result = { registered: true };
          } else if (path === "/console/installations" && method === "GET") {
            result = {
              installations: (
                await c.query(
                  "SELECT id,label,kind,first_seen AS \"firstSeen\",last_seen AS \"lastSeen\",CASE WHEN last_seen > now()-interval '24 hours' THEN 'active' ELSE 'inactive' END AS status FROM passman_v1.installations WHERE account_id=$1 ORDER BY last_seen DESC LIMIT 1000",
                  [vault.account_id],
                )
              ).rows,
            };
          } else if (path === "/console/activity") {
            const d = z
              .object({
                before: z
                  .string()
                  .regex(/^[1-9][0-9]{0,18}$/)
                  .optional(),
                action: actionSchema.optional(),
                outcome: z.enum(["success", "denied", "error"]).optional(),
                limit: z.number().int().min(1).max(100).default(50),
              })
              .strict()
              .parse(input);
            const rows = (
              await c.query<{ sequence: string }>(
                "SELECT sequence,event_id,occurred_at,credential_id,resource_id,action,outcome,reason FROM passman_v1.audit_events WHERE account_id=$1 AND ($2::bigint IS NULL OR sequence < $2) AND ($3::text IS NULL OR action=$3) AND ($4::text IS NULL OR outcome=$4) ORDER BY sequence DESC LIMIT $5",
                [
                  vault.account_id,
                  d.before ?? null,
                  d.action ?? null,
                  d.outcome ?? null,
                  d.limit + 1,
                ],
              )
            ).rows;
            result = {
              events: rows.slice(0, d.limit),
              nextCursor:
                rows.length > d.limit ? rows[d.limit - 1]!.sequence : null,
            };
          } else if (path.startsWith("/transfers")) {
            const transferId = path.split("/")[2];
            if (id.safeParse(transferId).success)
              context.resourceId = transferId;
            if (path === "/transfers" || path.endsWith("/cancel")) {
              const token = request.headers.get("x-passman-management");
              if (!token) failure("FORBIDDEN");
              const h = await human(
                new Request(request.url, {
                  headers: { authorization: `Bearer ${token}` },
                }),
                context,
                c,
              );
              if (h.id !== vault.human_id) failure("FORBIDDEN");
            }
            result = await transferRoute(
              c,
              request,
              raw,
              input,
              actor,
              path,
              proof,
            );
          } else {
            const match = /^\/projects\/([^/]+)\/secrets(?:\/([^/]+))?$/.exec(
              path,
            );
            if (!match) failure("NOT_FOUND");
            const p = await project(c, actor, match[1]!);
            if (!match[2] && method === "GET") {
              result = {
                secrets: (
                  await c.query(
                    "SELECT name,state,revision,record->'context'->>'keyId' AS \"keyId\" FROM passman_v1.slots WHERE project_id=$1 ORDER BY name COLLATE \"C\" LIMIT 1000",
                    [p.id],
                  )
                ).rows,
              };
            } else if (match[2] && method === "GET") {
              const slot = (
                await c.query<{ record: unknown }>(
                  "SELECT record FROM passman_v1.slots WHERE project_id=$1 AND name=$2",
                  [p.id, match[2]],
                )
              ).rows[0];
              if (!slot) failure("NOT_FOUND");
              result = slot.record;
              context.resourceId = recordSchema.parse(
                slot.record,
              ).context.secretId;
            } else if (!match[2] && method === "POST") {
              const d = z
                  .object({
                    record: recordSchema,
                    expectedRevision: z.number().int().min(0),
                    expectedDigest: bytes32.optional(),
                  })
                  .strict()
                  .parse(input),
                r = d.record,
                ctx = r.context;
              context.resourceId = ctx.secretId;
              await proof(
                c,
                request,
                raw,
                actor,
                ctx.state === "deleted" ? "delete" : "write",
              );
              await verifyRecord(r, vault.bundle.anchor, {
                project: p.name,
                name: ctx.name,
              });
              if (
                ctx.origin !== origin ||
                ctx.projectId !== p.id ||
                ctx.epoch !== vault.epoch ||
                ctx.keyId !== vault.bundle.activeKey.id ||
                ctx.revision !== d.expectedRevision + 1
              )
                failure("CONTEXT_MISMATCH");
              const old = (
                await c.query<{
                  record: unknown;
                  revision: number;
                  state: string;
                  secret_id: string;
                }>(
                  "SELECT * FROM passman_v1.slots WHERE project_id=$1 AND name=$2 FOR UPDATE",
                  [p.id, ctx.name],
                )
              ).rows[0];
              if (
                (!old && d.expectedRevision !== 0) ||
                (old &&
                  (old.revision !== d.expectedRevision ||
                    old.secret_id !== ctx.secretId))
              )
                failure("CONFLICT");
              if (old?.state === "pending") {
                if (
                  !["active", "deleted"].includes(ctx.state) ||
                  !d.expectedDigest ||
                  (await digest(
                    JSON.stringify(recordSchema.parse(old.record)),
                  )) !== d.expectedDigest
                )
                  failure("PENDING_VERIFICATION_REQUIRED");
                const pending = recordSchema.parse(old.record).context;
                if (
                  ctx.state === "active" &&
                  (pending.epoch !== vault.epoch ||
                    pending.keyId !== vault.bundle.activeKey.id)
                )
                  failure("CONFLICT");
              }
              context.action =
                old?.state === "pending"
                  ? ctx.state === "deleted"
                    ? "fresh.secret.reject"
                    : "fresh.secret.activate"
                  : ctx.state === "deleted"
                    ? "fresh.secret.delete"
                    : old
                      ? "fresh.secret.update"
                      : "fresh.secret.create";
              if (!old && ctx.state === "deleted") failure("NOT_FOUND");
              if (old)
                await c.query(
                  "UPDATE passman_v1.slots SET revision=$3,state=$4,record=$5 WHERE project_id=$1 AND name=$2",
                  [p.id, ctx.name, ctx.revision, ctx.state, r],
                );
              else
                await c.query(
                  "INSERT INTO passman_v1.slots(account_id,project_id,name,secret_id,revision,state,record) VALUES($1,$2,$3,$4,$5,$6,$7)",
                  [
                    vault.account_id,
                    p.id,
                    ctx.name,
                    ctx.secretId,
                    ctx.revision,
                    ctx.state,
                    r,
                  ],
                );
              result = { revision: ctx.revision, state: ctx.state };
            } else failure("FORBIDDEN");
          }
        }
        await recordAudit(c, context, "success", "OK", undefined, "passman_v1");
        return result;
      });
      return response(data);
    } catch (e) {
      let code: ErrorCode =
        e instanceof PassmanError
          ? e.code
          : e instanceof z.ZodError || e instanceof SyntaxError
            ? "INVALID_REQUEST"
            : "UNAVAILABLE";
      // SQL conflict codes are structural only; never surface database messages or payloads.
      if (e && typeof e === "object" && "code" in e && e.code === "23505")
        code = "CONFLICT";
      try {
        await recordAudit(
          config.pool,
          context,
          code === "UNAVAILABLE" ? "error" : "denied",
          code,
          undefined,
          "passman_v1",
        );
      } catch {
        auditFailure(context.requestId);
        code = "UNAVAILABLE";
      }
      return response(
        {
          error: { code },
          requestId: context.requestId,
          ...(e instanceof RecentVerificationRequired && code === "FORBIDDEN"
            ? reverificationError({ level: "first_factor", afterMinutes: 10 })
            : {}),
        },
        statusCodes[code] ?? 400,
      );
    }
  };
}

type Proof = (
  c: PoolClient,
  request: Request,
  raw: string,
  actor: Actor,
  required: z.infer<typeof operation>,
) => Promise<void>;
async function transferRoute(
  c: PoolClient,
  request: Request,
  raw: string,
  input: unknown,
  actor: Actor,
  path: string,
  proof: Proof,
): Promise<unknown> {
  const { vault, credential } = actor;
  if (path === "/transfers" && request.method === "POST") {
    await proof(c, request, raw, actor, "transfer");
    // Transfer is account-wide because the decryption and runtime sync key are account-wide.
    if (credential?.scope.projects) failure("FORBIDDEN");
    const d = z
      .object({
        id,
        claimHash: bytes32,
        expiresAt: z.number().int().positive(),
        epoch: z.number().int().positive(),
        expectedGeneration: z.number().int().positive(),
        payload: boxSchema,
      })
      .strict()
      .parse(input);
    if (
      d.epoch !== vault.epoch ||
      d.expiresAt <= Date.now() ||
      d.expiresAt > Date.now() + 600_000
    )
      failure("INVALID_REQUEST");
    if (d.expectedGeneration !== vault.generation) failure("CONFLICT");
    const pending = (
      await c.query<{ count: string }>(
        "SELECT count(*) FROM passman_v1.transfers WHERE account_id=$1 AND expires_at>$2 AND state IN('open','claimed')",
        [vault.account_id, Date.now()],
      )
    ).rows[0]!;
    if (Number(pending.count) >= 100) failure("RATE_LIMITED");
    await c.query(
      "INSERT INTO passman_v1.transfers(id,account_id,epoch,claim_hash,expires_at,payload,state) VALUES($1,$2,$3,$4,$5,$6,'open')",
      [d.id, vault.account_id, d.epoch, d.claimHash, d.expiresAt, d.payload],
    );
    return { id: d.id, expiresAt: d.expiresAt };
  }
  const m = /^\/transfers\/([0-9a-f-]{36})\/(claim|ack|cancel)$/.exec(path);
  if (!m || request.method !== "POST") failure("NOT_FOUND");
  const transferId = id.parse(m[1]);
  type Transfer = {
    epoch: number;
    expires_at: string;
    state: string;
    claim_hash: string;
    session_hash: string | null;
    recipient_id: string | null;
    payload: unknown;
  };
  const t = (
    await c.query<Transfer>(
      "SELECT * FROM passman_v1.transfers WHERE id=$1 AND account_id=$2 FOR UPDATE",
      [transferId, vault.account_id],
    )
  ).rows[0];
  if (!t) failure("NOT_FOUND");
  if (m[2] === "cancel") {
    await proof(c, request, raw, actor, "transfer");
    if (credential?.scope.projects) failure("FORBIDDEN");
    if (!["open", "claimed"].includes(t.state)) failure("CONFLICT");
    await c.query(
      "UPDATE passman_v1.transfers SET state='cancelled',payload=NULL WHERE id=$1",
      [transferId],
    );
    return { cancelled: true };
  }
  if (credential?.kind !== "read") failure("FORBIDDEN");
  const d = z
    .object({ sessionSecret: bytes32, claimSecret: bytes32.optional() })
    .strict()
    .parse(input);
  const sessionHash = await digest(d.sessionSecret);
  if (m[2] === "claim") {
    if (
      Number(t.expires_at) <= Date.now() ||
      t.epoch !== vault.epoch ||
      t.state === "cancelled"
    )
      failure("TRANSFER_EXPIRED");
    if (!d.claimSecret || !safeEqual(t.claim_hash, await digest(d.claimSecret)))
      failure("FORBIDDEN");
    if (t.state === "acknowledged") failure("TRANSFER_CLAIMED");
    if (
      t.state === "claimed" &&
      (t.recipient_id !== credential.id ||
        !t.session_hash ||
        !safeEqual(t.session_hash, sessionHash))
    )
      failure("TRANSFER_CLAIMED");
    if (t.state === "open")
      await c.query(
        "UPDATE passman_v1.transfers SET state='claimed',recipient_id=$2,session_hash=$3 WHERE id=$1",
        [transferId, credential.id, sessionHash],
      );
    return {
      id: transferId,
      epoch: t.epoch,
      expiresAt: Number(t.expires_at),
      payload: t.payload,
    };
  }
  if (
    t.recipient_id !== credential.id ||
    !t.session_hash ||
    !safeEqual(t.session_hash, sessionHash)
  )
    failure("FORBIDDEN");
  if (!["claimed", "acknowledged", "cancelled"].includes(t.state))
    failure("CONFLICT");
  await c.query(
    "UPDATE passman_v1.transfers SET state='acknowledged',payload=NULL WHERE id=$1",
    [transferId],
  );
  return { acknowledged: true };
}
