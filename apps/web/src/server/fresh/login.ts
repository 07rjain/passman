import type { Pool, PoolClient } from "pg";
import { digest, failure, id, bytes32, z } from "@passman/protocol";
import type { Human } from "../auth";

export async function nativeManagement(
  pool: Pool | PoolClient,
  token: string,
): Promise<Human> {
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== "pmm1" ||
    !id.safeParse(parts[1]).success ||
    !bytes32.safeParse(parts[2]).success
  )
    failure("UNAUTHORIZED");
  const result = await pool.query<{ human_id: string }>(
    "SELECT human_id FROM passman_v1.native_management WHERE id=$1 AND hash=$2 AND expires_at>$3",
    [parts[1], await digest(token), Date.now()],
  );
  if (!result.rows[0]) failure("UNAUTHORIZED");
  return { id: result.rows[0].human_id, recent: true };
}
type Login = {
  claim_hash: string;
  fingerprint_hash: string;
  expires_at: string;
  human_id: string | null;
  approved_at: string | null;
  management_hash: string | null;
};
export async function loginRoute(
  c: PoolClient,
  path: string,
  input: unknown,
  human?: Human,
) {
  const now = Date.now();
  if (path === "/auth/start") {
    const d = z
      .object({ id, claimHash: bytes32, fingerprintHash: bytes32 })
      .strict()
      .parse(input);
    const count = (
      await c.query<{ count: string }>(
        "SELECT count(*) FROM passman_v1.native_logins WHERE expires_at>$1",
        [now],
      )
    ).rows[0]!;
    if (Number(count.count) >= 1000) failure("RATE_LIMITED");
    const expiresAt = now + 300_000;
    await c.query(
      "INSERT INTO passman_v1.native_logins(id,claim_hash,fingerprint_hash,expires_at) VALUES($1,$2,$3,$4)",
      [d.id, d.claimHash, d.fingerprintHash, expiresAt],
    );
    return { id: d.id, expiresAt };
  }
  const d = z
    .object({
      id,
      claimSecret: bytes32.optional(),
      fingerprint: bytes32.optional(),
      managementHash: bytes32.optional(),
    })
    .strict()
    .parse(input);
  const login = (
    await c.query<Login>(
      "SELECT * FROM passman_v1.native_logins WHERE id=$1 FOR UPDATE",
      [d.id],
    )
  ).rows[0];
  if (!login || Number(login.expires_at) <= now) failure("NOT_FOUND");
  if (path === "/console/auth/approve") {
    if (
      !human ||
      !d.fingerprint ||
      (await digest(d.fingerprint)) !== login.fingerprint_hash
    )
      failure("FORBIDDEN");
    if (login.human_id && login.human_id !== human.id) failure("CONFLICT");
    await c.query(
      "UPDATE passman_v1.native_logins SET human_id=$2,approved_at=COALESCE(approved_at,$3) WHERE id=$1",
      [d.id, human.id, now],
    );
    return { approved: true };
  }
  if (
    path !== "/auth/poll" ||
    !d.claimSecret ||
    !d.managementHash ||
    (await digest(d.claimSecret)) !== login.claim_hash
  )
    failure("FORBIDDEN");
  if (!login.human_id) return { state: "pending" };
  if (login.management_hash && login.management_hash !== d.managementHash)
    failure("CONFLICT");
  const expiresAt = Number(login.approved_at) + 600_000;
  await c.query(
    "UPDATE passman_v1.native_logins SET management_hash=$2 WHERE id=$1",
    [d.id, d.managementHash],
  );
  await c.query(
    "INSERT INTO passman_v1.native_management(id,human_id,hash,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
    [d.id, login.human_id, d.managementHash, expiresAt],
  );
  return {
    state: "approved",
    expiresAt,
    operatorId: await digest(
      JSON.stringify(["passman/management", login.human_id]),
    ),
  };
}
