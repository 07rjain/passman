import assert from "node:assert/strict";
import { test } from "node:test";
import { deploymentClientAddress } from "../apps/web/src/server/admission";

test("public admission accepts only platform addresses or the local development peer", (t) => {
  const previous = {
    VERCEL: process.env.VERCEL,
    APP_ORIGIN: process.env.APP_ORIGIN,
  };
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const request = (address?: string) =>
    new Request("https://passman.test/api/device/start", {
      headers: {
        "x-forwarded-for": "198.51.100.5",
        ...(address ? { "x-vercel-forwarded-for": address } : {}),
      },
    });
  process.env.VERCEL = "1";
  assert.equal(deploymentClientAddress(request("192.0.2.1")), "192.0.2.1");
  assert.equal(deploymentClientAddress(request()), undefined);
  assert.equal(
    deploymentClientAddress(request("192.0.2.1, 192.0.2.2")),
    undefined,
  );
  delete process.env.VERCEL;
  process.env.APP_ORIGIN = "https://passman.test";
  assert.equal(deploymentClientAddress(request("192.0.2.1")), undefined);
  process.env.APP_ORIGIN = "http://127.0.0.1:3100";
  assert.equal(deploymentClientAddress(request("192.0.2.1")), "127.0.0.1");
});
