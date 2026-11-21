import { isReverificationHint } from "@clerk/shared/authorization-errors";
import { API_PATH, errorCodes, z } from "@passman/protocol";

export const approvalSchema = z.object({ approved: z.literal(true) }).strict();

export class ConnectionError extends Error {
  constructor(readonly code: string) {
    super("Connection approval failed");
  }
}

/** Return Clerk's challenge to useReverification; never turn a denial into success. */
export async function requestConnection(options: {
  session: string;
  fingerprint: string;
  token: string | null;
  fetch?: typeof fetch;
}) {
  if (!options.token) throw new ConnectionError("UNAUTHORIZED");
  const response = await (options.fetch ?? fetch)(
    `${API_PATH}/console/auth/approve`,
    {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: options.session,
        fingerprint: options.fingerprint,
      }),
    },
  );
  const value: unknown = await response.json();
  if (response.status === 403 && isReverificationHint(value)) return value;
  if (!response.ok) {
    const parsed = z
      .object({ error: z.object({ code: z.enum(errorCodes) }) })
      .safeParse(value);
    throw new ConnectionError(
      parsed.success ? parsed.data.error.code : "UNAVAILABLE",
    );
  }
  const approved = approvalSchema.safeParse(value);
  if (!approved.success) throw new ConnectionError("UNAVAILABLE");
  return approved.data;
}

export function connectionMessage(error: unknown): string {
  if (error instanceof ConnectionError) {
    switch (error.code) {
      case "NOT_FOUND":
        return "This connection link has expired. Run passman login again and use its new link and code.";
      case "FORBIDDEN":
        return "The connection code does not match this link. Copy both from the same running passman login command and try again.";
      case "UNAUTHORIZED":
        return "Your website sign-in is unavailable. Sign out and sign in again, then retry with a new passman login link.";
      case "CONFLICT":
        return "This connection was already approved by another account. Run passman login again to start a new connection.";
      case "RATE_LIMITED":
        return "Too many connection attempts. Wait a minute, then run passman login again.";
    }
  }
  return "Connection approval is unavailable. Check your network and try again. If the link expired, run passman login again.";
}
