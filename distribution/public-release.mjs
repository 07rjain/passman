import { Buffer } from "node:buffer";
import { createHash, verify } from "node:crypto";

async function download(url, maximum, transport) {
  for (let redirects = 0; redirects < 6; redirects++) {
    if (new URL(url).protocol !== "https:")
      throw Error("Release downloads require HTTPS");
    const response = await transport(url, {
      redirect: "manual",
      signal: globalThis.AbortSignal.timeout(15000),
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) throw Error("Invalid release redirect");
      url = new URL(next, url).href;
      continue;
    }
    if (!response.ok || !response.body)
      throw Error("Signed public release is unavailable");
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > maximum) {
          await reader.cancel();
          throw Error("Release response exceeds limit");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }
  throw Error("Too many release redirects");
}

/** Fail production builds before serving an installer whose public release is not ready. */
export async function assertPublishedClient({
  minimumVersion,
  publicKey,
  transport = globalThis.fetch,
  base = "https://github.com/07rjain/passman/releases",
}) {
  const latest = (
    await download(base + "/latest/download/latest.txt", 100, transport)
  )
    .toString()
    .trim();
  if (
    !/^\d+\.\d+\.\d+$/.test(latest) ||
    !/^\d+\.\d+\.\d+$/.test(minimumVersion)
  )
    throw Error("Invalid public client version");
  const current = latest.split(".").map(Number),
    minimum = minimumVersion.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (current[i] < minimum[i])
      throw Error("Publish the signed client before production deployment");
    if (current[i] > minimum[i]) break;
  }
  const filename = `passman-${latest}.tgz`;
  const url = `${base}/download/passman-v${latest}/${filename}`;
  const manifest = await download(url + ".sha256", 512, transport);
  const signature = await download(url + ".sha256.sig", 1024, transport);
  if (!verify("sha256", manifest, publicKey, signature))
    throw Error("Public publisher signature is invalid");
  const archive = await download(url, 32 * 1024 * 1024, transport);
  const checksum = createHash("sha256").update(archive).digest("hex");
  if (manifest.toString() !== `${checksum}  ${filename}\n`)
    throw Error("Public archive differs from its signed manifest");
}
