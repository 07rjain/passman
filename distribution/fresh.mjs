import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDistribution } from "./build.mjs";
const root = path.resolve(import.meta.dirname, "..");
export async function freshInstallers() {
  const { version } = JSON.parse(
    await readFile(path.join(root, "packages/passman/package.json"), "utf8"),
  );
  const shell = (
    await readFile(path.join(root, "distribution/install.sh"), "utf8")
  ).replace(
    "version=${PASSMAN_VERSION:-}",
    `version=\${PASSMAN_VERSION:-${version}}`,
  );
  const powershell = (
    await readFile(path.join(root, "distribution/install.ps1"), "utf8")
  ).replace(
    "$version = $env:PASSMAN_VERSION",
    `$version = if ($env:PASSMAN_VERSION) { $env:PASSMAN_VERSION } else { '${version}' }`,
  );
  return { "install-v1.sh": shell, "install-v1.ps1": powershell };
}
export async function buildFreshDistribution(
  output = path.join(root, "ignore-docs/fresh-releases"),
) {
  const result = await buildDistribution(output, "passman");
  await mkdir(output, { recursive: true });
  for (const [name, content] of Object.entries(await freshInstallers()))
    await writeFile(path.join(output, name), content);
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await buildFreshDistribution(process.argv[2])));
