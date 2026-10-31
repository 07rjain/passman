import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const kind = process.argv[2];
if (!["patch", "minor", "major"].includes(kind))
  throw Error("Usage: npm run release:version -- patch|minor|major");
const file = path.join(root, "packages/client/package.json");
const pkg = JSON.parse(await readFile(file, "utf8"));
const parts = pkg.version.split(".").map(Number);
if (parts.length !== 3 || parts.some((n) => !Number.isSafeInteger(n) || n < 0))
  throw Error("Invalid current version");
const logFile = path.join(root, "docs/SDK_CHANGELOG.md");
const log = await readFile(logFile, "utf8");
const match = /## Unreleased\n([\s\S]*?)(?=\n## |$)/.exec(log);
if (!match || !match[1].trim())
  throw Error(
    "Write SDK/CLI changes under Unreleased before preparing a release",
  );
const index = ["major", "minor", "patch"].indexOf(kind);
parts[index]++;
for (let i = index + 1; i < 3; i++) parts[i] = 0;
pkg.version = parts.join(".");
const lockFile = path.join(root, "package-lock.json");
const lock = JSON.parse(await readFile(lockFile, "utf8"));
lock.packages["packages/client"].version = pkg.version;
await writeFile(file, JSON.stringify(pkg, null, 2) + "\n");
await writeFile(lockFile, JSON.stringify(lock, null, 2) + "\n");
await writeFile(
  logFile,
  log.replace(
    match[0],
    "## Unreleased\n\n## " +
      pkg.version +
      " — " +
      new Date().toISOString().slice(0, 10) +
      "\n" +
      match[1],
  ),
);
console.log(
  "Prepared Passman SDK/CLI " +
    pkg.version +
    ". Review, test and commit before publishing.",
);
