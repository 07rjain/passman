import { verifyWebhook } from "@clerk/backend/webhooks";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "@keyman-mvp/core";
import { recordAudit, auditFailure, actionSchema } from "./audit";

export function clerkWebhook(pool: Pool, signingSecret: string | undefined) {
  return async (request: Request) => {
    const requestId = randomUUID();
    const reply = (status: number) =>
      new Response(null, {
        status,
        headers: {
          "cache-control": "private, no-store",
          "x-request-id": requestId,
        },
      });
    if (!signingSecret) return reply(503);
    const reader = request.body?.getReader();
    if (!reader) return reply(400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 120000) {
          await reader.cancel();
          return reply(413);
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    let payload;
    try {
      const verified = await verifyWebhook(
        new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: Buffer.concat(chunks),
        }),
        { signingSecret },
      );
      if (
        ![
          "session.created",
          "session.ended",
          "session.removed",
          "session.revoked",
        ].includes(verified.type)
      )
        return reply(204);
      payload = z
        .object({
          type: z.string(),
          data: z
            .object({ user_id: z.string().regex(/^user_[A-Za-z0-9]{1,100}$/) })
            .passthrough(),
        })
        .parse(verified);
    } catch {
      return reply(400);
    }
    if (
      ![
        "session.created",
        "session.ended",
        "session.removed",
        "session.revoked",
      ].includes(payload.type)
    )
      return reply(204);
    const deliveryId = z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,200}$/)
      .safeParse(request.headers.get("svix-id"));
    if (!deliveryId.success) return reply(400);
    try {
      const owner = (
        await pool.query<{ id: string }>(
          "SELECT id FROM keyman_mvp.accounts WHERE clerk_id=$1",
          [payload.data.user_id],
        )
      ).rows[0];
      await recordAudit(
        pool,
        {
          requestId,
          action: actionSchema.parse(payload.type),
          actorId: payload.data.user_id,
          accountId: owner?.id,
        },
        "success",
        "OK",
        "clerk:" + deliveryId.data,
      );
      return reply(204);
    } catch {
      auditFailure(requestId);
      return reply(503);
    }
  };
}
