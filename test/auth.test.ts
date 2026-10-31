import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";
import { clerkAuthentication } from "../apps/web/src/server/auth";
await test("Clerk verification pins signature, issuer, origin, session and authentication age", async () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 }),
    wrong = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const origin = "https://keyman.test",
    issuer = "https://clerk.test";
  const authenticate = clerkAuthentication({
    origin,
    issuer,
    jwtKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  });
  assert.throws(() =>
    clerkAuthentication({
      origin,
      issuer,
      jwtKey: keys.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    }),
  );
  async function token(
    overrides: Record<string, unknown> = {},
    key = keys.privateKey,
  ) {
    return new SignJWT({
      sub: "user_test",
      sid: "session_test",
      azp: origin,
      fva: [0, -1],
      iss: issuer,
      exp: Math.floor(Date.now() / 1000) + 60,
      ...overrides,
    })
      .setProtectedHeader({ alg: "RS256" })
      .sign(key);
  }
  const req = (value: string) =>
    new Request(origin, { headers: { authorization: "Bearer " + value } });
  assert.deepEqual(await authenticate(req(await token())), {
    id: "user_test",
    recent: true,
  });
  assert.equal(
    (await authenticate(req(await token({ fva: [11, -1] })))).recent,
    false,
  );
  for (const change of [
    { iss: "https://wrong.test" },
    { azp: "https://wrong.test" },
    { sid: "" },
    { exp: 1 },
  ])
    await assert.rejects(authenticate(req(await token(change))));
  await assert.rejects(authenticate(req(await token({}, wrong.privateKey))));
});
