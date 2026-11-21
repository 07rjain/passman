import { createFreshApi } from "../../../../../server/fresh/api";
import { database } from "../../../../../server/database";
import { clerkAuthentication } from "../../../../../server/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
let api: ReturnType<typeof createFreshApi> | undefined;
async function handle(request: Request) {
  try {
    const origin = process.env.APP_ORIGIN;
    const connection = process.env.PASSMAN_DATABASE_URL;
    const jwtKey = process.env.CLERK_JWT_KEY,
      issuer = process.env.CLERK_ISSUER;
    if (!origin || !connection || !jwtKey || !issuer)
      throw new Error("Configuration unavailable");
    if (request.headers.get("host") !== new URL(origin).host)
      return Response.json(
        { error: { code: "INVALID_REQUEST" } },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    api ??= createFreshApi({
      pool: database(connection),
      origin,
      authenticate: clerkAuthentication({
        jwtKey: jwtKey.replaceAll("\\n", "\n"),
        issuer,
        origin,
      }),
    });
    const u = new URL(request.url);
    return await api(new Request(origin + u.pathname + u.search, request));
  } catch {
    return Response.json(
      { error: { code: "UNAVAILABLE" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as DELETE,
  handle as PATCH,
};
