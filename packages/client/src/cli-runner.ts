import { stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  initializeIdentity,
  unlockIdentity,
  saveIdentity,
  readPrivateFile,
  startLogin,
  pollLogin,
  uploadValue,
  KeymanClient,
  KeymanError,
  LocalVaultError,
  type Identity,
  type Transport,
} from "./index.js";
import { hasUploadAuthorization } from "./vault.js";

export interface CliRuntime {
  interactive: boolean;
  prompt: (label: string) => Promise<string>;
  print: (message: string) => void;
  openBrowser: (url: string) => void;
  transport?: Transport;
}
class CliError extends Error {}

export async function runCli(args: string[], runtime: CliRuntime) {
  const command = args[0] === "signin" ? "login" : args[0];
  function option(name: string, required = true) {
    const index = args.indexOf("--" + name),
      value = index >= 0 ? args[index + 1] : undefined;
    if (!value || value.startsWith("--")) {
      if (required) throw new CliError(`Missing --${name}`);
      return "";
    }
    return value;
  }

  if (command === "--version" || command === "version") {
    const metadata = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    runtime.print(metadata.version);
    return;
  }
  if (!["login", "put", "search", "check"].includes(command ?? "")) {
    runtime.print(
      "Passman: login (or signin); put --project NAME --name KEY [--replace]; search --project NAME [--query TEXT]; check --project NAME --name KEY; --version. Interactive put renews expired upload authorization through browser approval before secret input; noninteractive put requires prior login. No command prints provider values. Optional --url ORIGIN, --directory, --passphrase-file, --value-file, --no-browser. Default service: https://passman.subdomain.wtf.",
    );
    return;
  }
  const directory =
      option("directory", false) || path.join(homedir(), ".keyman-mvp"),
    passwordFile = option("passphrase-file", false);
  const password = passwordFile
    ? (await readPrivateFile(passwordFile, 1024)).replace(/\r?\n$/, "")
    : await runtime.prompt("Local vault passphrase (12+ characters): ");
  let exists = true;
  try {
    await stat(path.join(directory, "vault.json"));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      exists = false;
    else throw error;
  }
  if (!exists && command !== "login")
    throw new CliError(
      "Initialize your local identity with passman login first",
    );
  if (
    !exists &&
    !passwordFile &&
    (await runtime.prompt("Repeat passphrase: ")) !== password
  )
    throw new CliError(
      "Passphrases differ; retry passman login with the intended local passphrase",
    );
  let identity = exists
    ? await unlockIdentity(directory, password, {
        administrative: command === "login" || command === "put",
      })
    : await initializeIdentity(
        directory,
        password,
        option("url", false) || "https://passman.subdomain.wtf",
      );
  async function authorize(profile: Identity): Promise<Identity> {
    const started = await startLogin(profile, runtime.transport);
    runtime.print(
      `Vault fingerprint: ${started.keyId}\nApproval code: ${started.userCode}\nOpen: ${started.verificationUrl}`,
    );
    if (!args.includes("--no-browser")) {
      runtime.openBrowser(started.verificationUrl);
    }
    const deadline = Date.now() + started.expiresIn * 1000;
    while (Date.now() < deadline) {
      const approved = await pollLogin(
        profile,
        started.deviceCode,
        runtime.transport,
      );
      if (approved) {
        if (!hasUploadAuthorization(approved))
          throw new CliError(
            "New upload authorization is already expired. Check your machine's date/time and run passman login again.",
          );
        await saveIdentity(directory, password, approved);
        runtime.print(
          "Account linked. Local upload authorization lasts 20 minutes; the private key remains local.",
        );
        return approved;
      }
      await delay(
        Math.min(started.interval * 1000, Math.max(0, deadline - Date.now())),
      );
    }
    throw new KeymanError("EXPIRED");
  }
  if (command === "login") {
    const url = option("url", false);
    if (url && url !== identity.origin)
      throw new CliError(
        "Use the original origin; this command does not replace a vault or endpoint",
      );
    await authorize(identity);
    return;
  }
  if (command === "put") {
    const project = option("project"),
      name = option("name");
    if (!hasUploadAuthorization(identity)) {
      if (!runtime.interactive)
        throw new CliError(
          "Upload authorization is missing or expired. Run passman login with the same vault in an interactive terminal, then retry this command. No secret value was read.",
        );
      runtime.print(
        "Upload authorization is missing or expired. Approve this vault in your browser to renew it before entering a secret.",
      );
      identity = await authorize(identity);
    }
    const file = option("value-file", false),
      value = file
        ? await readPrivateFile(file, 65536)
        : await runtime.prompt("Secret value (hidden): ");
    const result = await uploadValue(
      identity,
      project,
      name,
      value,
      args.includes("--replace"),
      runtime.transport,
    );
    runtime.print(`Stored encrypted value at revision ${result.revision}.`);
    return;
  }
  // Read credentials are supplied through protected local configuration, never CLI arguments.
  const serviceKey = process.env.KEYMAN_SERVICE_KEY;
  if (!serviceKey) throw new Error("Set KEYMAN_SERVICE_KEY privately");
  const client = new KeymanClient({
    identity,
    serviceKey,
    project: option("project"),
    transport: runtime.transport,
  });
  if (command === "search")
    runtime.print(
      JSON.stringify(
        await client.search({ query: option("query", false) }),
        null,
        2,
      ),
    );
  else
    runtime.print(
      (await client.hasSecret({ name: option("name") }))
        ? "Found"
        : "Not found",
    );
}

export function cliErrorMessage(error: unknown, command?: string): string {
  if (error instanceof CliError) return error.message;
  if (error instanceof LocalVaultError)
    return "Could not unlock the local vault or read a protected file. Check the local vault passphrase (not your website password), file ownership and permissions. Keep your existing vault file.";
  if (error instanceof KeymanError) {
    const tip =
      error.code === "EXPIRED"
        ? " Browser approval or upload authorization expired. Run passman login with the same vault and approve the request, then retry."
        : error.code === "UNAUTHORIZED" && command === "put"
          ? " Upload authorization was rejected. Run passman login with the same vault, then retry."
          : "";
    return error.message + tip;
  }
  return "Operation failed. Check setup, protected files, passphrase, or connectivity. Sensitive details omitted.";
}
