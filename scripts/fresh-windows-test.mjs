import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { win32 } from "node:path";
assert.equal(process.platform, "win32", "Use this runner only on Windows");
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "test/fresh-native.test.ts"],
  {
    stdio: "inherit",
    env: { ...process.env, PASSMAN_NATIVE_FIXTURE: "1" },
    timeout: 120000,
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (process.exitCode !== 0) {
  // Execute the fixed SDK helper with a new random slot and synthetic data only.
  // No real runtime/profile material enters these diagnostic subprocesses.
  const source = await readFile(
    new URL("../packages/passman/src/native-custody.ts", import.meta.url),
    "utf8",
  );
  const helper = /const windowsHelper = String.raw`([\s\S]*?)`;/u.exec(
    source,
  )?.[1];
  assert(helper, "Windows helper source unavailable");
  const root = process.env.SystemRoot;
  assert(root && /^[A-Za-z]:\\Windows$/iu.test(root));
  const command = win32.join(
    root,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const slot = randomBytes(32).toString("hex");
  for (const operation of ["read", "write", "read", "delete"]) {
    const probe = spawnSync(
      command,
      ["-NoProfile", "-NonInteractive", "-Command", helper],
      {
        input: JSON.stringify({
          operation,
          slot,
          ...(operation === "write"
            ? { value: JSON.stringify("synthetic native fixture") }
            : {}),
        }),
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      },
    );
    console.log(
      JSON.stringify({
        syntheticOperation: operation,
        exitCode: probe.status,
        outputLength: probe.stdout?.length,
        diagnostic: probe.stderr?.slice(0, 4000),
      }),
    );
  }
}
