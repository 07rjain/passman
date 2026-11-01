import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "@keyman-mvp/core";

export const actions = [
  "setup.start",
  "setup.inspect",
  "setup.approve",
  "setup.claim",
  "workspace.list",
  "project.create",
  "credential.create",
  "credential.revoke",
  "secret.write",
  "secret.delete",
  "secret.retrieve",
  "secret.search",
  "secret.exists",
  "upload.context",
  "activity.list",
  "request.unknown",
  "session.created",
  "session.ended",
  "session.removed",
  "session.revoked",
  "operation.deploy",
  "operation.backup",
  "operation.restore",
  "operation.configuration",
  "operation.migrate",
] as const;
export const actionSchema = z.enum(actions);
export type AuditContext = {
  requestId: string;
  action: z.infer<typeof actionSchema>;
  actorId?: string;
  accountId?: string;
  credentialId?: string;
  resourceId?: string;
  recorded?: boolean;
  denialReason?: "CREDENTIAL_EXPIRED" | "CREDENTIAL_REVOKED";
};
export const auditContext = new AsyncLocalStorage<AuditContext>();
export function identify(
  fields: Partial<
    Pick<AuditContext, "actorId" | "accountId" | "credentialId" | "resourceId">
  >,
) {
  const context = auditContext.getStore();
  if (context) Object.assign(context, fields);
}
export function actionFor(
  method: string,
  path: string,
): AuditContext["action"] {
  const routes: Record<string, AuditContext["action"]> = {
    "POST /api/device/start": "setup.start",
    "POST /api/device/poll": "setup.claim",
    "POST /api/device/approve": "setup.approve",
    "GET /api/console/state": "workspace.list",
    "GET /api/console/activity": "activity.list",
    "POST /api/console/projects": "project.create",
    "POST /api/console/credentials": "credential.create",
    "POST /api/console/revoke": "credential.revoke",
    "POST /api/console/upload": "secret.write",
    "POST /api/upload": "secret.write",
    "POST /api/console/delete": "secret.delete",
    "POST /api/upload/context": "upload.context",
    "GET /api/v1/secret": "secret.retrieve",
    "GET /api/v1/search": "secret.search",
    "GET /api/v1/exists": "secret.exists",
  };
  return (
    routes[method + " " + path] ??
    (method === "GET" && /^\/api\/device\/[0-9a-f-]{36}$/.test(path)
      ? "setup.inspect"
      : "request.unknown")
  );
}
const reasonSchema = z.enum([
  "OK",
  "PENDING",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_REQUEST",
  "CONFLICT",
  "KEY_MISMATCH",
  "EXPIRED",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "REVERIFICATION_REQUIRED",
  "CREDENTIAL_EXPIRED",
  "CREDENTIAL_REVOKED",
]);
export async function recordAudit(
  client: Pool | PoolClient,
  context: AuditContext,
  outcome: "success" | "denied" | "error",
  reason: string,
  dedupe?: string,
) {
  // Explicit columns only: never serialize a request, response, error, token or payload.
  const action = actionSchema.parse(context.action);
  const safeReason = reasonSchema.parse(reason);
  const anonymous = !context.actorId && !context.accountId;
  const key =
    dedupe ??
    (anonymous
      ? `anonymous:${Math.floor(Date.now() / 60000)}:${action}:${outcome}:${safeReason}`
      : null);
  await client.query(
    `INSERT INTO keyman_mvp.audit_events(event_id,request_id,account_id,actor_id,credential_id,resource_id,action,outcome,reason,dedupe_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(dedupe_key) DO NOTHING`,
    [
      randomUUID(),
      context.requestId,
      context.accountId ?? null,
      context.actorId ?? null,
      context.credentialId ?? null,
      context.resourceId ?? null,
      action,
      outcome,
      safeReason,
      key,
    ],
  );
}
export function auditFailure(requestId: string) {
  // Fixed diagnostic fields, suitable for an operator log alert. No error serialization.
  console.error(
    JSON.stringify({ event: "audit.persistence_failed", requestId }),
  );
}
export async function pruneAudit(pool: Pool, days = 90) {
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new Error("Invalid audit retention days");
  return pool.query(
    "DELETE FROM keyman_mvp.audit_events WHERE occurred_at < now() - ($1::integer * interval '1 day')",
    [days],
  );
}
