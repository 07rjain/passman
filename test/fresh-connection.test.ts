import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  isReverificationHint,
  reverificationError,
} from "@clerk/shared/authorization-errors";
import { randomSecret } from "@passman/protocol";
import {
  ConnectionError,
  approvalSchema,
  connectionMessage,
  requestConnection,
} from "../apps/web/src/app/passman/connect/connection-request";

await test("connection approval preserves verification challenges and accepts only explicit approval", async () => {
  const session = randomUUID(),
    fingerprint = randomSecret();
  const tokens = [randomSecret(), randomSecret()];
  let calls = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    assert.equal(input, "/api/passman/v1/console/auth/approve");
    assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      `Bearer ${tokens[calls]}`,
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      id: session,
      fingerprint,
    });
    return calls++ === 0
      ? Response.json(
          {
            error: { code: "FORBIDDEN" },
            ...reverificationError({ level: "first_factor", afterMinutes: 10 }),
          },
          { status: 403 },
        )
      : Response.json({ approved: true });
  };
  const challenge = await requestConnection({
    session,
    fingerprint,
    token: tokens[0]!,
    fetch,
  });
  assert.ok(isReverificationHint(challenge));
  assert.equal(approvalSchema.safeParse(challenge).success, false);
  assert.deepEqual(
    await requestConnection({ session, fingerprint, token: tokens[1]!, fetch }),
    { approved: true },
  );
  assert.equal(calls, 2);
});

await test("connection failures remain failures and show actionable redacted messages", async () => {
  const options = {
    session: randomUUID(),
    fingerprint: randomSecret(),
    token: randomSecret(),
  };
  for (const [status, code, guidance] of [
    [401, "UNAUTHORIZED", "Sign out and sign in"],
    [403, "FORBIDDEN", "same running passman login"],
    [404, "NOT_FOUND", "expired"],
    [409, "CONFLICT", "another account"],
    [429, "RATE_LIMITED", "Wait a minute"],
    [503, "UNAVAILABLE", "unavailable"],
  ] as const) {
    const fetch: typeof globalThis.fetch = async () =>
      Response.json(
        { error: { code }, unsafeDetail: options.token },
        { status },
      );
    await assert.rejects(
      requestConnection({ ...options, fetch }),
      (error: unknown) => {
        assert.ok(error instanceof ConnectionError);
        assert.equal(error.code, code);
        assert.ok(connectionMessage(error).includes(guidance));
        assert.equal(connectionMessage(error).includes(options.token), false);
        assert.equal(String(error).includes(options.token), false);
        return true;
      },
    );
  }
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => {
    calls++;
    return Response.json({});
  };
  await assert.rejects(requestConnection({ ...options, token: null, fetch }), {
    code: "UNAUTHORIZED",
  });
  assert.equal(calls, 0);
  await assert.rejects(requestConnection({ ...options, fetch }), {
    code: "UNAVAILABLE",
  });
  assert.equal(calls, 1);
  await assert.rejects(
    requestConnection({
      ...options,
      fetch: async () =>
        Response.json({ error: { code: options.token } }, { status: 500 }),
    }),
    { code: "UNAVAILABLE" },
  );
});
