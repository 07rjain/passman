import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const { version } = JSON.parse(
  await readFile(path.join(root, "packages/client/package.json"), "utf8"),
);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("Invalid release version");
const log = await readFile(path.join(root, "docs/SDK_CHANGELOG.md"), "utf8");
const marker = "## " + version + " — ";
const start = log.indexOf(marker);
if (start < 0) throw Error("Version needs a changelog entry");
const end = log.indexOf("\n## ", start + 1);
const notes =
  log.slice(start, end < 0 ? undefined : end) +
  "\n\nExperimental early-test client. PolyForm Noncommercial 1.0.0. Install: curl -fsSL https://passman.subdomain.wtf/install.sh | sh\n";
const body = path.join(root, "ignore-docs/releases/release-notes.md");
await writeFile(body, notes);
const directory = path.join(root, "ignore-docs/releases");
execFileSync(
  "gh",
  [
    "release",
    "create",
    "passman-v" + version,
    "--repo",
    "07rjain/passman",
    "--target",
    process.env.RELEASE_COMMIT ?? "main",
    "--title",
    "Passman " + version,
    "--notes-file",
    body,
    path.join(directory, "passman-" + version + ".tgz"),
    path.join(directory, "passman-" + version + ".tgz.sha256"),
    path.join(directory, "latest.txt"),
    path.join(root, "distribution/install.sh"),
  ],
  { stdio: "inherit" },
);
