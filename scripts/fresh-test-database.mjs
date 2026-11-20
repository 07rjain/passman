import { readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";

const name = `passman-fixture-${randomUUID()}`;
// sudo is only a local convenience when the invoking user lacks Docker socket access.
const direct = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
const command = direct ? "docker" : "sudo";
const prefix = direct ? [] : ["-n", "docker"];
function docker(args) {
  const p = spawnSync(command, [...prefix, ...args], { encoding: "utf8" });
  if (p.status !== 0)
    throw new Error("Disposable PostgreSQL requires accessible Docker");
  return p.stdout.trim();
}
let started = false;
try {
  docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_PASSWORD=passman_synthetic_fixture",
    "--env",
    "POSTGRES_DB=passman_v1_test",
    "postgres:17-alpine",
  ]);
  started = true;
  const address = docker(["port", name, "5432"]).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(address))
    throw new Error("Unexpected fixture binding");
  const connection = `postgresql://postgres:passman_synthetic_fixture@${address}/passman_v1_test`;
  let available = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const pool = new Pool({
      connectionString: connection,
      connectionTimeoutMillis: 500,
      max: 1,
    });
    try {
      await pool.query("SELECT 1");
      available = true;
      break;
    } catch {
      await delay(500);
    } finally {
      await pool.end();
    }
  }
  if (!available) throw new Error("Disposable PostgreSQL failed to start");
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      ...(await readdir(new URL("../test", import.meta.url)))
        .filter((name) => /^fresh-.*\.integration\.ts$/.test(name))
        .sort()
        .map((name) => `test/${name}`),
    ],
    {
      cwd: new URL("..", import.meta.url),
      stdio: "inherit",
      env: { ...process.env, PASSMAN_TEST_DATABASE_URL: connection },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  if (started) docker(["rm", "--force", name]);
}
