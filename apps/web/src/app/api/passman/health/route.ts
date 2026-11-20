import { database } from "../../../../server/database";
import { version } from "../../../../../../../packages/passman/package.json";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let pool: ReturnType<typeof database> | undefined;
export async function GET(request: Request) {
  try {
    const connection = process.env.PASSMAN_DATABASE_URL,
      origin = process.env.APP_ORIGIN;
    if (
      !connection ||
      !origin ||
      !process.env.CLERK_JWT_KEY ||
      !process.env.CLERK_ISSUER
    )
      throw Error("Configuration unavailable");
    if (request.headers.get("host") !== new URL(origin).host)
      return Response.json(
        { status: "unavailable" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    pool ??= database(connection);
    const r = await pool.query(
      "SELECT version FROM passman_v1.migrations WHERE version=1",
    );
    if (r.rowCount !== 1) throw Error("Schema unavailable");
    return Response.json(
      { status: "ready", version },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
