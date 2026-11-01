import { database } from "../../../server/database";
import { createApi, failure } from "../../../server/api";
import { clerkWebhook } from "../../../server/clerk-webhook";
import { clerkAuthentication } from "../../../server/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
let webhook: ReturnType<typeof clerkWebhook> | undefined;
let api: ReturnType<typeof createApi> | undefined;
async function handle(request: Request) {
  if (
    !process.env.DATABASE_URL ||
    !process.env.APP_ORIGIN ||
    !process.env.CLERK_JWT_KEY ||
    !process.env.CLERK_ISSUER
  )
    return failure("UNAVAILABLE", 503);
  try {
    const publicOrigin = new URL(process.env.APP_ORIGIN);
    if (request.headers.get("host") !== publicOrigin.host)
      return failure("INVALID_REQUEST", 400);
    if (
      new URL(request.url).pathname === "/api/webhooks/clerk" &&
      request.method === "POST"
    ) {
      webhook ??= clerkWebhook(
        database(process.env.DATABASE_URL),
        process.env.CLERK_WEBHOOK_SIGNING_SECRET,
      );
      return await webhook(request);
    }
    api ??= createApi({
      pool: database(process.env.DATABASE_URL),
      origin: process.env.APP_ORIGIN,
      authenticate: clerkAuthentication({
        jwtKey: process.env.CLERK_JWT_KEY.replaceAll("\\n", "\n"),
        issuer: process.env.CLERK_ISSUER,
        origin: process.env.APP_ORIGIN,
      }),
    });
    // Next.js may use its internal listener hostname in Request.url. Pin the
    // application origin and validate Host; forwarding headers grant no trust.
    const incoming = new URL(request.url);
    const canonical = new Request(
      publicOrigin.origin + incoming.pathname + incoming.search,
      request,
    );
    return await api(canonical);
  } catch {
    return failure("UNAVAILABLE", 503);
  }
}
export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as DELETE,
  handle as PATCH,
};
