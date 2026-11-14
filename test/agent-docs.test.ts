import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildAgentDocs } from "../scripts/build-agent-docs";

test("agent documentation packages every public guide with portable links and excludes private files", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "passman-agent-docs-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const fixture = {
    "README.md": "# Fixture product\n\nPublic overview.\n",
    ".github/SECURITY.md": "# Reporting\n\nPrivate reporting instructions.\n",
    "skills/passman/SKILL.md": "# Fixture skill\n\nPortable instructions.\n",
    "skills/passman/references/usage.md": "# Fixture usage\n\nSDK interface.\n",
    "docs/agent-guide.md": "# Passman\n\n> Start here.\n",
    "docs/reference.md": "# Reference\n\nInitial interface.\n",
    "docs/history/record.md":
      "# Old record\n\n[Reference](../reference.md#commands), [local section](#old-record), [website](https://example.com/) and [email](mailto:fixture@example.invalid).\n",
    ".env": "SYNTHETIC_PRIVATE_CANARY",
    "ignore-docs/private.md": "SYNTHETIC_PRIVATE_CANARY",
    "docs/local.txt": "SYNTHETIC_PRIVATE_CANARY",
  };
  for (const [file, content] of Object.entries(fixture)) {
    await mkdir(path.dirname(path.join(base, file)), { recursive: true });
    await writeFile(path.join(base, file), content);
  }
  await buildAgentDocs(base);
  const output = (file: string) =>
    readFile(path.join(base, "apps/web/public", file), "utf8");
  const entry = await output("llms.txt");
  const full = await output("llms-full.txt");
  const raw = "https://raw.githubusercontent.com/07rjain/passman/main/";
  for (const file of Object.keys(fixture).filter(
    (file) => file.endsWith(".md") && !file.startsWith("ignore-docs/"),
  )) {
    assert.ok(entry.includes(raw + file), `Missing index entry: ${file}`);
    assert.ok(
      full.includes(`Source: ${raw}${file}`),
      `Missing bundled guide: ${file}`,
    );
  }
  assert.ok(!entry.includes("SYNTHETIC_PRIVATE_CANARY"));
  assert.ok(!full.includes("SYNTHETIC_PRIVATE_CANARY"));
  assert.ok(full.includes(`[Reference](${raw}docs/reference.md#commands)`));
  assert.ok(
    full.includes(`[local section](${raw}docs/history/record.md#old-record)`),
  );
  assert.ok(full.includes("[website](https://example.com/)"));
  assert.ok(full.includes("[email](mailto:fixture@example.invalid)"));
  await buildAgentDocs(base);
  assert.equal(await output("llms.txt"), entry);
  assert.equal(await output("llms-full.txt"), full);
  await writeFile(
    path.join(base, "docs/reference.md"),
    "# Reference\n\nUpdated interface.\n",
  );
  await buildAgentDocs(base);
  assert.ok((await output("llms-full.txt")).includes("Updated interface."));
  assert.ok(!(await output("llms-full.txt")).includes("Initial interface."));
});

test("missing agent guide fails generation without publishing partial documentation", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "passman-agent-docs-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  for (const file of [
    "README.md",
    ".github/SECURITY.md",
    "skills/passman/SKILL.md",
    "skills/passman/references/usage.md",
    "docs/reference.md",
  ]) {
    await mkdir(path.dirname(path.join(base, file)), { recursive: true });
    await writeFile(path.join(base, file), "# Fixture\n");
  }
  await assert.rejects(
    buildAgentDocs(base),
    /Missing public agent setup guide/,
  );
  await assert.rejects(readFile(path.join(base, "apps/web/public/llms.txt")), {
    code: "ENOENT",
  });
});
