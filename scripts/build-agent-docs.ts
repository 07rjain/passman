import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = "https://raw.githubusercontent.com/07rjain/passman/main/";
const root = fileURLToPath(new URL("../", import.meta.url));

async function markdownFiles(
  directory: string,
  base: string,
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(base, directory), {
    withFileTypes: true,
  })) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory())
      files.push(...(await markdownFiles(relative, base)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(relative);
  }
  return files.sort();
}

function absoluteLinks(content: string, file: string): string {
  return content.replace(
    /(\[[^\]]*\]\()([^)\s]+)(\))/g,
    (_match, before: string, target: string, after: string) =>
      `${before}${new URL(target, repository + file).href}${after}`,
  );
}

/** Build public text from public source docs only, never local configuration. */
export async function buildAgentDocs(base = root): Promise<void> {
  const files = [
    "README.md",
    ".github/SECURITY.md",
    "skills/passman/SKILL.md",
    "skills/passman/references/usage.md",
    ...(await markdownFiles("docs", base)),
  ];
  const documents = await Promise.all(
    files.map(async (file) => ({
      file,
      content: await readFile(path.join(base, file), "utf8"),
    })),
  );
  const guide = documents.find(({ file }) => file === "docs/agent-guide.md");
  if (!guide) throw new Error("Missing public agent setup guide");
  const index = documents.map(({ file, content }) => {
    const title = /^# (.+)$/m.exec(content)?.[1] ?? file;
    return `- [${title} (${file})](${repository}${file})`;
  });
  const entry = `${guide.content.trim()}\n\n## Optional\n\nComplete source-document index follows, including contributor/operator guides and dated evidence. Use current setup/reference guides for user tasks; historical records and planned features are not proof of current deployment or permission to operate infrastructure. The full text is also available at https://passman.subdomain.wtf/llms-full.txt.\n\n${index.join("\n")}\n`;
  const full = [
    "# Passman complete documentation",
    "> Public documentation snapshot from this website build. Start with the agent setup guide. Contributor/operator instructions apply only to those tasks; dated evidence and future plans are not current acceptance guarantees. This file contains documentation, not user accounts, credentials or vault access.",
    ...documents.map(
      ({ file, content }) =>
        `---\n\nSource: ${repository}${file}\n\n${absoluteLinks(content, file).trim()}`,
    ),
  ].join("\n\n");
  const target = path.join(base, "apps/web/public");
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "llms.txt"), entry);
  await writeFile(path.join(target, "llms-full.txt"), full + "\n");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildAgentDocs();
