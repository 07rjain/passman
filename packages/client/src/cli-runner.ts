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
  prepareEnvImport,
  readEnvFile,
  EnvImportError,
  ImportCommitError,
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
  if (!["login", "put", "import", "search", "check"].includes(command ?? "")) {
    runtime.print(
      "Passman: login (or signin); put --project NAME --name KEY [--replace]; import --project NAME --file PATH [--dry-run] [--skip-existing | --replace] [--allow-empty] [--yes]; search --project NAME [--query TEXT]; check --project NAME --name KEY; --version. Interactive put/import renew expired upload authorization before secret input; noninteractive use requires prior login. Import previews names only, then requires confirmation (--yes for automation). No command prints provider values. Optional --url ORIGIN, --directory, --passphrase-file, --value-file, --no-browser. Default service: https://passman.subdomain.wtf.",
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
        administrative:
          command === "login" || command === "put" || command === "import",
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
  if (command === "put" || command === "import") {
    const project = option("project");
    const name = command === "put" ? option("name") : "";
    const importFile = command === "import" ? option("file") : "";
    if (
      command === "import" &&
      args.includes("--replace") &&
      args.includes("--skip-existing")
    )
      throw new CliError(
        "Choose either --replace or --skip-existing, not both.",
      );
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
    if (command === "import") {
      let source: Uint8Array;
      try {
        source = await readEnvFile(importFile);
      } catch {
        throw new CliError(
          "Could not read the .env file. Check that it exists, is at most 64 KiB and has owner-only access inside a private directory with safe parent paths (NTFS ACLs on Windows).",
        );
      }
      let prepared;
      try {
        prepared = await prepareEnvImport({
          identity,
          project,
          source,
          conflicts: args.includes("--replace")
            ? "replace"
            : args.includes("--skip-existing")
              ? "skip"
              : "error",
          allowEmpty: args.includes("--allow-empty"),
          transport: runtime.transport,
        });
      } finally {
        source.fill(0);
      }
      const preview = prepared.preview;
      runtime.print(
        `Import into project ${JSON.stringify(preview.project)}: ${preview.create} new, ${preview.replace} replacements, ${preview.skip} skipped, ${preview.conflicts} conflicts, ${preview.empty} selected empty values.`,
      );
      for (const entry of preview.entries)
        runtime.print(
          `${entry.name}: ${entry.action}${entry.empty ? " (empty)" : ""}${entry.literalReferences ? " (literal reference; no expansion or execution)" : ""}`,
        );
      if (preview.conflicts)
        throw new CliError(
          "Existing keys conflict. No values were saved. Review and choose --skip-existing or --replace explicitly.",
        );
      if (!preview.ready)
        throw new CliError(
          "Empty values require acknowledgement with --allow-empty. No values were saved.",
        );
      if (args.includes("--dry-run")) {
        runtime.print("Dry run complete. No values were saved.");
        return;
      }
      if (!args.includes("--yes")) {
        if (!runtime.interactive)
          throw new CliError(
            "Import requires confirmation. Review --dry-run, then rerun with --yes to save. No values were saved.",
          );
        if (
          (await runtime.prompt(
            "Type IMPORT to save this batch (values remain hidden): ",
          )) !== "IMPORT"
        )
          throw new CliError("Import cancelled. No values were saved.");
      }
      const result = await prepared.commit();
      runtime.print(
        `Imported ${result.imported.length} encrypted values atomically; skipped ${result.skipped.length}.`,
      );
      return;
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
  if (error instanceof EnvImportError || error instanceof ImportCommitError)
    return error.message;
  if (error instanceof LocalVaultError)
    return "Could not unlock the local vault or read a protected file. Check the local vault passphrase (not your website password), file ownership and permissions. Keep your existing vault file.";
  if (error instanceof KeymanError) {
    const tip =
      error.code === "EXPIRED"
        ? " Browser approval or upload authorization expired. Run passman login with the same vault and approve the request, then retry."
        : error.code === "UNAUTHORIZED" &&
            (command === "put" || command === "import")
          ? " Upload authorization was rejected. Run passman login with the same vault, then retry."
          : "";
    return error.message + tip;
  }
  return "Operation failed. Check setup, protected files, passphrase, or connectivity. Sensitive details omitted.";
}
