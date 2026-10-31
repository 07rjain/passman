import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const files = ["README.md", "AGENTS.md", ".github/SECURITY.md"];
async function collect(directory) {
  for (const entry of await readdir(path.join(root, directory), {
    withFileTypes: true,
  })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(relative);
    else if (entry.name.endsWith(".md")) files.push(relative);
  }
}
await collect("docs");
for (const file of files) {
  const content = await readFile(path.join(root, file), "utf8");
  assert.ok(content.endsWith("\n"), `${file}: missing final newline`);
  assert.ok(!/[\t ]+$/m.test(content), `${file}: trailing whitespace`);
  let fence;
  for (const line of content.split("\n")) {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (!match) continue;
    if (!fence) fence = match[1];
    else if (match[1][0] === fence[0] && match[1].length >= fence.length)
      fence = undefined;
  }
  assert.equal(fence, undefined, `${file}: unclosed code fence`);
  for (const [, raw] of content.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = raw.replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const absolute = path.resolve(
      root,
      path.dirname(file),
      decodeURIComponent(target),
    );
    assert.ok(
      absolute.startsWith(`${root}${path.sep}`) || absolute === root,
      `${file}: link escapes repository`,
    );
    await access(absolute).catch(() =>
      assert.fail(`${file}: broken local link ${raw}`),
    );
  }
}
console.log(
  `Checked links, whitespace, and code fences in ${files.length} Markdown documents.`,
);
