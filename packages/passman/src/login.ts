import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  bytes32,
  canonicalOrigin,
  digest,
  failure,
  id,
  randomSecret,
  z,
} from "@passman/protocol";
import {
  parseResponse,
  transport,
  type TransportOptions,
} from "./transport.js";

/** Explicit setup only. Ordinary SDK requests never invoke this login flow. */
export async function login(
  options: TransportOptions & {
    onVisit: (details: {
      url: string;
      fingerprint: string;
      expiresAt: number;
    }) => void | Promise<void>;
    openBrowser?: (url: string) => Promise<void>;
  },
) {
  const origin = canonicalOrigin(options.origin),
    sessionId = randomUUID(),
    claimSecret = randomSecret(),
    fingerprint = randomSecret();
  const managementToken = `pmm1.${sessionId}.${randomSecret()}`;
  const request = transport(options, "");
  const started = parseResponse(
    z.object({ id, expiresAt: z.number().int().positive() }).strict(),
    await request("/auth/start", {
      method: "POST",
      body: JSON.stringify({
        id: sessionId,
        claimHash: await digest(claimSecret),
        fingerprintHash: await digest(fingerprint),
      }),
    }),
  );
  if (started.id !== sessionId || started.expiresAt > Date.now() + 330_000)
    failure("INTEGRITY_FAILED");
  const url = `${origin}/passman/connect?session=${sessionId}`;
  await options.onVisit({ url, fingerprint, expiresAt: started.expiresAt });
  await options.openBrowser?.(url);
  const schema = z.discriminatedUnion("state", [
    z.object({ state: z.literal("pending") }).strict(),
    z
      .object({
        state: z.literal("approved"),
        expiresAt: z.number().int().positive(),
        operatorId: bytes32,
      })
      .strict(),
  ]);
  while (Date.now() < started.expiresAt) {
    const state = parseResponse(
      schema,
      await request("/auth/poll", {
        method: "POST",
        body: JSON.stringify({
          id: sessionId,
          claimSecret,
          managementHash: await digest(managementToken),
        }),
      }),
    );
    if (state.state === "approved") {
      if (
        state.expiresAt <= Date.now() ||
        state.expiresAt > Date.now() + 630_000
      )
        failure("INTEGRITY_FAILED");
      return {
        managementToken,
        expiresAt: state.expiresAt,
        operatorId: state.operatorId,
      };
    }
    try {
      await delay(1500, undefined, { signal: options.signal });
    } catch {
      return failure("UNAVAILABLE");
    }
  }
  return failure("UNAUTHORIZED");
}
