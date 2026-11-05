import { readFile, writeFile } from "node:fs/promises";
import { createHash, sign, verify } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");

export async function signRelease(directory, version, privateKey) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !privateKey)
    throw Error("A release signing key and stable version are required");
  const file = path.join(directory, `passman-${version}.tgz.sha256`);
  const manifest = await readFile(file);
  const filename = `passman-${version}.tgz`;
  const checksum = createHash("sha256")
    .update(await readFile(path.join(directory, filename)))
    .digest("hex");
  if (manifest.toString() !== `${checksum}  ${filename}\n`)
    throw Error("Release manifest does not match its versioned archive");
  const signature = sign("sha256", manifest, privateKey);
  const publicKey = await readFile(
    path.join(root, "distribution/release-public.pem"),
  );
  if (!verify("sha256", manifest, publicKey, signature))
    throw Error("Release signing key does not match the pinned publisher");
  await writeFile(file + ".sig", signature);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(
    await readFile(path.join(root, "packages/client/package.json"), "utf8"),
  );
  await signRelease(
    path.join(root, "ignore-docs/releases"),
    version,
    process.env.PASSMAN_RELEASE_PRIVATE_KEY,
  );
}
