import {
  KeymanClient,
  unlockIdentity,
  readPrivateFile,
} from "@keyman-mvp/client";
const directory = process.env.KEYMAN_DIRECTORY;
const passphraseFile = process.env.KEYMAN_PASSPHRASE_FILE;
const serviceKey = process.env.KEYMAN_SERVICE_KEY;
const project = process.env.KEYMAN_PROJECT;
if (!directory || !passphraseFile || !serviceKey || !project)
  throw new Error(
    "Configure the private local directory, passphrase file, service credential and project first.",
  );
try {
  const identity = await unlockIdentity(
    directory,
    (await readPrivateFile(passphraseFile, 1024)).replace(/\r?\n$/, ""),
  );
  const client = new KeymanClient({ identity, serviceKey, project });
  const value = await client.getSecret({
    name: process.argv[2] ?? "TEST_PROVIDER_KEY",
  });
  if (typeof value !== "string") throw new Error();
  // Pass value to your trusted application/provider code. Never return it to the model.
  console.log("Secret retrieved locally. Its value is omitted from output.");
} catch {
  console.error(
    "Retrieval failed. Check local unlock, credential scope/expiry and connectivity.",
  );
  process.exitCode = 1;
}
