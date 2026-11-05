import { isIP } from "node:net";

/** Only the deployment adapter may establish this identity, never API input. */
export function deploymentClientAddress(request: Request): string | undefined {
  if (process.env.VERCEL === "1") {
    const address = request.headers.get("x-vercel-forwarded-for");
    return address && isIP(address) ? address : undefined;
  }
  // Local development has one peer. Arbitrary forwarding headers are ignored.
  const origin = new URL(process.env.APP_ORIGIN!);
  if (
    origin.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(origin.hostname)
  )
    return "127.0.0.1";
  return undefined;
}
