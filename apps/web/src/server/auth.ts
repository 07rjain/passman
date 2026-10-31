import { verifyToken } from "@clerk/backend";
import { createPublicKey } from "node:crypto";
import { z } from "@keyman-mvp/core";
export interface Human {
  id: string;
  recent: boolean;
}
export function clerkAuthentication(config: {
  jwtKey: string;
  issuer: string;
  origin: string;
}) {
  if (
    !config.jwtKey.startsWith("-----BEGIN PUBLIC KEY-----") ||
    createPublicKey(config.jwtKey).asymmetricKeyType !== "rsa" ||
    new URL(config.issuer).protocol !== "https:" ||
    new URL(config.origin).origin !== config.origin
  )
    throw new Error(
      "Configure the Clerk public session-verification key, HTTPS issuer and exact application origin",
    );
  return async (request: Request): Promise<Human> => {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new Error("Unauthorized");
    const claims = await verifyToken(authorization.slice(7), {
      jwtKey: config.jwtKey,
      issuer: config.issuer,
      authorizedParties: [config.origin],
      clockSkewInMs: 0,
    });
    const user = z
      .object({
        sub: z.string().min(1),
        sid: z.string().min(1),
        azp: z.literal(config.origin),
        fva: z.tuple([z.number().int(), z.number().int()]).optional(),
      })
      .parse(claims);
    return {
      id: user.sub,
      recent: !!user.fva && user.fva[0] >= 0 && user.fva[0] <= 10,
    };
  };
}
