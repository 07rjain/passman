import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApi } from "../apps/web/src/server/api";
import { database, migrate } from "../apps/web/src/server/database";

const connection = process.env.MVP_TEST_DATABASE_URL;
if (!connection || new URL(connection).pathname !== "/keyman_mvp_test")
  throw new Error(
    "Set MVP_TEST_DATABASE_URL to a disposable keyman_mvp_test database",
  );

await test("device polling bounds unknown-code state and enforces shared and per-device quotas", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1800000000000 });
  const pool = database(connection);
  t.after(() => pool.end());
  await migrate(pool);
  // Integration files share the disposable schema and run serially.
  await pool.query("TRUNCATE keyman_mvp.devices,keyman_mvp.limits");
  const origin = "https://poll.test";
  const options = {
    pool,
    origin,
    clientAddress: () => "192.0.2.1",
    authenticate: async (): Promise<never> => {
      throw new Error("Polling must not require a human session");
    },
  };
  const apis = [createApi(options), createApi(options)];
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const code = () => randomBytes(32).toString("base64url");
  const poll = (deviceCode: string, instance = 0) =>
    apis[instance]!(
      new Request(origin + "/api/device/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceCode }),
      }),
    );
  const bucket = () => Math.floor(Date.now() / 60000);
  const sharedKey = digest("public-device-poll");

  for (let i = 0; i < 64; i++) {
    const response = await poll(code(), i % 2);
    assert.equal(response.status, 401);
  }
  assert.deepEqual(
    (
      await pool.query(
        "SELECT subject,bucket,count FROM keyman_mvp.limits WHERE subject=$1",
        [sharedKey],
      )
    ).rows,
    [{ subject: sharedKey, bucket: String(bucket()), count: 64 }],
    "Rotating unknown codes may allocate only the shared counter",
  );

  const pendingCode = code(),
    pendingId = randomUUID();
  await pool.query(
    "INSERT INTO keyman_mvp.devices(id,public_key,key_id,device_hash,code_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
    [
      pendingId,
      { kty: "OKP", crv: "X25519", x: "A".repeat(43) },
      "A".repeat(43),
      digest(pendingCode),
      digest("synthetic-approval-code"),
      Date.now() / 1000 + 600,
    ],
  );
  await pool.query("UPDATE keyman_mvp.limits SET count=1199 WHERE subject=$1", [
    sharedKey,
  ]);
  const lastAttempts = await Promise.all([poll(code()), poll(code(), 1)]);
  assert.deepEqual(lastAttempts.map((r) => r.status).sort(), [401, 429]);
  const limited = await poll(pendingCode);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, "RATE_LIMITED");
  assert.equal(limited.headers.get("cache-control"), "private, no-store");
  const malformed = await apis[1]!(
    new Request(origin + "/api/device/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }),
  );
  assert.equal(malformed.status, 429, "Admission precedes body parsing");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer AS count FROM keyman_mvp.limits",
      )
    ).rows[0].count,
    2,
  );

  // A new minute admits the real device; its own cadence is still capped.
  t.mock.timers.tick(60000);
  for (let i = 0; i < 30; i++) {
    const response = await poll(pendingCode, i % 2);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: "pending" });
  }
  assert.equal((await poll(pendingCode)).status, 429);
  t.mock.timers.tick(60000);
  assert.equal((await poll(pendingCode, 1)).status, 202);

  // Rejected lifecycle states never allocate another per-device counter.
  await pool.query(
    "DELETE FROM keyman_mvp.limits WHERE subject<>$1 AND subject<>$2",
    [sharedKey, digest("client:poll:192.0.2.1")],
  );
  await pool.query("UPDATE keyman_mvp.devices SET consumed=true WHERE id=$1", [
    pendingId,
  ]);
  assert.equal((await poll(pendingCode)).status, 401);
  await pool.query(
    "UPDATE keyman_mvp.devices SET consumed=false,expires_at=$2 WHERE id=$1",
    [pendingId, Date.now() / 1000],
  );
  assert.equal((await poll(pendingCode)).status, 410);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer AS count FROM keyman_mvp.limits WHERE subject<>$1 AND subject<>$2",
        [sharedKey, digest("client:poll:192.0.2.1")],
      )
    ).rows[0].count,
    0,
  );
  await t.test(
    "one enrollment caller cannot spend another caller's admission quota",
    async () => {
      t.mock.timers.tick(60000);
      let peer: string | undefined = "192.0.2.10";
      const startApi = createApi({ ...options, clientAddress: () => peer });
      const start = (forwarded: string) =>
        startApi(
          new Request(origin + "/api/device/start", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-for": forwarded,
            },
            body: JSON.stringify({
              publicKey: { kty: "OKP", crv: "X25519", x: "A".repeat(43) },
            }),
          }),
        );
      for (let i = 0; i < 40; i++)
        assert.equal(
          (await start(`192.0.2.${i + 30}`)).status,
          i < 10 ? 200 : 429,
        );
      peer = "192.0.2.11";
      assert.equal((await start("192.0.2.10")).status, 200);
      const shared = await pool.query(
        "SELECT count FROM keyman_mvp.limits WHERE subject=$1 AND bucket=$2",
        [digest("public-device-start"), bucket()],
      );
      assert.equal(shared.rows[0].count, 11);
      peer = undefined;
      assert.equal((await start("192.0.2.12")).status, 503);
    },
  );
});
